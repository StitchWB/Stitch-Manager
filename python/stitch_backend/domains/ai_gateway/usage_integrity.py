"""Passive per-endpoint usage-integrity suspicion registry.

Some upstreams serve fabricated usage arithmetic with HTTP 200 — e.g.
``prompt_tokens_details.cached_tokens`` greater than ``prompt_tokens``,
which is arithmetically impossible for any real inference server, or
``prompt_tokens`` of 1 for a multi-token prompt.  Such responses are not a
transport failure and must never fail the user-visible request, but the
fabricated numbers must not feed cost/ledger accounting as truth, and the
endpoint must accumulate observable suspicion evidence.

This module is the recording half of that defense, patterned on
``model_latency``: a small bounded in-memory registry keyed by
``(endpoint_id, upstream model row id)``.  It is deliberately separate from
health state — suspicion is observability data only, never a lifecycle or
routing signal.  In-memory by design: restart loss is acceptable for a
best-effort telemetry signal (same trade-off as the TTFT tracker).
"""

from __future__ import annotations

import time
from collections import OrderedDict
from dataclasses import dataclass, field

_MAX_TRACKED_PAIRS = 4096


@dataclass
class SuspicionEntry:
    endpoint_id: str
    upstream_model_id: str
    reason: str
    count: int = 0
    first_seen: float = 0.0
    last_seen: float = 0.0
    detail: str | None = field(default=None)

    def snapshot(self) -> dict[str, object]:
        return {
            "endpoint_id": self.endpoint_id,
            "upstream_model_id": self.upstream_model_id,
            "reason": self.reason,
            "count": self.count,
            "first_seen": self.first_seen,
            "last_seen": self.last_seen,
            "detail": self.detail,
        }


class UsageIntegrityTracker:
    """Bounded suspicion registry keyed by ``(endpoint_id, upstream row id)``.

    ``record`` increments the ``(pair, reason)`` counter; repeated evidence
    of the same kind accumulates rather than duplicating entries.
    """

    def __init__(self, *, max_pairs: int = _MAX_TRACKED_PAIRS) -> None:
        self._max_pairs = max_pairs
        self._entries: OrderedDict[tuple[str, str, str], SuspicionEntry] = OrderedDict()

    def record(
        self,
        endpoint_id: str,
        upstream_model_id: str,
        reason: str,
        *,
        detail: str | None = None,
        now: float | None = None,
    ) -> None:
        if not endpoint_id or not reason:
            return
        ts = time.time() if now is None else now
        key = (endpoint_id, upstream_model_id, reason)
        entry = self._entries.get(key)
        if entry is None:
            if len(self._entries) >= self._max_pairs:
                # Evict the least recently updated entry — the bound keeps a
                # pathological multi-endpoint deployment from growing the
                # registry without limit.
                self._entries.popitem(last=False)
            entry = SuspicionEntry(
                endpoint_id=endpoint_id,
                upstream_model_id=upstream_model_id,
                reason=reason,
                first_seen=ts,
            )
            self._entries[key] = entry
        else:
            self._entries.move_to_end(key)
        entry.count += 1
        entry.last_seen = ts
        if detail is not None:
            entry.detail = detail

    def snapshot(self, endpoint_id: str | None = None) -> list[dict[str, object]]:
        """All recorded suspicion entries, optionally filtered by endpoint."""
        return [
            entry.snapshot()
            for (ep, _um, _reason), entry in self._entries.items()
            if endpoint_id is None or ep == endpoint_id
        ]

    def reset(self) -> None:
        """Clear all entries. Intended for tests."""
        self._entries.clear()


usage_integrity_tracker = UsageIntegrityTracker()
