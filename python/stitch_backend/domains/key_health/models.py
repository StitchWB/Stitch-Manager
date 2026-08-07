"""KeyHealth SQLAlchemy ORM model — persisted health state for each API key.

Schema:
  - id                 PRIMARY KEY (auto-increment)
  - provider_id        Provider identifier (e.g. "openai", "custom_xyz")
  - key_hash           SHA256 of (provider + "\0" + secret) — never store raw key
  - status             healthy | flaky | broken | expired | unknown
  - last_checked_at    Last periodic health check attempt
  - last_tested_at     Last successful test timestamp
  - success_rate       0.0–1.0 rolling ratio of successful tests
  - avg_latency        Average latency in ms over recent tests
  - total_requests     Total times this key was used
  - total_errors       Total error responses from this key
  - models_available   JSON list of model IDs discovered at last test
  - cooldown_until     Timestamp until this key is excluded from rotation
  - created_at / updated_at
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from stitch_backend.database import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class KeyHealth(Base):
    """Persisted health state for one API key."""

    __tablename__ = "key_health"

    id: Mapped[int] = mapped_column(
        Integer, primary_key=True, autoincrement=True,
    )
    provider_id: Mapped[str] = mapped_column(
        String, nullable=False, index=True, comment="Provider identifier",
    )
    key_hash: Mapped[str] = mapped_column(
        String, nullable=False, unique=True, comment="SHA256(provider\\0secret)",
    )
    status: Mapped[str] = mapped_column(
        String, default="unknown",
        comment="healthy | flaky | broken | expired | unknown",
    )
    last_checked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), comment="Last health check attempt",
    )
    last_tested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), comment="Last successful test",
    )
    success_rate: Mapped[float] = mapped_column(
        Float, default=1.0, comment="0.0–1.0 rolling success ratio",
    )
    avg_latency: Mapped[float | None] = mapped_column(
        Float, comment="Average latency in ms over recent tests",
    )
    total_requests: Mapped[int] = mapped_column(
        Integer, default=0,
    )
    total_errors: Mapped[int] = mapped_column(
        Integer, default=0,
    )
    models_available: Mapped[dict | None] = mapped_column(
        JSON, comment="JSON list of model IDs from last test",
    )
    cooldown_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), comment="Excluded from rotation until",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow,
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=_utcnow,
    )

    def __repr__(self) -> str:
        return (
            f"<KeyHealth id={self.id!r} provider={self.provider_id!r} "
            f"status={self.status!r} success_rate={self.success_rate:.2f}>"
        )
