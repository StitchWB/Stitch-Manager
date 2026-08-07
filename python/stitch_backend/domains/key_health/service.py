"""KeyHealthService — CRUD and query operations on the key_health table.

Uses the ORM model for persistence, accessed via ``run_in_session()``.
Key hashes (SHA256) are used instead of raw keys for security.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from stitch_backend.domains.key_health.models import KeyHealth

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


def hash_key(provider: str, secret: str) -> str:
    """Compute a stable SHA256 hash for a provider + secret pair."""
    return hashlib.sha256(f"{provider.lower()}\0{secret}".encode()).hexdigest()


def _utcnow() -> datetime:
    return datetime.now(UTC)


class KeyHealthService:
    """Persisted health tracking for API keys."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # ── Upsert ──────────────────────────────────────────────────────────────────

    async def upsert_health(
        self,
        provider_id: str,
        key_hash: str,
        *,
        status: str = "unknown",
        models_available: list | None = None,
    ) -> KeyHealth:
        """Create or update a health record for a key hash."""
        result = await self._db.execute(
            select(KeyHealth).where(KeyHealth.key_hash == key_hash),
        )
        existing = result.scalar_one_or_none()

        if existing is not None:
            existing.provider_id = provider_id
            existing.status = status
            existing.updated_at = _utcnow()
            if models_available is not None:
                existing.models_available = models_available
            await self._db.flush()
            return existing

        record = KeyHealth(
            provider_id=provider_id,
            key_hash=key_hash,
            status=status,
            models_available=models_available,
            created_at=_utcnow(),
            updated_at=_utcnow(),
        )
        self._db.add(record)
        await self._db.flush()
        return record

    # ── Read ────────────────────────────────────────────────────────────────────

    async def get_health(self, key_hash: str) -> KeyHealth | None:
        """Get a single health record by key hash."""
        result = await self._db.execute(
            select(KeyHealth).where(KeyHealth.key_hash == key_hash),
        )
        return result.scalar_one_or_none()

    async def get_provider_health(
        self, provider_id: str,
    ) -> list[KeyHealth]:
        """Get all health records for a provider."""
        result = await self._db.execute(
            select(KeyHealth).where(KeyHealth.provider_id == provider_id),
        )
        return list(result.scalars().all())

    async def get_all_health(self) -> list[KeyHealth]:
        """Get all health records."""
        result = await self._db.execute(select(KeyHealth))
        return list(result.scalars().all())

    async def get_keys_needing_check(
        self, *, stale_seconds: int = 300,
    ) -> list[KeyHealth]:
        """Get records whose last_checked_at is older than stale_seconds."""
        cutoff = datetime.fromtimestamp(
            _utcnow().timestamp() - stale_seconds, tz=UTC,
        )
        result = await self._db.execute(
            select(KeyHealth).where(
                (KeyHealth.last_checked_at == None)  # noqa: E711
                | (KeyHealth.last_checked_at < cutoff),
            ),
        )
        return list(result.scalars().all())

    # ── Update status ───────────────────────────────────────────────────────────

    async def update_status(
        self,
        key_hash: str,
        status: str,
        *,
        cooldown_until: datetime | None = None,
    ) -> None:
        """Update the status (and optional cooldown) for a key."""
        result = await self._db.execute(
            select(KeyHealth).where(KeyHealth.key_hash == key_hash),
        )
        record = result.scalar_one_or_none()
        if record is None:
            return
        record.status = status
        if cooldown_until is not None:
            record.cooldown_until = cooldown_until
        record.updated_at = _utcnow()
        await self._db.flush()

    # ── Record test result ──────────────────────────────────────────────────────

    async def record_test_result(
        self,
        key_hash: str,
        *,
        success: bool,
        latency_ms: float,
        models_available: list | None = None,
        error: str | None = None,
        http_status: int | None = None,
    ) -> None:
        """Record a periodic health check result.

        Status is mapped to the frontend's ``KeyHealthStatus`` enum
        (``healthy | flaky | broken | expired | unknown``):
          - ``success=True``               → ``healthy``
          - ``success_rate < 0.5``         → ``broken``
          - ``0.5 <= success_rate < 0.8``  → ``flaky``
          - ``success_rate >= 0.8``        → ``healthy``
          - auth/expiry failure (401/403)  → ``expired`` (overrides the above)
        """
        result = await self._db.execute(
            select(KeyHealth).where(KeyHealth.key_hash == key_hash),
        )
        record = result.scalar_one_or_none()
        if record is None:
            return

        now = _utcnow()
        record.last_checked_at = now
        record.total_requests = (record.total_requests or 0) + 1

        if success:
            record.last_tested_at = now
            # Exponential moving average for latency
            prev_lat = record.avg_latency or 0.0
            record.avg_latency = prev_lat * 0.7 + latency_ms * 0.3
            if models_available is not None:
                record.models_available = models_available
            record.status = "healthy"
            record.cooldown_until = None
        else:
            record.total_errors = (record.total_errors or 0) + 1
            # Update success_rate with exponential decay
            prev_rate = record.success_rate or 1.0
            record.success_rate = prev_rate * 0.9

            is_expired = http_status in (401, 403) or (
                error is not None and ("HTTP 401" in error or "HTTP 403" in error)
            )

            if is_expired:
                record.status = "expired"
            elif record.success_rate < 0.5:
                record.status = "broken"
            elif record.success_rate < 0.8:
                record.status = "flaky"
            else:
                record.status = "healthy"

        record.updated_at = now
        await self._db.flush()

    # ── Serialisation helpers ───────────────────────────────────────────────────

    @staticmethod
    def to_dict(record: KeyHealth) -> dict[str, Any]:
        """Convert a KeyHealth ORM record to a JSON-safe dict."""
        return {
            "id": record.id,
            "providerId": record.provider_id,
            "keyHash": record.key_hash,
            "status": record.status,
            "lastCheckedAt": record.last_checked_at.isoformat()
            if record.last_checked_at else None,
            "lastTestedAt": record.last_tested_at.isoformat()
            if record.last_tested_at else None,
            "successRate": record.success_rate,
            "avgLatency": record.avg_latency,
            "totalRequests": record.total_requests,
            "totalErrors": record.total_errors,
            "modelsAvailable": record.models_available,
            "cooldownUntil": record.cooldown_until.isoformat()
            if record.cooldown_until else None,
            "createdAt": record.created_at.isoformat(),
            "updatedAt": record.updated_at.isoformat() if record.updated_at else None,
        }
