"""POST /activate — exchange activation code (or existing token) for a
token bound to a device (hwid).

Two modes:
  1. ``{activation_code, hwid}`` — first activation. Code is one-time;
     second use → 409. Produces a new token, registers device 1.
  2. ``{token, hwid}`` — additional device for an existing token.
     Checks device limit; exceeding → 403.

Returns ``{token, pubkey, entitlements}`` on success. The token is
returned once; only its sha256 hash is stored.

Hardening:
  * Per-IP sliding-window rate limit on every POST /activate (429 +
    ``Retry-After`` when exceeded).  See ``stitch_server.rate_limit``.
  * Code lifecycle: revoked → 403, expired (``expires_at`` != NULL and
    now > ``expires_at``) → 403, already used → 409, unknown → 404.
  * Atomic redemption: the read-then-write race on ``used`` is closed
    by an ``UPDATE ... WHERE used=0`` conditional update — if
    ``rowcount == 0`` another request won the code, so the just-created
    token+device are deleted and 409 is raised.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: TC002 — FastAPI resolves at runtime

from stitch_server.auth import generate_token, get_device_limit, hash_code, hash_token
from stitch_server.config import get_settings
from stitch_server.db import get_db
from stitch_server.models import ActivationCode, Device, Token
from stitch_server.rate_limit import get_limiter
from stitch_server.timeutils import as_utc as _as_utc

router = APIRouter()


class ActivateRequest(BaseModel):
    """Activation request — provide either activation_code (first activation)
    or token (additional device). hwid is always required."""

    activation_code: str | None = None
    token: str | None = None
    hwid: str


class ActivateResponse(BaseModel):
    token: str
    pubkey: str
    entitlements: list
    tg_admin: bool = False


def _client_ip(request: Request) -> str:
    """Resolve the client IP for rate limiting.

    Trusts the first hop of ``X-Forwarded-For`` (nginx reverse proxy on
    the same host); falls back to ``request.client.host`` for direct
    connections.  The proxy is on the same host, so spoofing XFF from a
    client would be overwritten by nginx's own XFF — safe in this
    deployment.
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        # First hop is the original client.
        return xff.split(",", 1)[0].strip()
    if request.client is not None:
        return request.client.host
    return "unknown"


@router.post("/activate", response_model=ActivateResponse)
async def activate(
    req: ActivateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> ActivateResponse:
    if not req.hwid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="hwid is required",
        )

    # ── Per-IP rate limit (applies to both code and token modes) ────────────
    limiter = get_limiter()
    ip = _client_ip(request)
    allowed, retry_after = limiter.check(ip)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many activation attempts, try again later",
            headers={"Retry-After": str(retry_after)},
        )

    if req.activation_code is not None:
        return await _activate_with_code(req.activation_code, req.hwid, db)
    if req.token is not None:
        return await _add_device_for_token(req.token, req.hwid, db)
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Provide either activation_code or token",
    )


async def _activate_with_code(
    code_str: str, hwid: str, db: AsyncSession
) -> ActivateResponse:
    result = await db.execute(
        select(ActivationCode).where(ActivationCode.code_hash == hash_code(code_str))
    )
    code = result.scalar_one_or_none()
    if code is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Unknown activation code",
        )
    if code.revoked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Activation code revoked",
        )
    if code.expires_at is not None and datetime.now(UTC) > _as_utc(code.expires_at):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Activation code expired",
        )
    if code.used:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Activation code already used",
        )

    raw_token = generate_token()
    token = Token(
        token_hash=hash_token(raw_token),
        entitlements=code.entitlements,
        revoked=False,
    )
    db.add(token)
    await db.flush()

    device = Device(token_id=token.id, hwid=hwid)
    db.add(device)

    # ── Atomic mark-used: closes the read-then-write race ───────────────────
    # Two concurrent requests for the same code both pass the ``used`` check
    # above; this conditional UPDATE ensures only one of them actually flips
    # ``used`` to 1.  rowcount == 0 means the other request won — we must
    # delete the just-created token+device and refuse with 409.
    now = datetime.now(UTC)
    result = await db.execute(
        update(ActivationCode)
        .where(ActivationCode.id == code.id, ActivationCode.used == False)  # noqa: E712
        .values(used=True, used_at=now, token_id=token.id)
    )
    if result.rowcount == 0:
        # Lost the race — delete the speculative token+device and refuse.
        await db.delete(device)
        await db.delete(token)
        await db.flush()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Activation code already used",
        )
    await db.flush()

    return ActivateResponse(
        token=raw_token,
        pubkey=get_settings().pubkey,
        entitlements=code.entitlements,
        tg_admin=bool(code.tg_admin),
    )


async def _add_device_for_token(
    raw_token: str, hwid: str, db: AsyncSession
) -> ActivateResponse:
    token_hash = hash_token(raw_token)
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

    existing = await db.execute(
        select(Device).where(Device.token_id == token.id, Device.hwid == hwid)
    )
    if existing.scalar_one_or_none() is not None:
        return ActivateResponse(
            token=raw_token,
            pubkey=get_settings().pubkey,
            entitlements=token.entitlements,
        )

    count_result = await db.execute(
        select(func.count()).select_from(Device).where(Device.token_id == token.id)
    )
    count = count_result.scalar_one()
    limit = await get_device_limit(db)
    if count >= limit:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Device limit reached ({limit})",
        )

    db.add(Device(token_id=token.id, hwid=hwid))
    await db.flush()

    return ActivateResponse(
        token=raw_token,
        pubkey=get_settings().pubkey,
        entitlements=token.entitlements,
    )
