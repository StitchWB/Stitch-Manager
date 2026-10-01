"""Pure field-mapping helpers for the legacy ai_proxy_accounts ↔ ai_gateway bridge."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy import select

from stitch_backend.domains.ai_gateway.models import Credential

_ADAPTER_MAP: dict[str, str] = {
    "anthropic": "anthropic",
    "gemini": "gemini",
}

# Default base URLs for built-in providers (mirrors KeyHealthWorker + commands).
_BASE_URL_MAP: dict[str, str] = {
    "openai": "https://api.openai.com",
    "antigravity": "https://api.openai.com",
    "fireworks": "https://api.fireworks.ai/inference",
    "dashscope": "https://dashscope.aliyuncs.com/compatible-mode",
    "gemini": "https://generativelanguage.googleapis.com/v1beta",
    "anthropic": "https://api.anthropic.com",
}


def _adapter_type_for_provider(provider: str) -> str:
    return _ADAPTER_MAP.get(provider, "openai_compatible")


def _default_base_url(provider: str) -> str:
    return _BASE_URL_MAP.get(provider, f"https://unknown-base-url.invalid/{provider}")


def _display_name(provider: str) -> str:
    return provider.replace("_", " ").strip().title() or provider


def _legacy_id(credential_id: str) -> int:
    """Deterministic 31-bit positive int from a Credential UUID.

    Used as the ``id`` field in legacy AiProxyAccount responses so the
    frontend can pass it back to update/delete. Resolved by scanning
    credentials (small N) — see :func:`_find_credential_by_legacy_id`.
    """
    h = hashlib.sha256(credential_id.encode()).hexdigest()
    return int(h[:8], 16) & 0x7FFFFFFF


async def _find_credential_by_legacy_id(
    session: Any, legacy_id: int
) -> Credential | None:
    """Scan credentials for one whose hash matches *legacy_id*."""
    result = await session.execute(select(Credential))
    for cred in result.scalars().all():
        if _legacy_id(cred.id) == legacy_id:
            return cast("Credential", cred)
    return None


# name lives in Credential.label; other fields go to legacy_metadata JSON (lossless).
_METADATA_FIELDS: tuple[str, ...] = (
    "accountType",
    "softQuotaTokensDaily",
    "softQuotaRequestsDaily",
    "oauthScopes",
    "oauthTokenType",
    "refCode",
    "refUrl",
    "refUsedCount",
    "refMaxCount",
    "referredById",
)


def _encode_metadata(account: dict[str, Any]) -> dict[str, Any]:
    """Pack legacy fields with no 1:1 gateway column into a metadata dict."""
    payload: dict[str, Any] = {}
    for key in _METADATA_FIELDS:
        val = account.get(key)
        if val is not None:
            payload[key] = val
    return payload


def _decode_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    """Unpack the metadata dict back into a dict of legacy fields."""
    if not metadata:
        return {}
    return dict(metadata) if isinstance(metadata, dict) else {}


def _decode_old_label(label: str | None) -> dict[str, Any]:
    """Decode the old JSON-in-label format (pre-P0.2).

    Before P0.2, all imperfect fields (including ``name``) were packed
    into ``Credential.label`` as a JSON dict.  This decodes that format
    so the startup conversion can split it into ``label`` + ``legacy_metadata``.
    """
    if not label:
        return {}
    try:
        data = json.loads(label)
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _is_masked_secret(value: str | None) -> bool:
    """True when *value* looks like a masked secret (first4+****+last4).

    The mask format produced by :func:`_mask_secret` always contains
    ``"****"``.  Real API keys / OAuth tokens never contain literal
    asterisks, so this is a safe heuristic for detecting write-back
    of a masked value (which would corrupt the stored secret).
    """
    if not value:
        return False
    return "****" in value


def _pick_secret(account: dict[str, Any]) -> tuple[str | None, str]:
    """Return (secret, auth_type) — first non-empty of apiKey/oauth/session.

    Masked values (containing ``"****"``) are skipped to prevent
    write-back corruption — a masked secret is never a real secret,
    so it is treated as absent.  In ``update_account`` this means the
    existing secret is kept (no rotation); in ``create_account`` the
    empty-placeholder path runs (same as when no secret is provided).
    """
    api_key = account.get("apiKey") or account.get("api_key")
    if api_key and not _is_masked_secret(api_key):
        return api_key, "api_key"
    oauth = account.get("oauthToken") or account.get("oauth_token")
    if oauth and not _is_masked_secret(oauth):
        return oauth, "oauth"
    session_tok = account.get("sessionToken") or account.get("session_token")
    if session_tok and not _is_masked_secret(session_tok):
        return session_tok, "session"
    return None, ""


def _mask_secret(value: str | None) -> str | None:
    """Mask a secret for non-owner callers: first4+****+last4.

    Short secrets → ``****``.  ``None`` stays ``None``.
    """
    if value is None:
        return None
    if len(value) < 8:
        return "****"
    return value[:4] + "****" + value[-4:]


def _dt_to_ts(dt: datetime | None) -> int | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        # SQLite stores naive datetimes as UTC wall time; untagged .timestamp() drifts.
        dt = dt.replace(tzinfo=UTC)
    return int(dt.timestamp())


def _ts_to_dt(ts: int | None) -> datetime | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=UTC)
