"""TOTP key ORM model.

Stores TOTP (Time-based One-Time Password) secret keys.
The TOTP code itself is computed on the frontend using the stored secret.

Each key can optionally be linked to an account (account_id) so the
accounts list can display the current OTP code alongside the account.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from stitch_backend.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TotpKey(Base):
    """Single TOTP secret key entry."""

    __tablename__ = "totp_keys"

    id: Mapped[str] = mapped_column(
        String, primary_key=True, comment="UUID"
    )
    label: Mapped[str] = mapped_column(
        String, nullable=False, comment="User-friendly label, e.g. 'My Kiro account'"
    )
    secret: Mapped[str] = mapped_column(
        Text, nullable=False, comment="Base32-encoded TOTP secret"
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
