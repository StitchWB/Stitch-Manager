"""Auth service — password hashing, session tokens, user CRUD.

Password hashing
    stdlib :func:`hashlib.scrypt` with ``n=16384, r=8, p=1`` and a 16-byte
    salt.  The stored format is ``scrypt$<salt_hex>$<hash_hex>``.
    Verification uses :func:`hmac.compare_digest` for timing-safe
    comparison.  No new dependencies.

Session tokens
    Raw token = :func:`secrets.token_hex(32)` (64 hex chars / 32 bytes).
    Stored: ``sha256(token)`` hex (64 chars).  Expiry: 7 days.  Raw tokens
    are never stored or logged.

Constant-time login
    When the user does not exist, a dummy scrypt hash is still computed so
    the response time of a missing-user login matches a bad-password login
    for an existing user.  This narrows (does not eliminate) user
    enumeration via timing.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from stitch_backend.core.exceptions import StitchError

from . import roles
from .models import Session, User

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

#: scrypt CPU/memory cost — matches OWASP 2024 recommendation.
_SCRYPT_N = 16384
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_DKLEN = 32  # 256-bit derived key
_SALT_BYTES = 16

#: Session lifetime — 7 days.
SESSION_TTL = timedelta(days=7)

#: A pre-computed dummy hash used to keep login timing roughly constant when
#: the requested user does not exist.  Format: ``scrypt$<salt>$<hash>``.
_DUMMY_HASH = "scrypt$" + ("00" * _SALT_BYTES) + "$" + ("00" * _SCRYPT_DKLEN)

# ── Login policy (enforce_login) ──────────────────────────────────────────────

#: Settings table key for the admin-controllable login-enforcement toggle.
#: Stored as a string ("true"/"false") in the shared ``settings`` table so it
#: rides the same persistence mechanism as every other setting.
ENFORCE_LOGIN_KEY = "auth.enforce_login"

#: Default value when the setting row is absent (fresh install).  ``True``
#: preserves the v2 contract: a device with users requires login until an
#: admin explicitly opts out.
ENFORCE_LOGIN_DEFAULT = True


async def get_enforce_login(db: AsyncSession) -> bool:
    """Return the persisted ``enforce_login`` setting.

    Defaults to :data:`ENFORCE_LOGIN_DEFAULT` (``True``) when the setting
    row is absent or malformed — a fresh install keeps the v2 contract
    (users ⇒ login required) until an admin explicitly opts out.
    """
    from stitch_backend.domains.settings.models import Setting

    stmt = select(Setting).where(Setting.key == ENFORCE_LOGIN_KEY)
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()
    if row is None or row.value is None:
        return ENFORCE_LOGIN_DEFAULT
    return row.value.lower() in ("true", "1", "yes")


async def set_enforce_login(db: AsyncSession, value: bool) -> bool:
    """Persist the ``enforce_login`` setting and return the new value."""
    from datetime import UTC, datetime

    from stitch_backend.domains.settings.models import Setting

    raw = "true" if value else "false"
    now = datetime.now(UTC).isoformat()
    stmt = sqlite_insert(Setting).values(
        key=ENFORCE_LOGIN_KEY, value=raw, updated_at=now
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["key"],
        set_={"value": raw, "updated_at": now},
    )
    await db.execute(stmt)
    await db.flush()
    return value


# ── Password hashing ──────────────────────────────────────────────────────────


def hash_password(password: str) -> str:
    """Return ``scrypt$<salt_hex>$<hash_hex>`` for *password*.

    A fresh 16-byte salt is generated per call.  The hash is 32 bytes
    (256 bits).  Output is deterministic given the same salt + password.
    """
    salt = secrets.token_bytes(_SALT_BYTES)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_SCRYPT_DKLEN,
    )
    return f"scrypt${salt.hex()}${derived.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Verify *password* against a stored ``scrypt$<salt>$<hash>`` string.

    Uses :func:`hmac.compare_digest` for timing-safe comparison.  Returns
    ``False`` if *stored* is malformed (logged at warning).
    """
    parts = stored.split("$")
    if len(parts) != 3 or parts[0] != "scrypt":
        logger.warning("Malformed password hash — rejecting login")
        return False
    try:
        salt = bytes.fromhex(parts[1])
        expected = bytes.fromhex(parts[2])
    except ValueError:
        logger.warning("Malformed password hash (bad hex) — rejecting login")
        return False
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_SCRYPT_DKLEN,
    )
    return hmac.compare_digest(derived, expected)


# ── Session tokens ────────────────────────────────────────────────────────────


def _hash_token(raw_token: str) -> str:
    """Return the sha256 hex of *raw_token* (what we store in the DB)."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _generate_raw_token() -> str:
    """Return a fresh raw session token (64 hex chars / 32 bytes)."""
    return secrets.token_hex(32)


async def create_session(db: AsyncSession, user_id: int) -> tuple[str, datetime]:
    """Create a new session for *user_id*; return ``(raw_token, expires_at)``.

    The raw token is returned to the caller (to set as a cookie) but only
    its sha256 hash is stored in the database.
    """
    raw_token = _generate_raw_token()
    token_hash = _hash_token(raw_token)
    expires_at = datetime.now(UTC) + SESSION_TTL
    db.add(Session(token_hash=token_hash, user_id=user_id, expires_at=expires_at))
    await db.flush()
    return raw_token, expires_at


async def resolve_session(db: AsyncSession, raw_token: str) -> User | None:
    """Return the :class:`User` for *raw_token* if the session is valid.

    Returns ``None`` if the token is empty, the session does not exist, or
    the session has expired (in which case it is deleted as a side effect).
    """
    if not raw_token:
        return None
    token_hash = _hash_token(raw_token)
    stmt = select(Session).where(Session.token_hash == token_hash)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    if session is None:
        return None
    # SQLite strips tzinfo on storage; normalise back to UTC for comparison.
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at <= datetime.now(UTC):
        # Expired — delete and treat as not authenticated.
        await db.delete(session)
        await db.flush()
        return None
    user_stmt = select(User).where(User.id == session.user_id)
    user_result = await db.execute(user_stmt)
    return user_result.scalar_one_or_none()


async def delete_session(db: AsyncSession, raw_token: str) -> None:
    """Delete the session for *raw_token* if it exists (logout)."""
    if not raw_token:
        return
    token_hash = _hash_token(raw_token)
    stmt = delete(Session).where(Session.token_hash == token_hash)
    await db.execute(stmt)
    await db.flush()


async def delete_user_sessions(db: AsyncSession, user_id: int) -> None:
    """Delete every session belonging to *user_id* (cascade on user delete)."""
    stmt = delete(Session).where(Session.user_id == user_id)
    await db.execute(stmt)
    await db.flush()


# ── User CRUD ─────────────────────────────────────────────────────────────────


async def count_users(db: AsyncSession) -> int:
    """Return the total number of users (for ``has_users`` + last-admin guard)."""
    stmt = select(func.count()).select_from(User)
    result = await db.execute(stmt)
    return int(result.scalar_one())


async def get_user_by_username(db: AsyncSession, username: str) -> User | None:
    """Return the user with *username* or ``None``."""
    stmt = select(User).where(User.username == username)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def get_user_by_telegram_id(db: AsyncSession, telegram_id: int) -> User | None:
    """Return the user bound to *telegram_id* (OIDC) or ``None``."""
    stmt = select(User).where(User.telegram_id == telegram_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def get_user(db: AsyncSession, user_id: int) -> User | None:
    """Return the user with *user_id* or ``None``."""
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def list_users(db: AsyncSession) -> list[User]:
    """Return all users ordered by id."""
    stmt = select(User).order_by(User.id)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def count_admins(db: AsyncSession) -> int:
    """Return the number of users with role ``'admin'`` (last-admin guard)."""
    stmt = select(func.count()).select_from(User).where(User.role == "admin")
    result = await db.execute(stmt)
    return int(result.scalar_one())


async def create_user(
    db: AsyncSession,
    *,
    username: str,
    password: str,
    role: str = "user",
    telegram_id: int | None = None,
) -> User:
    """Create a new user.  Raises :class:`StitchError` (409) on duplicate username.

    *telegram_id* optionally binds the row to a Telegram account (OIDC).
    """
    if not roles.valid_role(role):
        raise StitchError(
            f"Invalid role: {role!r} (expected one of {roles.SELECTABLE_ROLES})"
        )
    if not username or not username.strip():
        raise StitchError("Username must not be empty")
    if not password:
        raise StitchError("Password must not be empty")
    user = User(
        username=username.strip(),
        password_hash=hash_password(password),
        role=role,
        telegram_id=telegram_id,
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise StitchError(f"User already exists: {username}") from exc
    return user


async def update_user_role(db: AsyncSession, user_id: int, role: str) -> User:
    """Change a user's role (tier ladder: user<vip<premium<elite<admin).

    Raises :class:`StitchError` on unknown user, unknown role, or when
    demoting the last admin.
    """
    if not roles.valid_role(role):
        raise StitchError(
            f"Invalid role: {role!r} (expected one of {roles.SELECTABLE_ROLES})"
        )
    user = await get_user(db, user_id)
    if user is None:
        raise StitchError(f"User not found: {user_id}")
    if user.role == "admin" and role != "admin" and await count_admins(db) <= 1:
        raise StitchError("Cannot demote the last admin")
    user.role = role
    await db.flush()
    return user


async def delete_user(db: AsyncSession, user_id: int) -> None:
    """Delete a user by id.  Sessions cascade via the FK ondelete=CASCADE.

    Raises :class:`StitchError` if the user does not exist.
    """
    user = await get_user(db, user_id)
    if user is None:
        raise StitchError(f"User not found: {user_id}")
    # Sessions cascade via FK ondelete=CASCADE — but SQLite needs
    # foreign_keys=ON (already enabled in database.py) for this to fire.
    # Belt-and-braces: also delete explicitly so the cascade works even
    # if a future engine config disables FK enforcement.
    await delete_user_sessions(db, user_id)
    await db.delete(user)
    await db.flush()


# ── Login (constant-time-ish) ─────────────────────────────────────────────────


async def authenticate(db: AsyncSession, username: str, password: str) -> User:
    """Return the user if credentials are valid; raise :class:`StitchError` otherwise.

    When the user does not exist, a dummy scrypt hash is still verified so
    the response time of a missing-user login roughly matches a
    bad-password login for an existing user.  This narrows (does not
    eliminate) user enumeration via timing.
    """
    user = await get_user_by_username(db, username)
    stored_hash = user.password_hash if user is not None else _DUMMY_HASH
    # Always run scrypt — even on the dummy hash — so timing is roughly
    # constant regardless of whether the user exists.
    if not verify_password(password, stored_hash) or user is None:
        raise StitchError("Invalid username or password")
    return user


# ── Bootstrap ─────────────────────────────────────────────────────────────────


async def bootstrap_admin(db: AsyncSession, password: str) -> User | None:
    """Create the initial ``admin`` user (role=admin) if no users exist.

    Returns the created user, or ``None`` if users already exist (so the
    bootstrap is idempotent — never overwrites an existing admin).
    """
    if await count_users(db) > 0:
        return None
    logger.info("Bootstrapping initial admin user (auth_enabled=True, no users)")
    return await create_user(db, username="admin", password=password, role="admin")
