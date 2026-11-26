"""Central policy constants and small pure helpers for rb/* chain refill.

Probe budgets, refill composition bounds, and rotation-detection thresholds are
kept together so the aggressive path remains inspectable and cannot drift into
several independent magic numbers.  The module is intentionally dependency-light:
``RoleCatalogService``, ``ChainRefillService`` and ``ProbeWorker`` all import it
without creating a service-layer cycle.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

# Desired-chain composition bounds.  ``per pass`` limits write churn; ``per
# role`` bounds the total number of auto rescue attempts because dead manual and
# factory rows remain visible and are never deleted by refill.
CHAIN_REFILL_MIN_LIVE_CANDIDATES_PER_ROLE = 2
CHAIN_REFILL_MAX_ENTRIES_PER_PASS = 2
CHAIN_REFILL_MAX_AUTO_ENTRIES_PER_ROLE = 4
CHAIN_REFILL_READD_STICKINESS_SECONDS = 6 * 60 * 60

# Exact-probe evidence budgets.  Steady-state discovery is deliberately a
# trickle; cold starts and detected upstream rotations reuse the same bounded
# burst size/window.  Endpoint probe backoff remains a hard cap above both.
CHAIN_PROBE_CANDIDATE_MAX_PER_ENDPOINT_PER_PASS = 1
CHAIN_PROBE_BURST_MAX_PER_ENDPOINT_PER_PASS = 5
CHAIN_PROBE_BURST_WINDOW_SECONDS = 900

# Rotation Signal A: model-scoped terminal invocability evidence only.  Quota
# and authentication failures are key/account-scoped and are deliberately not in
# this set.  ``token_model_not_allowed`` is included because the rollout design
# treats key-class entitlement withdrawal as a rotation signal while still not
# erasing tier evidence for future key classes.
CHAIN_ROTATION_MODEL_SCOPED_REASONS = frozenset(
    {
        "model_not_found",
        "token_model_not_allowed",
        "model_access_denied",
    }
)
CHAIN_ROTATION_WINDOW_SECONDS = 2 * 300  # rolling two standard probe passes
CHAIN_ROTATION_MIN_DEMOTED_MODELS = 2
CHAIN_ROTATION_DEMOTED_FRACTION = 0.5

# Rotation Signal B: catalog mass-diff.  Discovery normally runs hourly; two
# consecutive misses therefore mean a last-seen timestamp older than two hours.
# Requiring at least one never-before-seen row is the conservative anti-flap
# condition described in the design ("mass diff", not merely catalog flap).
CHAIN_ROTATION_CATALOG_PASS_SECONDS = 3600
CHAIN_ROTATION_CATALOG_PASSES = 2
CHAIN_ROTATION_CATALOG_MIN_MISSING = 2
CHAIN_ROTATION_CATALOG_MISSING_FRACTION = 0.5
CHAIN_ROTATION_CATALOG_MIN_NEW_MODELS = 1
# Event payloads carry a bounded diagnostic sample, not an unbounded catalog
# dump; counts remain exact even when the key list is truncated.
CHAIN_ROTATION_MAX_EVENT_MODEL_KEYS = 32

CHAIN_ROTATION_STATE_KEY = "chainRotation"
CHAIN_ROTATION_WATCH_KEY = "chainRotationWatch"
CHAIN_ROTATION_MESSAGE = "upstream rotation detected, rederiving chains"

_REVIEWER_ROLES = frozenset({"rb/reviewer-correctness", "rb/reviewer-adversarial"})

# Conservative family inference.  This table is an ordering/composition hint
# only: it never admits a model to a tier, and unrecognized novel names remain
# explicitly unknown instead of being guessed from loose substrings.
_FAMILY_PREFIXES: tuple[tuple[str, str], ...] = (
    ("deepseek", "deepseek"),
    ("gemini", "google"),
    ("claude", "anthropic"),
    ("qwen", "qwen"),
    ("glm", "zhipu"),
    ("gpt", "openai"),
    ("kimi", "moonshot"),
    ("llama", "meta"),
    ("mistral", "mistral"),
)
_FAMILY_RE = tuple(
    (re.compile(rf"^{re.escape(prefix)}(?:[-_.\d]|$)", re.IGNORECASE), family)
    for prefix, family in _FAMILY_PREFIXES
)


def as_utc(value: datetime | None) -> datetime | None:
    """Normalize SQLAlchemy's sometimes-naive datetimes to UTC-aware values."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def parse_iso_utc(value: object) -> datetime | None:
    """Parse one persisted ISO timestamp, returning ``None`` for malformed input."""
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return as_utc(parsed)


def rotation_state(policy: object) -> dict[str, Any] | None:
    """Return the persisted rotation event from endpoint health policy, if valid."""
    if not isinstance(policy, dict):
        return None
    state = policy.get(CHAIN_ROTATION_STATE_KEY)
    if not isinstance(state, dict):
        return None
    return dict(state)


def rotation_state_active(policy: object, now: datetime) -> bool:
    """True while a persisted rotation event is inside its bounded burst window."""
    state = rotation_state(policy)
    if state is None:
        return False
    detected_at = parse_iso_utc(state.get("detectedAt") or state.get("detected_at"))
    if detected_at is None:
        return False
    now_utc = as_utc(now)
    if now_utc is None:
        return False
    return 0 <= (now_utc - detected_at).total_seconds() <= CHAIN_PROBE_BURST_WINDOW_SECONDS


def infer_model_family(model_id: str, capabilities: dict[str, Any] | None = None) -> str:
    """Best-effort family label for composition only; unknown when unprovable.

    Explicit probe/catalog metadata wins.  Without it, only a small conservative
    prefix table is used.  Novel names such as ``zminimax`` or ``kestrel`` are
    intentionally ``unknown`` rather than mapped by fragile substring matching.
    """
    caps = capabilities or {}
    for key in ("family", "model_family"):
        value = caps.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip().lower()
    lowered = model_id.strip().lower()
    for pattern, family in _FAMILY_RE:
        if pattern.match(lowered):
            return family
    return "unknown"


def role_prefers_family_diversity(public_model_id: str) -> bool:
    """Reviewer roles benefit most from independent model-family failure modes."""
    return public_model_id in _REVIEWER_ROLES
