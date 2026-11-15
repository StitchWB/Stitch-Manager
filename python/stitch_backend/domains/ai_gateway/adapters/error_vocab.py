"""Error-envelope vocabulary for OpenAI-compatible gateways.

Why this module exists
----------------------
Classifying a provider failure by HTTP status is not safe for gateways that wrap
another vendor.  Measured example (``api.reformboss.com``, a New API instance
behind a custom gateway): an exhausted daily quota is answered with

    HTTP 401
    {"error": {"code": "invalid_api_key",
               "message": "Дневной лимит исчерпан ... сброс в 00:00 МСК",
               "outcome": "not_executed", "do_not_auto_retry": false}}

A status-first classifier turns that into ``auth_failed``, which sets no
``next_retry_at`` and never writes ``quota_reset_at``: a healthy key that is
merely suspended for the day is reported as dead and stays out of rotation.

Rules of this module:

* branch on ``error.code``, refined by ``outcome`` where needed, never on text;
* ``do_not_auto_retry`` is not exposed to callers at all, because the suspended
  key 401 reports ``false`` and the field cannot act as a veto;
* an unknown code returns ``None`` and the caller keeps its status-based logic,
  so no provider loses behaviour it already has.

Code tables carry the vendor's own vocabulary (public repo) plus the codes
observed live.  Unlisted codes fall through to ``_PREFIX_TABLE`` and then to the
caller's fallback.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta, timezone, tzinfo

# ── Envelope parsing ─────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Envelope:
    """The machine-readable part of an OpenAI-shaped error body."""

    code: str | None = None
    error_type: str | None = None
    outcome: str | None = None
    attempts: int | None = None
    request_id: str | None = None

    @property
    def not_executed(self) -> bool:
        """True when the gateway states the request was never executed."""
        return (self.outcome or "").strip().lower() == "not_executed"


def parse_envelope(body_text: str) -> Envelope | None:
    """Parse an OpenAI-shaped error body; ``None`` when it is not one."""
    text = (body_text or "").strip()
    if not text.startswith("{"):
        return None
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    error = data.get("error")
    if not isinstance(error, dict):
        return None
    metadata = error.get("metadata")
    meta = metadata if isinstance(metadata, dict) else error
    code = error.get("code")
    return Envelope(
        code=code.strip() if isinstance(code, str) and code.strip() else None,
        error_type=_str_or_none(error.get("type")),
        outcome=_str_or_none(meta.get("outcome")),
        attempts=_int_or_none(meta.get("attempts")),
        request_id=_str_or_none(meta.get("request_id")),
    )


# ── Classification verdict ───────────────────────────────────────────────────


@dataclass(frozen=True)
class Verdict:
    """What the caller should do with a failed attempt.

    ``scope`` is the reach of the failure: ``key`` (next candidate),
    ``account`` (skip the rest of the account group and park until reset),
    ``global`` (do not walk candidates at all) or ``endpoint`` (circuit breaker
    only, the key is blameless).
    """

    category: str
    scope: str = "key"
    is_model_specific: bool = False
    retry_hint_seconds: int | None = None
    until_local_reset: bool = False
    code: str | None = None


_CODE_TABLE: dict[str, Verdict] = {
    "missing_api_key": Verdict("auth_failed", "key"),
    "api_key_disabled": Verdict("auth_failed", "key"),
    "api_key_expired": Verdict("auth_failed", "key"),
    "account_disabled": Verdict("auth_failed", "account"),
    "account_banned": Verdict("auth_failed", "account"),
    "account_not_found": Verdict("auth_failed", "account"),
    "access_blocked": Verdict("auth_failed", "account"),
    "provider_forbidden": Verdict("model_access_denied", "key", is_model_specific=True),
    "model_access_denied": Verdict("model_access_denied", "key", is_model_specific=True),
    "model_not_found": Verdict("model_not_found", "key", is_model_specific=True),
    "model_unavailable": Verdict("model_not_found", "key", is_model_specific=True),
    "insufficient_quota": Verdict("quota_exhausted", "account"),
    "quota_precharge_insufficient": Verdict("quota_exhausted", "account"),
    "api_key_empty": Verdict("quota_exhausted", "account"),
    "daily_budget_exhausted": Verdict("quota_exhausted", "account", until_local_reset=True),
    "rate_limit_exceeded": Verdict("rate_limited", "key"),
    "upstream_busy": Verdict("rate_limited", "global", retry_hint_seconds=10),
    "upstream_rate_limited": Verdict("rate_limited", "global", retry_hint_seconds=10),
    "upstream_rate_limit_exceeded": Verdict("rate_limited", "global", retry_hint_seconds=10),
    "gateway_restarting": Verdict("server_error", "global", retry_hint_seconds=2),
    "upstream_timeout": Verdict("server_error", "endpoint", retry_hint_seconds=2),
    "content_policy_violation": Verdict("client_error", "key"),
    "context_overflow": Verdict("client_error", "key"),
    "request_too_large": Verdict("client_error", "key"),
    "upstream_request_too_large": Verdict("client_error", "key"),
    "model_endpoint_mismatch": Verdict("client_error", "key"),
    "vision_not_supported": Verdict("client_error", "key"),
}

_PREFIX_TABLE: tuple[tuple[str, Verdict], ...] = (
    ("upstream_", Verdict("server_error", "endpoint")),
)

_AMBIGUOUS_AUTH_CODES = frozenset({"invalid_api_key"})


def classify_envelope(envelope: Envelope | None) -> Verdict | None:
    """Map a parsed envelope to a verdict; ``None`` when nothing is known."""
    if envelope is None or not envelope.code:
        return None
    code = envelope.code

    if code in _AMBIGUOUS_AUTH_CODES:
        if envelope.not_executed:
            return Verdict("quota_exhausted", "account", until_local_reset=True, code=code)
        return Verdict("auth_failed", "key", code=code)

    verdict = _CODE_TABLE.get(code)
    if verdict is not None:
        return _with_code(verdict, code)

    for prefix, prefixed in _PREFIX_TABLE:
        if code.startswith(prefix):
            return _with_code(prefixed, code)

    return None


def _with_code(verdict: Verdict, code: str) -> Verdict:
    if verdict.code == code:
        return verdict
    return Verdict(
        verdict.category,
        verdict.scope,
        is_model_specific=verdict.is_model_specific,
        retry_hint_seconds=verdict.retry_hint_seconds,
        until_local_reset=verdict.until_local_reset,
        code=code,
    )


# ── Local reset clock ────────────────────────────────────────────────────────

_MOSCOW_FALLBACK = timezone(timedelta(hours=3), "MSK")

# quota resets at local midnight; a suspension seen within this window is stale
_RESET_GRACE_SECONDS = 300


def local_tz(name: str) -> tzinfo:
    """Resolve an IANA zone, falling back to a fixed offset.

    Windows CPython ships no tz database, so ``zoneinfo`` may raise; UTC+3 is
    correct for Moscow, which has had no DST since 2014.
    """
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(name)
    except Exception:  # noqa: BLE001 - missing tzdata on Windows
        return _MOSCOW_FALLBACK


def next_local_midnight(name: str = "Europe/Moscow", *, now: datetime | None = None) -> datetime:
    """Next 00:00 in *name* as an aware UTC datetime; ``now`` is injectable.

    Inside a short grace window after local midnight the daily quota has just
    reset, so parking a full day on a stale suspension would lose a day of
    quota; a short retry is returned instead.
    """
    tz = local_tz(name)
    reference = now.astimezone(tz) if now is not None else datetime.now(tz)
    seconds_since_midnight = reference.hour * 3600 + reference.minute * 60 + reference.second
    if seconds_since_midnight < _RESET_GRACE_SECONDS:
        return (reference + timedelta(seconds=60)).astimezone(UTC)
    following = reference.date() + timedelta(days=1)
    reset = datetime.combine(following, time(0, 0), tzinfo=tz)
    return reset.astimezone(UTC)


@dataclass(frozen=True)
class ResetClock:
    """Which zone the provider resets its daily counters in."""

    timezone_name: str = "Europe/Moscow"
    extra: dict[str, str] = field(default_factory=dict)

    def next_reset_at(self, now: datetime | None = None) -> datetime:
        return next_local_midnight(self.timezone_name, now=now)


def _str_or_none(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _int_or_none(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None

