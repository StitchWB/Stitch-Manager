"""Found-keys command handlers — AiApiRadar leaked-key proxy.

Two read-only commands wired to the command registry:

  - ``get_found_keys``       → proxied ``GET /api/found-keys`` (masked list)
  - ``get_found_key_secret`` → proxied ``GET /api/found-keys/{id}/secret``

Access: VIP+ only (role ladder from the auth domain). The dispatcher injects
``_caller_role``; auth disabled → caller is treated as admin (trusted
desktop). The role is forwarded to the radar as a signed HS256 assertion so
Stitch-authenticated users read keys without a second login.
"""

from __future__ import annotations

from stitch_backend.config import get_settings
from stitch_backend.core.command_registry import register_command
from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.auth import roles

from .models import FoundKeySecretParams, FoundKeysParams
from .service import fetch_found_key_secret, fetch_found_keys


def _keys_role(params: dict) -> str:
    """Enforce the VIP+ tier ladder on found keys (owner policy)."""
    role = params.get("_caller_role")
    min_role = get_settings().radar_min_role or "vip"
    if not roles.role_at_least(role, min_role):
        raise StitchError(f"found keys require role {min_role}+")
    return str(role or "")


def _keys_sub(params: dict) -> str | None:
    """Caller's Telegram id for the assertion ``sub`` claim (or None)."""
    tg_id = params.get("_caller_telegram_id")
    return str(tg_id) if tg_id is not None else None


@register_command("get_found_keys", readonly=True)
async def cmd_get_found_keys(params: dict) -> dict:
    """Return the masked found-keys list from AiApiRadar (VIP+)."""
    role = _keys_role(params)
    validated = FoundKeysParams.model_validate(params or {})
    return await fetch_found_keys(validated, role, _keys_sub(params))


@register_command("get_found_key_secret", readonly=True)
async def cmd_get_found_key_secret(params: dict) -> dict:
    """Return one decrypted key from AiApiRadar (VDS-only endpoint, VIP+).

    TRUST MODEL (review finding, accepted): the Stitch backend is a
    localhost-only desktop service with no auth layer by design — any local
    process can call any command. The real gates are: the role ladder here
    and the radar-side assertion/admin check upstream. Do NOT expose this
    backend over a network interface without adding auth.
    """
    role = _keys_role(params)
    validated = FoundKeySecretParams.model_validate(params or {})
    return await fetch_found_key_secret(validated.id, role, _keys_sub(params))
