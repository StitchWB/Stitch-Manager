"""Telegram-bot driven web-account management (set password / sync username).

The Stitch Telegram bot lets a user set their **web** password so they can log
in on the web app with ``username == current Telegram username``.  Telegram
usernames can **change**, so the web account is keyed by the *stable*
``telegram_id`` and the mutable ``username`` is kept in sync on every call.

Endpoint: ``POST /api/auth/tg-sync-user`` — authenticated by ``X-Admin-Key``
matching :attr:`Settings.admin_key` (the same secret the bot already uses
against the distribution server).  Body:

    {"tg_user_id": int, "username": str, "password": str | null}

Behaviour:
  * user bound to ``tg_user_id`` exists  -> update ``username`` (if changed) and
    set ``password_hash`` when ``password`` given.
  * no such user and ``password`` given  -> create it (role ``user``).
  * no such user and no ``password``     -> 404 (nothing to sync yet).

Username collisions with a *different* telegram account surface as 409.
"""

from __future__ import annotations

import hmac
import logging
import time

from fastapi import APIRouter, Header, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError

from stitch_backend.config import get_settings
from stitch_backend.database import get_session_factory
from stitch_backend.domains.auth import service as auth_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

# ── Per-IP rate limit (brute-force deterrence for the admin-keyed endpoint) ──
_RATE_WINDOW_SECONDS = 60.0
_RATE_MAX_PER_WINDOW = 10
_rate_hits: dict[str, list[float]] = {}


def _rate_limit_ok(client_host: str | None) -> bool:
    key = client_host or "unknown"
    now = time.monotonic()
    hits = [t for t in _rate_hits.get(key, []) if now - t < _RATE_WINDOW_SECONDS]
    if len(hits) >= _RATE_MAX_PER_WINDOW:
        _rate_hits[key] = hits
        return False
    hits.append(now)
    _rate_hits[key] = hits
    return True


class TgSyncUserBody(BaseModel):
    tg_user_id: int
    username: str = Field(min_length=1, max_length=64)
    password: str | None = Field(default=None, min_length=1, max_length=128)


def _check_admin_key(x_admin_key: str | None) -> None:
    expected = get_settings().admin_key
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Web admin key not configured (STITCH_ADMIN_KEY)",
        )
    if not x_admin_key or not hmac.compare_digest(
        x_admin_key.encode("utf-8"), expected.encode("utf-8")
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin key",
        )


@router.post("/tg-sync-user")
async def tg_sync_user(
    body: TgSyncUserBody,
    request: Request,
    x_admin_key: str | None = Header(default=None),
) -> dict:
    """Create/update the web account bound to a Telegram id.

    Keyed by stable ``telegram_id``; ``username`` is refreshed to the caller's
    current Telegram username so logins survive username changes.
    """
    if not _rate_limit_ok(request.client.host if request.client else None):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests",
        )
    _check_admin_key(x_admin_key)

    username = body.username.strip()
    if not username:
        raise HTTPException(400, "username must not be empty")

    factory = get_session_factory()
    async with factory() as db:
        user = await auth_service.get_user_by_telegram_id(db, body.tg_user_id)

        if user is None:
            if body.password is None:
                raise HTTPException(
                    404, "no web user bound to this telegram id yet"
                )
            try:
                user = await auth_service.create_user(
                    db,
                    username=username,
                    password=body.password,
                    role="user",
                    telegram_id=body.tg_user_id,
                )
            except IntegrityError as exc:  # duplicate username
                logger.warning("tg-sync-user create failed (duplicate): %s", exc)
                raise HTTPException(409, f"username already taken: {username}") from exc
            await db.commit()
            return {"created": True, "username": user.username, "role": user.role}

        # Existing bound user — sync username + optional password.
        changed = False
        if user.username != username:
            # Refuse to steal a username owned by a different telegram account.
            other = await auth_service.get_user_by_username(db, username)
            if other is not None and other.id != user.id:
                raise HTTPException(409, f"username already taken: {username}")
            user.username = username
            changed = True
        if body.password is not None:
            user.password_hash = auth_service.hash_password(body.password)
            changed = True
        if changed:
            try:
                await db.commit()
            except IntegrityError:
                await db.rollback()
                raise HTTPException(409, f"username already taken: {username}") from None

        return {"created": False, "username": user.username, "role": user.role}
