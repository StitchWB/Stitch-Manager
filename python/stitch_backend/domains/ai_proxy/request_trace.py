"""Per-request trace ring buffer.

Bounded in-memory store of the most recent request traces:
model → target → credential → latency → failover.  Read and cleared through
the ``get_request_history`` / ``clear_request_history`` RPC commands.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Any

_MAX_RECORDS = 500


@dataclass(frozen=True)
class RequestTrace:
    model: str
    target: str
    credential_id: str
    latency_ms: float
    failover_count: int
    status: str
    timestamp: float
    requested_model: str | None = None
    served_public_model: str | None = None
    upstream_model: str | None = None
    endpoint_id: str | None = None
    lifecycle_status: str | None = None
    sticky_hit: bool = False
    failover_reasons: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            # Legacy aliases retained for existing UI/API consumers.
            "model": self.model,
            "target": self.target,
            "credential_id": self.credential_id,
            "latency_ms": self.latency_ms,
            "failover_count": self.failover_count,
            "status": self.status,
            "timestamp": self.timestamp,
            # Additive routing observability.
            "requested_model": self.requested_model,
            "served_public_model": self.served_public_model,
            "upstream_model": self.upstream_model,
            "endpoint_id": self.endpoint_id,
            "lifecycle_status": self.lifecycle_status,
            "sticky_hit": self.sticky_hit,
            "failover_reasons": list(self.failover_reasons),
        }


class RequestTraceStore:
    def __init__(self, maxlen: int = _MAX_RECORDS) -> None:
        self._records: deque[RequestTrace] = deque(maxlen=maxlen)

    def record(self, trace: RequestTrace) -> None:
        self._records.append(trace)

    def list(self, limit: int | None = None) -> list[dict[str, Any]]:
        records = list(self._records)
        records.reverse()
        if limit is not None:
            records = records[:limit]
        return [r.to_dict() for r in records]

    def clear(self) -> int:
        count = len(self._records)
        self._records.clear()
        return count


_store: RequestTraceStore | None = None


def get_request_trace_store() -> RequestTraceStore:
    global _store
    if _store is None:
        _store = RequestTraceStore()
    return _store
