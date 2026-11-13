"""Persistent per-request usage log for the native AI gateway.

One row per client request on ``/v1/chat/completions``, ``/v1/messages`` and
``/v1/responses`` (including served failovers), written by the executor or the
stream completion callback and aggregated by ``analytics.AiProxyAnalytics``.
Rows older than ``request_logs.RETENTION_DAYS`` are pruned hourly.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from stitch_backend.database import Base, UtcDateTime


def _utcnow() -> datetime:
    return datetime.now(UTC)


class AiProxyRequestLog(Base):
    """Usage record for a single AI gateway request."""

    __tablename__ = "ai_proxy_request_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(
        UtcDateTime, default=_utcnow, index=True,
    )
    model: Mapped[str] = mapped_column(
        String, nullable=False, index=True, comment="Public model slug requested by the client",
    )
    upstream_model: Mapped[str] = mapped_column(
        String, nullable=False, default="", comment="Upstream model id used for pricing",
    )
    credential_id: Mapped[str] = mapped_column(
        String, nullable=False, default="", comment="Gateway credential id",
    )
    owner_id: Mapped[int | None] = mapped_column(
        Integer, index=True, comment="Caller user id; NULL = desktop / instance-shared",
    )
    status: Mapped[str] = mapped_column(
        String, nullable=False, default="success", comment="success | error",
    )
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tokens_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    estimated_cost: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, comment="USD")
    latency_ms: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    failover_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, comment="Failed candidates before the final outcome",
    )
    error_class: Mapped[str | None] = mapped_column(
        String, comment="Classification of the final failure",
    )
