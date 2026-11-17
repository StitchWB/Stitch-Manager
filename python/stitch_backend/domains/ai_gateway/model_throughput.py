from __future__ import annotations

import time
from collections import OrderedDict, deque
from dataclasses import dataclass

_MAX_SAMPLES_PER_MODEL = 500
_MAX_TRACKED_MODELS = 2000


@dataclass(frozen=True)
class ThroughputSample:
    timestamp: float
    endpoint_id: str
    upstream_model_id: str
    latency_ms: float
    prompt_tokens: int
    completion_tokens: int
    generation_ms: float
    tokens_per_second: float


@dataclass(frozen=True)
class ModelThroughputRow:
    model: str
    requests: int
    prompt_tokens: int
    completion_tokens: int
    avg_tps: float
    p50_tps: float
    max_tps: float
    last_used_at: float


def _p50(values: list[float]) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    rank = 0.5 * (len(values) - 1)
    lo = int(rank)
    hi = min(lo + 1, len(values) - 1)
    return values[lo] + (values[hi] - values[lo]) * (rank - lo)


class ModelThroughputRegistry:
    def __init__(
        self,
        *,
        max_samples_per_model: int = _MAX_SAMPLES_PER_MODEL,
        max_tracked_models: int = _MAX_TRACKED_MODELS,
    ) -> None:
        self._max_samples_per_model = max_samples_per_model
        self._max_tracked_models = max_tracked_models
        self._samples: OrderedDict[str, deque[ThroughputSample]] = OrderedDict()

    def record(
        self,
        model: str,
        *,
        endpoint_id: str,
        upstream_model_id: str,
        latency_ms: float,
        prompt_tokens: int,
        completion_tokens: int,
        generation_ms: float,
        timestamp: float | None = None,
    ) -> None:
        if not model:
            return
        generation_ms = max(generation_ms, 0.0)
        generation_seconds = generation_ms / 1000.0
        tokens_per_second = (
            completion_tokens / generation_seconds if generation_seconds > 0 else 0.0
        )
        sample = ThroughputSample(
            timestamp=time.time() if timestamp is None else timestamp,
            endpoint_id=endpoint_id,
            upstream_model_id=upstream_model_id,
            latency_ms=max(latency_ms, 0.0),
            prompt_tokens=max(prompt_tokens, 0),
            completion_tokens=max(completion_tokens, 0),
            generation_ms=generation_ms,
            tokens_per_second=tokens_per_second,
        )
        bucket = self._samples.get(model)
        if bucket is None:
            bucket = deque(maxlen=self._max_samples_per_model)
            self._samples[model] = bucket
            if len(self._samples) > self._max_tracked_models:
                self._samples.popitem(last=False)
        else:
            self._samples.move_to_end(model)
        bucket.append(sample)

    def snapshot(
        self,
        *,
        window_minutes: float = 60.0,
        now: float | None = None,
    ) -> list[ModelThroughputRow]:
        current = time.time() if now is None else now
        cutoff = current - max(window_minutes, 0.0) * 60.0
        rows: list[ModelThroughputRow] = []
        for model, samples in self._samples.items():
            recent = [sample for sample in samples if sample.timestamp >= cutoff]
            if not recent:
                continue
            tps_values = sorted(sample.tokens_per_second for sample in recent)
            rows.append(
                ModelThroughputRow(
                    model=model,
                    requests=len(recent),
                    prompt_tokens=sum(sample.prompt_tokens for sample in recent),
                    completion_tokens=sum(sample.completion_tokens for sample in recent),
                    avg_tps=sum(tps_values) / len(tps_values),
                    p50_tps=_p50(tps_values),
                    max_tps=tps_values[-1],
                    last_used_at=max(sample.timestamp for sample in recent),
                )
            )
        rows.sort(key=lambda row: row.last_used_at, reverse=True)
        return rows

    def clear(self) -> None:
        self._samples.clear()


model_throughput_registry = ModelThroughputRegistry()
