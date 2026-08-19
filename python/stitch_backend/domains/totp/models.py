"""TOTP key ORM model.

Stores TOTP (Time-based One-Time Password) secret keys.
The TOTP code itself is computed on the frontend using the stored secret.

Each key can optionally be linked to an account (account_id) so the
accounts list can display the current OTP code alongside the account.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from stitch_backend.database import Base
from stitch_backend.security.fernet_at_rest import EncryptedText


def _utcnow() -> datetime:
    return datetime.now(UTC)


class TotpGroupShare(Base):
    """M:N join between a TotpKey and a Group (the shared pool).

    Both FKs CASCADE: deleting a group drops its shares (keys survive);
    deleting a key drops its shares (group pool shrinks).
    """

    __tablename__ = "totp_group_shares"

    totp_key_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("totp_keys.id", ondelete="CASCADE"),
        primary_key=True,
    )
    group_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("groups.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False,
    )

    def __repr__(self) -> str:
        return (
            f"<TotpGroupShare totp_key_id={self.totp_key_id!r} "
            f"group_id={self.group_id!r}>"
        )


class TotpKey(Base):
    """Single TOTP secret key entry."""

    __tablename__ = "totp_keys"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, comment="UUID"
    )
    owner_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("auth_users.id"),
        nullable=True,
        index=True,
        comment="NULL = legacy shared (editable by anyone)",
    )
    label: Mapped[str] = mapped_column(
        String, nullable=False, comment="User-friendly label, e.g. 'My Kiro account'"
    )
    secret: Mapped[str] = mapped_column(
        EncryptedText, nullable=False, comment="Base32-encoded TOTP secret"
    )
    issuer: Mapped[str | None] = mapped_column(
        String, nullable=True, comment="Issuer name, e.g. 'Kiro', 'GitHub'"
    )
    account_id: Mapped[str | None] = mapped_column(
        String, nullable=True, index=True,
        comment="Optional FK → accounts.id; if set, shown in account row"
    )
    digits: Mapped[int] = mapped_column(
        String, default=6, comment="OTP digits (usually 6)"
    )
    period: Mapped[int] = mapped_column(
        String, default=30, comment="Time step in seconds (usually 30)"
    )
    algorithm: Mapped[str] = mapped_column(
        String, default="SHA1", comment="Hash algorithm: SHA1, SHA256, SHA512"
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, comment="Whether this key is active"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow
    )

    def __repr__(self) -> str:
        return f"<TotpKey id={self.id!r} label={self.label!r} account_id={self.account_id!r}>"
