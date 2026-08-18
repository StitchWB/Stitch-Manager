"""Token generation, hashing, and FastAPI auth dependencies.

Token = 256-bit random (secrets.token_hex(32) → 64 hex chars).
Stored as sha256 hex of the token string. Returned once at activation.
The signing key is OFFLINE — never on this server (plan §3.1 item 4).
"""

from __future__ import annotations

import hashlib
import secrets

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: TC002 — FastAPI resolves at runtime

from stitch_server.config import get_settings
from stitch_server.db import get_db
from stitch_server.models import ServerSetting, Token

# ── Token utilities ───────────────────────────────────────────────────────────

TOKEN_BYTES = 32  # 256-bit


def generate_token() -> str:
    """Generate a 256-bit random token as a 64-char hex string."""
    return secrets.token_hex(TOKEN_BYTES)


def hash_token(token: str) -> str:
    """Hash a token string with sha256. Only the hash is stored."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_code(code: str) -> str:
    """Hash a one-time activation code with sha256.

    Mirrors :func:`hash_token`: the raw code is returned ONCE at issuance
    (admin API), and only its sha256 hex is persisted.  Lookup at activation
    time is by hash, so the raw code never leaves the issuance response.
    """
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


# ── Device limit ───────────────────────────────────────────────────────────────

async def get_device_limit(db: AsyncSession) -> int:
    """Read the device limit from DB (server_settings), fall back to config."""
    result = await db.execute(
        select(ServerSetting).where(ServerSetting.key == "device_limit")
    )
    row = result.scalar_one_or_none()
    if row is not None:
        try:
            return int(row.value)
        except ValueError:
            pass
    return get_settings().device_limit


# ── Bearer token dependency ────────────────────────────────────────────────────

async def resolve_token(
    authorization: str | None,
    db: AsyncSession,
) -> Token:
    """Resolve a Bearer token from the Authorization header.

    Raises 401 if missing/malformed, 403 if the token is revoked.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )
    raw = authorization.removeprefix("Bearer ").strip()
    if not raw:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Empty bearer token",
        )
    token_hash = hash_token(raw)
    result = await db.execute(select(Token).where(Token.token_hash == token_hash))
    token = result.scalar_one_or_none()
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )
    if token.revoked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token revoked",
        )
    return token


async def require_token(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> Token:
    """FastAPI dependency: require a valid, non-revoked bearer token."""
    return await resolve_token(authorization, db)


# ── Admin key dependency ───────────────────────────────────────────────────────

async def require_admin(
    x_admin_key: str | None = Header(default=None),
) -> None:
    """FastAPI dependency: require X-Admin-Key header matching the configured key."""
    expected = get_settings().admin_key
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin key not configured on server",
        )
    if not x_admin_key or not secrets.compare_digest(x_admin_key, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin key",
        )


# ── Entitlements ───────────────────────────────────────────────────────────────

def has_entitlement(token: Token, plugin_id: str) -> bool:
    """True if the token's entitlements grant access to ``plugin_id``.

    Entitlements semantics (plan §3.1 item 3):
      - ``["*"]`` (default) = access to all plugins.
      - ``["kiro-autoreg", "aws-builder-id"]`` = access only to listed ids.
      - Empty list = no access to any plugin.

    Used by the manifest, plugins, and selectors routers to filter / gate
    delivery endpoints per-token.
    """
    entitlements = token.entitlements if token.entitlements is not None else []
    if "*" in entitlements:
        return True
    return plugin_id in entitlements
