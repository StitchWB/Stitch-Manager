"""Passive per-(credential, upstream-model) TTFT observations.

The router uses this small in-memory rolling registry only as an ordering
hint.  It is deliberately separate from health state: slowness is not death,
unknown is not slow, and lifecycle demotion for persistent slowness is outside
this integration phase.
"""

from __future__ import annotations

import math
import time
from collections import OrderedDict, deque
from dataclasses import dataclass

_TTFT_WINDOW_SECONDS = 900.0
_TTFT_MAX_SAMPLES = 100
_MAX_TRACKED_PAIRS = 4096
MIN_TTFT_OBSERVATIONS = 3
# 250 ms is the neutral interactive baseline.  Values within a 1.5x ratio land
# in the same ordering band, providing hysteresis against one-sample flapping.
_TTFT_REFERENCE_MS = 250.0
_TTFT_HYSTERESIS_RATIO = 1.5


@dataclass(frozen=True)
class TtftSnapshot:
    count: int
    avg_ms: float
    p50_ms: float

    @property
    def usable(self) -> bool:
        return self.count >= MIN_TTFT_OBSERVATIONS


def _percentile(sorted_values: list[float], percentile: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    rank = (percentile / 100.0) * (len(sorted_values) - 1)
    lo = int(rank)
    hi = min(lo + 1, len(sorted_values) - 1)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (rank - lo)


def latency_band(ttft_ms: float) -> int:
    """Coarse log-ratio band used by routing as a hysteresis mechanism."""
    value = max(float(ttft_ms), 1.0)
    return int(round(math.log(value / _TTFT_REFERENCE_MS, _TTFT_HYSTERESIS_RATIO)))


class ModelLatencyTracker:
    """Bounded rolling TTFT registry keyed by ``(credential_id, upstream row id)``."""

    def __init__(
        self,
        *,
        window_seconds: float = _TTFT_WINDOW_SECONDS,
        max_samples: int = _TTFT_MAX_SAMPLES,
        max_pairs: int = _MAX_TRACKED_PAIRS,
    ) -> None:
        self._window_seconds = window_seconds
        self._max_samples = max_samples
        self._max_pairs = max_pairs
        self._samples: OrderedDict[tuple[str, str], deque[tuple[float, float]]] = OrderedDict()

    def record(
        self,
        credential_id: str,
        upstream_model_id: str,
        ttft_ms: float,
        *,
        now: float | None = None,
    ) -> None:
        if not credential_id or not upstream_model_id:
            return
        if not math.isfinite(ttft_ms) or ttft_ms < 0:
            return
        ts = time.monotonic() if now is None else now
        key = (credential_id, upstream_model_id)
        bucket = self._samples.get(key)
        if bucket is None:
            bucket = deque(maxlen=self._max_samples)
            self._samples[key] = bucket
            if len(self._samples) > self._max_pairs:
                self._samples.popitem(last=False)
        else:
            self._samples.move_to_end(key)
        bucket.append((ts, float(ttft_ms)))

    def snapshot(
        self,
        credential_id: str,
        upstream_model_id: str,
        *,
        now: float | None = None,
    ) -> TtftSnapshot:
        ts = time.monotonic() if now is None else now
        cutoff = ts - self._window_seconds
        values = [
            value
            for sample_ts, value in self._samples.get((credential_id, upstream_model_id), ())
            if sample_ts >= cutoff
        ]
        if not values:
            return TtftSnapshot(0, 0.0, 0.0)
        return TtftSnapshot(
            count=len(values),
            avg_ms=sum(values) / len(values),
            p50_ms=_percentile(sorted(values), 50),
        )

    def ordering_band(
        self,
        credential_id: str,
        upstream_model_id: str,
        *,
        now: float | None = None,
    ) -> int:
        """Latency ordering band; zero means unknown/neutral.

        Bands are signed: fast known pairs sort before unknown pairs and slow
        known pairs after them.  Requiring ``MIN_TTFT_OBSERVATIONS`` prevents
        cold-start penalties, while the ratio quantization prevents constant
        reordering on insignificant TTFT differences.
        """
        snap = self.snapshot(credential_id, upstream_model_id, now=now)
        if not snap.usable:
            return 0
        return latency_band(snap.p50_ms)

    def reset(self) -> None:
        self._samples.clear()


model_latency_tracker = ModelLatencyTracker()
