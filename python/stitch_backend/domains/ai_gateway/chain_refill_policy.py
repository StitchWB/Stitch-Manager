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

# Rotation Signal B: catalog mass-diff against the previous successful-fetch
# snapshot.  Discovery normally runs hourly, so evidence older than two passes
# means no successful fetch happened inside the window and detection is
# skipped entirely.  The baseline is the immediately preceding fetch snapshot
# (persisted per-endpoint in additive health-policy JSON), never the cumulative
# ever-seen union: for volatile rotating-subset upstreams the union converges
# permanently above any missing-fraction threshold and false-fires forever.
#
# The rotation signature is mass REPLACEMENT, both halves required:
#   - mass disappearance vs the snapshot (missing fraction >= 0.8), and
#   - substantial NEW ids (new ids are at least half of the current lineup) —
#     real rotations arrive with a new lineup; degraded fetches and subset
#     flaps do not.
# A half-overlapping rotating subset (missing fraction 0.5, new fraction 0.33)
# passes neither gate; a true full-lineup rotation passes both.  Very
# aggressive rotating subsets with <20% overlap can still false-fire — the
# documented, deliberate tradeoff of any count-based diff.
#
# The asymmetry is deliberate and must stay visible: this signal false-FIRES
# on aggressive subset flaps, but it also false-MISSES the realistic rolling
# rotation shape.  An upstream replacing ~50% of its lineup per hour never
# crosses the 0.8 missing fraction in any single pass, and because the
# snapshot advances on every evaluation the diff baseline moves with the
# rotation — detection is lost permanently, not deferred to a later pass.
# Signal A (model-scoped terminal probe evidence on previously active chain
# models) is the mitigation: it watches the dead-model errors a rolling
# rotation actually produces, independent of catalog diffing.  Signal B
# exists for the complementary shape — a near-total lineup swap whose models
# were never individually probed.
CHAIN_ROTATION_CATALOG_PASS_SECONDS = 3600
CHAIN_ROTATION_CATALOG_PASSES = 2
CHAIN_ROTATION_CATALOG_MIN_MISSING = 2
CHAIN_ROTATION_CATALOG_MISSING_FRACTION = 0.8
CHAIN_ROTATION_CATALOG_MIN_NEW_MODELS = 1
# New ids as a fraction of the CURRENT snapshot: the replacement signature.
# 0.5 means at least half the current lineup was not in the previous fetch.
CHAIN_ROTATION_CATALOG_NEW_FRACTION = 0.5
# Rows written by one discovery pass share ONE ``last_seen_at`` value (a
# single ``now`` per endpoint per pass), so pass grouping needs only a tiny
# tolerance for backend datetime round-trip quirks.  A large tolerance would
# merge distinct passes that happen close together (hourly + manual trigger),
# inflating the snapshot back towards a cumulative union.
CHAIN_ROTATION_CATALOG_FETCH_TOLERANCE_SECONDS = 2
# Event payloads carry a bounded diagnostic sample, not an unbounded catalog
# dump; counts remain exact even when the key list is truncated.
CHAIN_ROTATION_MAX_EVENT_MODEL_KEYS = 32

CHAIN_ROTATION_STATE_KEY = "chainRotation"
CHAIN_ROTATION_WATCH_KEY = "chainRotationWatch"
# Additive health-policy key holding the last evaluated successful-fetch
# snapshot: ``{"modelKeys": sorted list, "fetchedAt": iso}``.  Written by the
# rotation detector itself; re-detection requires fetch evidence NEWER than
# ``fetchedAt``, so frozen discovery data can never re-fire a byte-identical
# event after the burst window expires.
CHAIN_ROTATION_SNAPSHOT_KEY = "chainRotationCatalogSnapshot"
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


def catalog_snapshot(policy: object) -> tuple[frozenset[str], datetime] | None:
    """Return the persisted successful-fetch snapshot ``(keys, fetchedAt)``.

    ``None`` when the key is absent or malformed — the conservative first-ever
    escape (no baseline, no detection) is decided by the caller.
    """
    if not isinstance(policy, dict):
        return None
    raw = policy.get(CHAIN_ROTATION_SNAPSHOT_KEY)
    if not isinstance(raw, dict):
        return None
    keys_raw = raw.get("modelKeys")
    fetched_at = parse_iso_utc(raw.get("fetchedAt"))
    if not isinstance(keys_raw, list) or fetched_at is None:
        return None
    keys = frozenset(str(key) for key in keys_raw if isinstance(key, str))
    return keys, fetched_at


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
