"""SQLAlchemy ORM models for the auth domain.

Two tables on the shared :class:`stitch_backend.database.Base`:

  - ``users``     — id PK, username unique indexed, password_hash, role,
    created_at.  ``role`` is ``'admin'`` or ``'user'`` (default ``'user'``).
  - ``sessions``  — id PK, token_hash unique indexed (sha256 of the raw
    token), user_id FK users.id, created_at, expires_at, preview_role.
    Raw tokens are never stored; only their sha256 hash.  ``preview_role``
    is a per-session admin role-preview (NULL when inactive).

Cascade: deleting a user cascades to their sessions.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from stitch_backend.database import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class User(Base):
    """A single authenticated user with a role."""

    __tablename__ = "auth_users"

    #: Telegram accounts bind to users via ``telegram_id`` (OIDC logins).
    #: Uniqueness is a PARTIAL unique index (NULLs allowed) so password-only
    #: users coexist; SQLite ALTER TABLE cannot add UNIQUE columns, so the
    #: constraint lives in the index, not on the column.
    __table_args__ = (
        Index(
            "uq_auth_users_telegram_id",
            "telegram_id",
            unique=True,
            sqlite_where=text("telegram_id IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(
        String, unique=True, index=True, nullable=False, comment="Unique login name"
    )
    password_hash: Mapped[str] = mapped_column(
        Text, nullable=False, comment="scrypt$<salt_hex>$<hash_hex>"
    )
    role: Mapped[str] = mapped_column(
        String, nullable=False, default="user", comment="'admin' or 'user'"
    )
    # Tier label synced from the Telegram bot's TG_TIER_MAP on each
    # login_telegram.  NULL for password-login users or when the tier
    # system is disabled.  Used by the Users page "source" display.
    tg_tier: Mapped[str | None] = mapped_column(
        String, nullable=True, comment="Tier label from TG bot (mirrors role)"
    )
    #: Stable Telegram user id (OIDC ``id`` claim) — the authoritative
    #  binding between a Telegram account and this row.  NULL for
    #  password-only users and rows created before OIDC.  Handles
    #  (usernames) change on Telegram; this id does not.
    telegram_id: Mapped[int | None] = mapped_column(
        Integer, nullable=True, index=True, comment="Telegram user id (OIDC)"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} username={self.username!r} role={self.role!r}>"


class Session(Base):
    """A login session — raw token is never stored, only its sha256 hash.

    ``preview_role`` is the per-session role preview an admin sets to
    impersonate a lower tier.  It is only honored when the real user role
    is ``'admin'``; a non-admin session with a stale ``preview_role`` has
    it cleared during resolution (see :func:`router._current_user_optional`).
    """

    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token_hash: Mapped[str] = mapped_column(
        String(64),
        unique=True,
        index=True,
        nullable=False,
        comment="sha256 hex of the raw session token",
    )
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("auth_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, comment="Session expiry (UTC)"
    )
    #: Admin role-preview (per-session).  NULL when no preview is active.
    #: Only honored when the real user role is 'admin'; sanitized by
    #: ``_current_user_optional`` for every consumer.
    preview_role: Mapped[str | None] = mapped_column(
        String, nullable=True, comment="Admin role-preview (per-session)"
    )

    def __repr__(self) -> str:
        return f"<Session id={self.id} user_id={self.user_id} expires_at={self.expires_at!r}>"


class RolePermission(Base):
    """A single (role, key) permission override in the configurable matrix.

    Composite PK ``(role, key)``.  Seeded at startup with defaults; the
    ``admin`` role is always fully allowed regardless of stored rows (hard
    rule applied in :func:`get_matrix`).  PUT /admin/permissions rejects
    edits to ``admin`` rows (immutable).
    """

    __tablename__ = "role_permissions"

    role: Mapped[str] = mapped_column(
        String, primary_key=True, nullable=False, comment="Role name (user/vip/...)"
    )
    key: Mapped[str] = mapped_column(
        String,
        primary_key=True,
        nullable=False,
        comment="Permission key (section.* / action.*)",
    )
    allowed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, comment="Whether the role may use the key"
    )

    def __repr__(self) -> str:
        return f"<RolePermission role={self.role!r} key={self.key!r} allowed={self.allowed}>"
