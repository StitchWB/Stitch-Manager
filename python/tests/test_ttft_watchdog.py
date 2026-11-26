"""TTFT watchdog and mid-stream stall protection (Phase 3A, ITEM-1).

Contract keys on the public model::

    contract: {"latency": {"maxTtftMs": 20000, "stallTimeoutMs": 30000}}

Rules under test:
* first meaningful frame late → abort BEFORE any byte reached the client,
  transparent failover to the next candidate;
* the abort is slowness, not death: nothing is written through
  ``record_result`` — no access-row marks, no credential failures, no
  breaker feed;
* mid-stream stall (after first frame) cannot fail over: the stream aborts
  and the stall is recorded as a model-level failure only;
* absent/invalid contract → no watchdog, legacy behavior.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from starlette.responses import StreamingResponse

from stitch_backend.domains.ai_gateway.adapters.base import ClassifiedError
from stitch_backend.domains.ai_proxy import key_inflight, litellm_invoke_pipeline
from stitch_backend.domains.ai_proxy.key_metrics import get_metrics_tracker
from stitch_backend.domains.ai_proxy.litellm_executor import LiteLLMExecutor
from stitch_backend.domains.ai_proxy.litellm_gateway import GatewayRequest
from stitch_backend.domains.ai_proxy.litellm_streaming import (
    TtftWatchdogError,
    prime_stream,
)
from stitch_backend.domains.ai_proxy.rate_limiter import get_rate_limiter

# ── Fakes ────────────────────────────────────────────────────────────────────


class _StreamingAdapter:
    """Adapter whose streaming invoke yields scripted lines with delays."""

    def __init__(self, script: list[tuple[float, str | None]]) -> None:
        # script entries: (delay_before, line) — line None ends the stream.
        self._script = script

    async def invoke(self, *, base_url, secret, model, messages, stream, default_headers, **kwargs):
        assert stream
        return self._stream()

    async def _stream(self):
        for delay, line in self._script:
            await asyncio.sleep(delay)
            if line is None:
                return
            yield line

    def classify_error(self, exc, *, http_status=None, response_headers=None):
        return ClassifiedError(category="unknown")


class _NonStreamAdapter:
    def __init__(self, *, delay: float, body: dict) -> None:
        self._delay = delay
        self._body = body

    async def invoke(self, *, base_url, secret, model, messages, stream, default_headers, **kwargs):
        assert not stream
        await asyncio.sleep(self._delay)
        return dict(self._body)

    def classify_error(self, exc, *, http_status=None, response_headers=None):
        return ClassifiedError(category="unknown")


def _completion_body(text: str) -> dict:
    return {
        "id": "cmpl-1",
        "object": "chat.completion",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": text}}],
        "usage": {"prompt_tokens": 2, "completion_tokens": 2},
    }


def _content_line(text: str) -> str:
    return (
        'data: {"id":"1","choices":[{"delta":{"content":"'
        + text
        + '"}}]}'
    )


_ROLE_LINE = 'data: {"id":"1","choices":[{"delta":{"role":"assistant"}}]}'


def _route(adapter, *, endpoint_id: str, credential_id: str):
    return SimpleNamespace(
        adapter=adapter,
        endpoint=SimpleNamespace(id=endpoint_id, name=endpoint_id, base_url="https://upstream.invalid"),
        credential=SimpleNamespace(id=credential_id, owner_id=None),
        upstream_model=SimpleNamespace(id=f"um-{endpoint_id}", upstream_model_id="qwen2.8"),
        secret="sk-test-secret",
        default_headers={},
        group_id_hit=None,
    )


async def _fake_run_in_session(fn):
    return await fn(AsyncMock())


async def _collect(resp) -> str:
    parts = []
    async for chunk in resp.body_iterator:
        parts.append(chunk if isinstance(chunk, str) else chunk.decode())
    return "".join(parts)


@pytest.fixture(autouse=True)
def _reset_singletons():
    get_rate_limiter().limiters.clear()
    get_metrics_tracker().metrics.clear()
    key_inflight.reset()
    litellm_invoke_pipeline._reset_latency_cache()


def _executor_with_routes(routes):
    executor = LiteLLMExecutor()
    executor._try_ai_gateway_route = AsyncMock(return_value=routes)
    executor._is_endpoint_available = AsyncMock(return_value=True)
    recorded: list[dict] = []
    executor._routing_engine = SimpleNamespace(
        record_result=AsyncMock(side_effect=lambda session, **kw: recorded.append(kw)),
    )
    return executor, recorded


def _patch_policy(monkeypatch, policy: litellm_invoke_pipeline.LatencyPolicy | None):
    async def _fake_load(model, run_in_session):
        return policy

    monkeypatch.setattr(litellm_invoke_pipeline, "load_latency_policy", _fake_load)


async def _chat(executor, *, stream: bool):
    payload = GatewayRequest(
        model="qwen2.8", messages=[{"role": "user", "content": "hi"}],
        stream=stream, max_wait_seconds=0,
    )
    with patch("stitch_backend.domains.ai_proxy.litellm_executor.run_in_session", _fake_run_in_session):
        return await executor.chat(payload)


# ── Contract parsing ─────────────────────────────────────────────────────────


def test_parse_latency_policy_valid() -> None:
    policy = litellm_invoke_pipeline.parse_latency_policy(
        {"latency": {"maxTtftMs": 20000, "stallTimeoutMs": 30000}},
    )
    assert policy is not None
    assert policy.max_ttft_ms == 20000.0
    assert policy.stall_timeout_ms == 30000.0
    assert policy.ttft_seconds() == 20.0
    assert policy.stall_seconds() == 30.0


@pytest.mark.parametrize(
    "contract",
    [
        None,
        {},
        {"latency": None},
        {"latency": "junk"},
        {"latency": {}},
        {"latency": {"maxTtftMs": "20000"}},
        {"latency": {"maxTtftMs": -5}},
        {"latency": {"maxTtftMs": 0}},
        {"latency": {"maxTtftMs": True}},
        {"latency": {"stallTimeoutMs": None}},
        {"other": {"maxTtftMs": 1}},
    ],
)
def test_parse_latency_policy_invalid_means_no_watchdog(contract) -> None:
    assert litellm_invoke_pipeline.parse_latency_policy(contract) is None


def test_parse_latency_policy_partial() -> None:
    policy = litellm_invoke_pipeline.parse_latency_policy({"latency": {"maxTtftMs": 5000}})
    assert policy is not None
    assert policy.max_ttft_ms == 5000.0
    assert policy.stall_timeout_ms is None
    policy = litellm_invoke_pipeline.parse_latency_policy({"latency": {"stallTimeoutMs": 5000}})
    assert policy is not None
    assert policy.max_ttft_ms is None
    assert policy.stall_timeout_ms == 5000.0


# ── prime_stream unit tests ──────────────────────────────────────────────────


async def test_prime_stream_times_out_on_silence() -> None:
    async def silent():
        await asyncio.sleep(5)
        yield _content_line("late")

    with pytest.raises(TtftWatchdogError):
        await prime_stream(silent(), first_frame_timeout=0.05)


async def test_prime_stream_role_frame_does_not_count_as_meaningful() -> None:
    async def role_then_silence():
        yield _ROLE_LINE
        await asyncio.sleep(5)
        yield _content_line("late")

    from stitch_backend.domains.ai_proxy.litellm_streaming import _openai_frame_has_content

    with pytest.raises(TtftWatchdogError):
        await prime_stream(
            role_then_silence(),
            first_frame_timeout=0.05,
            content_check=_openai_frame_has_content,
        )


async def test_prime_stream_content_within_budget_passes() -> None:
    async def quick():
        yield _ROLE_LINE
        await asyncio.sleep(0.01)
        yield _content_line("hi")
        yield "data: [DONE]"

    from stitch_backend.domains.ai_proxy.litellm_streaming import _openai_frame_has_content

    primed = await prime_stream(
        quick(), first_frame_timeout=1.0, content_check=_openai_frame_has_content,
    )
    lines = [line async for line in primed]
    # Both buffered lines replayed, then the rest of the stream.
    assert lines[0] == _ROLE_LINE
    assert lines[1] == _content_line("hi")
    assert lines[2] == "data: [DONE]"


async def test_prime_stream_legacy_behavior_without_timeout() -> None:
    async def quick():
        yield _ROLE_LINE
        yield "data: [DONE]"

    primed = await prime_stream(quick())
    lines = [line async for line in primed]
    assert lines[0] == _ROLE_LINE


# ── Streaming failover integration ───────────────────────────────────────────


async def test_streaming_ttft_watchdog_fails_over_without_health_recording(monkeypatch) -> None:
    slow = _StreamingAdapter([(0.5, _content_line("slow")), (0.0, "data: [DONE]")])
    fast = _StreamingAdapter([(0.0, _content_line("hello")), (0.0, "data: [DONE]")])
    executor, recorded = _executor_with_routes([
        _route(slow, endpoint_id="ep-1", credential_id="cred-1"),
        _route(fast, endpoint_id="ep-2", credential_id="cred-2"),
    ])
    _patch_policy(monkeypatch, litellm_invoke_pipeline.LatencyPolicy(80.0, None))

    result = await _chat(executor, stream=True)

    assert isinstance(result, StreamingResponse)
    body = await _collect(result)
    assert "hello" in body
    assert "slow" not in body

    # The watchdog abort wrote NOTHING to health state: slow ≠ dead.
    cred1 = [r for r in recorded if r.get("credential_id") == "cred-1"]
    assert cred1 == [], f"watchdog abort must not reach record_result: {cred1}"
    cred2 = [r for r in recorded if r.get("credential_id") == "cred-2"]
    assert any(r.get("error") is None for r in cred2), "provider 2 success was not recorded"


async def test_streaming_role_frame_then_silence_fails_over(monkeypatch) -> None:
    trickle = _StreamingAdapter([(0.0, _ROLE_LINE), (0.5, _content_line("slow"))])
    fast = _StreamingAdapter([(0.0, _content_line("hello")), (0.0, "data: [DONE]")])
    executor, recorded = _executor_with_routes([
        _route(trickle, endpoint_id="ep-1", credential_id="cred-1"),
        _route(fast, endpoint_id="ep-2", credential_id="cred-2"),
    ])
    _patch_policy(monkeypatch, litellm_invoke_pipeline.LatencyPolicy(80.0, None))

    result = await _chat(executor, stream=True)

    body = await _collect(result)
    assert "hello" in body
    cred1 = [r for r in recorded if r.get("credential_id") == "cred-1"]
    assert cred1 == []


async def test_streaming_fast_first_frame_no_abort(monkeypatch) -> None:
    fast = _StreamingAdapter([(0.0, _content_line("hello")), (0.0, "data: [DONE]")])
    executor, recorded = _executor_with_routes([
        _route(fast, endpoint_id="ep-1", credential_id="cred-1"),
    ])
    _patch_policy(monkeypatch, litellm_invoke_pipeline.LatencyPolicy(5000.0, None))

    result = await _chat(executor, stream=True)
    body = await _collect(result)
    assert "hello" in body
    cred1 = [r for r in recorded if r.get("credential_id") == "cred-1"]
    assert any(r.get("error") is None for r in cred1)


async def test_no_contract_no_watchdog(monkeypatch) -> None:
    slowish = _StreamingAdapter([(0.2, _content_line("slow-but-fine")), (0.0, "data: [DONE]")])
    executor, recorded = _executor_with_routes([
        _route(slowish, endpoint_id="ep-1", credential_id="cred-1"),
    ])
    _patch_policy(monkeypatch, None)

    result = await _chat(executor, stream=True)
    body = await _collect(result)
    assert "slow-but-fine" in body


# ── Non-stream integration ───────────────────────────────────────────────────


async def test_nonstream_ttft_watchdog_aborts_and_fails_over(monkeypatch) -> None:
    slow = _NonStreamAdapter(delay=0.5, body=_completion_body("slow"))
    fast = _NonStreamAdapter(delay=0.0, body=_completion_body("fast answer"))
    executor, recorded = _executor_with_routes([
        _route(slow, endpoint_id="ep-1", credential_id="cred-1"),
        _route(fast, endpoint_id="ep-2", credential_id="cred-2"),
    ])
    _patch_policy(monkeypatch, litellm_invoke_pipeline.LatencyPolicy(80.0, None))

    result = await _chat(executor, stream=False)

    assert isinstance(result, dict)
    assert result["choices"][0]["message"]["content"] == "fast answer"
    cred1 = [r for r in recorded if r.get("credential_id") == "cred-1"]
    assert cred1 == [], f"watchdog abort must not reach record_result: {cred1}"


async def test_nonstream_within_budget_no_abort(monkeypatch) -> None:
    fast = _NonStreamAdapter(delay=0.01, body=_completion_body("fast answer"))
    executor, recorded = _executor_with_routes([
        _route(fast, endpoint_id="ep-1", credential_id="cred-1"),
    ])
    _patch_policy(monkeypatch, litellm_invoke_pipeline.LatencyPolicy(5000.0, None))

    result = await _chat(executor, stream=False)
    assert result["choices"][0]["message"]["content"] == "fast answer"


# ── Mid-stream stall ─────────────────────────────────────────────────────────


async def test_midstream_stall_aborts_stream_and_records_model_level(monkeypatch) -> None:
    """After the first frame the client holds bytes — no failover, abort only.

    The stall is a reliability signal recorded as a *model-level* failure:
    is_model_specific, not endpoint-wide, never credential blame.
    """
    stall = _StreamingAdapter([(0.0, _content_line("start")), (0.5, _content_line("never"))])
    executor, recorded = _executor_with_routes([
        _route(stall, endpoint_id="ep-1", credential_id="cred-1"),
    ])
    _patch_policy(monkeypatch, litellm_invoke_pipeline.LatencyPolicy(None, 80.0))

    result = await _chat(executor, stream=True)
    assert isinstance(result, StreamingResponse)
    body = await _collect(result)
    assert "start" in body
    assert "never" not in body
    # Stream terminated per protocol instead of hanging forever.
    assert body.rstrip().endswith("data: [DONE]")

    cred1 = [r for r in recorded if r.get("credential_id") == "cred-1"]
    stall_records = [
        r for r in cred1
        if r.get("error") is not None and getattr(r["error"], "error_code", None) == "stream_stall"
    ]
    assert stall_records, f"stall was not recorded: {cred1}"
    error = stall_records[0]["error"]
    assert error.is_model_specific is True
    assert error.is_endpoint_wide is False
    # No success is written at prime time: the stall record is the only health
    # write for this stream and must be the model-level failure asserted above.
    assert len(cred1) == len(stall_records)


async def test_pre_first_byte_stall_fails_over_without_recording(monkeypatch) -> None:
    """Only stallTimeoutMs configured: a totally silent stream is bounded too,
    and because no byte reached the client the failover is transparent and
    nothing is recorded (slowness, not death)."""
    silent = _StreamingAdapter([(0.5, _content_line("too-late"))])
    fast = _StreamingAdapter([(0.0, _content_line("hello")), (0.0, "data: [DONE]")])
    executor, recorded = _executor_with_routes([
        _route(silent, endpoint_id="ep-1", credential_id="cred-1"),
        _route(fast, endpoint_id="ep-2", credential_id="cred-2"),
    ])
    _patch_policy(monkeypatch, litellm_invoke_pipeline.LatencyPolicy(None, 80.0))

    result = await _chat(executor, stream=True)
    body = await _collect(result)
    assert "hello" in body
    cred1 = [r for r in recorded if r.get("credential_id") == "cred-1"]
    assert cred1 == [], f"pre-first-byte stall must not reach record_result: {cred1}"


# ── Stream completion ownership (Integ-III) ─────────────────────────────────


async def test_streaming_inflight_slot_held_until_stream_completion() -> None:
    adapter = _StreamingAdapter([
        (0.0, _content_line("hello")),
        (0.08, "data: [DONE]"),
    ])
    executor, _recorded = _executor_with_routes([
        _route(adapter, endpoint_id="ep-1", credential_id="cred-1"),
    ])

    result = await _chat(executor, stream=True)

    # ``chat()`` returns right after stream prime, while upstream generation is
    # still ongoing.  The credential concurrency slot must therefore still be
    # occupied; releasing at prime time was the Integ-III undercounting bug.
    assert key_inflight.in_flight("cred-1") == 1
    body = await _collect(result)
    assert "hello" in body
    assert key_inflight.in_flight("cred-1") == 0


async def test_streaming_success_recorded_once_at_completion_not_prime() -> None:
    adapter = _StreamingAdapter([(0.0, _content_line("hello")), (0.0, "data: [DONE]")])
    executor, recorded = _executor_with_routes([
        _route(adapter, endpoint_id="ep-1", credential_id="cred-1"),
    ])

    result = await _chat(executor, stream=True)
    assert recorded == [], "prime-time liveness must not count as success evidence"
    body = await _collect(result)
    assert "hello" in body

    cred1 = [r for r in recorded if r.get("credential_id") == "cred-1"]
    assert len(cred1) == 1
    assert cred1[0]["error"] is None


async def test_empty_completion_stream_records_no_success_evidence() -> None:
    adapter = _StreamingAdapter([(0.0, _ROLE_LINE), (0.0, "data: [DONE]")])
    executor, recorded = _executor_with_routes([
        _route(adapter, endpoint_id="ep-1", credential_id="cred-1"),
    ])

    result = await _chat(executor, stream=True)
    assert recorded == []
    await _collect(result)

    cred1 = [r for r in recorded if r.get("credential_id") == "cred-1"]
    assert len(cred1) == 1
    assert cred1[0]["error"] is not None
    assert not [r for r in cred1 if r.get("error") is None]


async def test_concurrent_streaming_requests_enforce_inflight_cap_for_stream_duration(
    monkeypatch,
) -> None:
    adapter = _StreamingAdapter([
        (0.0, _content_line("hello")),
        (0.08, "data: [DONE]"),
    ])
    executor, _recorded = _executor_with_routes([
        _route(adapter, endpoint_id="ep-1", credential_id="cred-1"),
    ])
    real_try_acquire = key_inflight.try_acquire

    def try_acquire_cap_one(
        credential_id,
        upstream_model_id=None,
        *,
        cap=key_inflight.PER_CREDENTIAL_CAP,
        distinct_model_cap=None,
    ):
        return real_try_acquire(
            credential_id,
            upstream_model_id,
            cap=1,
            distinct_model_cap=distinct_model_cap,
        )

    monkeypatch.setattr(key_inflight, "try_acquire", try_acquire_cap_one)

    first = await _chat(executor, stream=True)
    assert key_inflight.in_flight("cred-1") == 1

    # The second logical request is rejected while the first upstream stream is
    # still generating; before Integ-III the first slot vanished at prime time
    # and this request incorrectly consumed concurrent capacity.
    with pytest.raises(Exception):
        await _chat(executor, stream=True)

    await _collect(first)
    assert key_inflight.in_flight("cred-1") == 0

    second = await _chat(executor, stream=True)
    assert key_inflight.in_flight("cred-1") == 1
    await _collect(second)
    assert key_inflight.in_flight("cred-1") == 0
