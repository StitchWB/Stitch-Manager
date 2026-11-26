"""Regression tests for inference-integrity defenses.

Forensic background: some upstreams serve fabricated usage arithmetic
(``cached_tokens > prompt_tokens`` — arithmetically impossible for any real
inference server) and plausible-but-collapsed garbage text with HTTP 200.
Treating any 200 as healthy lets fake inference pass as green.

Defense A — ``_sanitize_usage_arithmetic`` in the invoke pipeline validates
usage arithmetic of upstream responses, records a suspicion signal against
the endpoint, and strips fabricated ``prompt_tokens_details`` so downstream
cost/ledger accounting never consumes fake cache numbers.  The user-visible
request never fails over this — observability + sanitization only.

Defense B — exact probes in the ProbeWorker use a coherence canary: the
prompt asks for one specific word and the probe only passes when the
response content contains it.  Empty content or a missing canary is probe
failure evidence feeding the existing demote lifecycle.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from stitch_backend.domains.ai_gateway.usage_integrity import usage_integrity_tracker
from stitch_backend.domains.ai_proxy.litellm_invoke_pipeline import (
    _cached_tokens,
    _sanitize_usage_arithmetic,
)


@pytest.fixture(autouse=True)
def _reset_integrity_tracker():
    usage_integrity_tracker.reset()
    yield
    usage_integrity_tracker.reset()


def _routing_result(endpoint_id: str = "ep-1", row_id: str = "um-1") -> Any:
    return SimpleNamespace(
        endpoint=SimpleNamespace(id=endpoint_id, name="test-endpoint"),
        upstream_model=SimpleNamespace(id=row_id, upstream_model_id="fake-model"),
        credential=SimpleNamespace(id="cred-1", account_group=None),
    )


def _response(*, prompt_tokens: int, completion_tokens: int = 5,
              cached_tokens: int | None = None, content: str = "hello there") -> dict[str, Any]:
    usage: dict[str, Any] = {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
    }
    if cached_tokens is not None:
        usage["prompt_tokens_details"] = {"cached_tokens": cached_tokens}
    return {
        "id": "chatcmpl-1",
        "object": "chat.completion",
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": content},
            "finish_reason": "stop",
        }],
        "usage": usage,
    }


# ═══════════════════════════════════════════════════════════════════════════
# Defense A — usage arithmetic validation
# ═══════════════════════════════════════════════════════════════════════════


def test_fabricated_cached_tokens_stripped_and_signaled() -> None:
    """cached_tokens > prompt_tokens is arithmetically impossible — fabrication."""
    result = _response(prompt_tokens=4, cached_tokens=8)
    _sanitize_usage_arithmetic(result, _routing_result())

    usage = result["usage"]
    assert "prompt_tokens_details" not in usage, "fabricated cache details must be stripped"
    assert usage["prompt_tokens"] == 4, "prompt_tokens itself is left for observability"

    signals = usage_integrity_tracker.snapshot()
    assert len(signals) == 1
    assert signals[0]["endpoint_id"] == "ep-1"
    assert signals[0]["reason"] == "cached_exceeds_prompt"


def test_fabricated_usage_content_untouched() -> None:
    """Sanitization never touches the user-visible completion content."""
    result = _response(prompt_tokens=4, cached_tokens=8, content="the answer text")
    before = result["choices"][0]["message"]["content"]
    _sanitize_usage_arithmetic(result, _routing_result())
    assert result["choices"][0]["message"]["content"] == before
    assert result["choices"][0]["finish_reason"] == "stop"


def test_ledger_never_consumes_fake_cached_tokens() -> None:
    """After sanitization the ledger extraction path sees zero cached tokens."""
    result = _response(prompt_tokens=4, cached_tokens=8)
    assert _cached_tokens(result) == 8, "precondition: fabricated value visible before sanitize"
    _sanitize_usage_arithmetic(result, _routing_result())
    assert _cached_tokens(result) == 0


def test_legit_cache_usage_untouched() -> None:
    """cached_tokens <= prompt_tokens is legal prefix caching — no false positive."""
    result = _response(prompt_tokens=100, cached_tokens=80)
    _sanitize_usage_arithmetic(result, _routing_result())
    assert result["usage"]["prompt_tokens_details"] == {"cached_tokens": 80}
    assert usage_integrity_tracker.snapshot() == []


def test_no_usage_details_untouched() -> None:
    result = _response(prompt_tokens=10)
    _sanitize_usage_arithmetic(result, _routing_result())
    assert "prompt_tokens_details" not in result["usage"]
    assert usage_integrity_tracker.snapshot() == []


def test_low_prompt_tokens_with_substantial_request_signaled() -> None:
    """prompt_tokens <= 1 for a multi-token prompt is fabrication evidence."""
    result = _response(prompt_tokens=1)
    # ~150 chars of request text can never tokenize to a single token.
    _sanitize_usage_arithmetic(result, _routing_result(), request_text_chars=150)
    signals = usage_integrity_tracker.snapshot()
    assert len(signals) == 1
    assert signals[0]["reason"] == "implausibly_low_prompt_tokens"


def test_low_prompt_tokens_short_request_no_false_positive() -> None:
    """A genuinely tiny prompt ('hi') can legitimately tokenize to 1 token."""
    result = _response(prompt_tokens=1)
    _sanitize_usage_arithmetic(result, _routing_result(), request_text_chars=2)
    assert usage_integrity_tracker.snapshot() == []


def test_zero_prompt_tokens_not_flagged_when_usage_absent_or_malformed() -> None:
    """Missing/odd usage shapes must never raise — observability only."""
    _sanitize_usage_arithmetic({}, _routing_result())
    _sanitize_usage_arithmetic({"usage": None}, _routing_result())
    _sanitize_usage_arithmetic({"usage": "bogus"}, _routing_result())
    _sanitize_usage_arithmetic("not-a-dict", _routing_result())
    assert usage_integrity_tracker.snapshot() == []


def test_tracker_accumulates_repeated_signals() -> None:
    import copy

    result = _response(prompt_tokens=4, cached_tokens=8)
    routing = _routing_result()
    # Deep copies: sanitization strips the details in place, so a shallow
    # copy would share the already-stripped usage dict.
    _sanitize_usage_arithmetic(copy.deepcopy(result), routing)
    _sanitize_usage_arithmetic(copy.deepcopy(result), routing)
    signals = usage_integrity_tracker.snapshot()
    assert len(signals) == 1
    assert signals[0]["count"] == 2


# ═══════════════════════════════════════════════════════════════════════════
# Defense B — probe canary coherence
# ═══════════════════════════════════════════════════════════════════════════


class _CanaryEchoAdapter:
    """Coherent upstream double: parses the requested word and replies with it."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def invoke(self, *, base_url, secret, model, messages, stream, default_headers, **kwargs):
        self.calls.append({"model": model, "messages": messages, "kwargs": kwargs})
        prompt = messages[0]["content"]
        # A coherent upstream does what the prompt asks: echo the quoted word.
        word = prompt.split('"')[1]
        return {"choices": [{"message": {"role": "assistant", "content": word}}]}

    def classify_error(self, exc, **_kwargs):
        raise AssertionError("no error expected")


class _ScriptedAdapter:
    """Upstream double returning a fixed scripted body regardless of the prompt."""

    def __init__(self, body: dict[str, Any]) -> None:
        self.body = body

    async def invoke(self, *, base_url, secret, model, messages, stream, default_headers, **kwargs):
        return self.body

    def classify_error(self, exc, **_kwargs):
        raise AssertionError("no error expected")


def _probe_target() -> dict[str, Any]:
    return {
        "credential_id": "cred-1",
        "endpoint_id": "ep-1",
        "upstream_row_id": "um-1",
        "upstream_model_id": "fake-model",
        "adapter_type": "openai_compatible",
        "base_url": "https://api.test/v1",
        "secret": "sk-test",
        "default_headers": {},
    }


async def _run_probe(monkeypatch, adapter) -> dict[str, Any]:
    from stitch_backend.domains.ai_gateway import probe_worker as pw

    monkeypatch.setattr(pw, "get_adapter", lambda _type: adapter)
    return await pw.ProbeWorker._probe_exact_model(_probe_target())


async def test_probe_canary_coherent_passes(monkeypatch) -> None:
    adapter = _CanaryEchoAdapter()
    result = await _run_probe(monkeypatch, adapter)
    assert result["outcome"] == "ok"
    assert result["classified"] is None


async def test_probe_canary_garbage_fails(monkeypatch) -> None:
    """Plausible-but-collapsed garbage text with HTTP 200 is probe failure evidence."""
    garbage = {"choices": [{"message": {"role": "assistant", "content": "I am operational and ready."}}]}
    result = await _run_probe(monkeypatch, _ScriptedAdapter(garbage))
    assert result["outcome"] == "error"
    classified = result["classified"]
    assert classified is not None
    assert classified.error_code == "canary_mismatch"
    # Model-scoped retryable evidence feeding the existing demote lifecycle —
    # not endpoint-wide, not key blame.
    assert classified.is_model_specific is True
    assert classified.is_endpoint_wide is False
    assert classified.scope == "key"


async def test_probe_empty_content_fails(monkeypatch) -> None:
    """HTTP 200 with empty content (finish_reason=length shape) stays a failure."""
    empty = {"choices": [{"message": {"role": "assistant", "content": ""}, "finish_reason": "length"}]}
    result = await _run_probe(monkeypatch, _ScriptedAdapter(empty))
    assert result["outcome"] == "error"
    assert result["classified"] is not None
    assert result["classified"].error_code == "empty_completion"


async def test_probe_canary_case_insensitive(monkeypatch) -> None:
    """Capitalization differences in the echo are not incoherence."""
    class _UpperAdapter:
        async def invoke(self, *, base_url, secret, model, messages, stream, default_headers, **kwargs):
            word = messages[0]["content"].split('"')[1]
            return {"choices": [{"message": {"role": "assistant", "content": word.upper()}}]}

        def classify_error(self, exc, **_kwargs):
            raise AssertionError("no error expected")

    result = await _run_probe(monkeypatch, _UpperAdapter())
    assert result["outcome"] == "ok"


async def test_probe_canary_embedded_in_sentence_passes(monkeypatch) -> None:
    """Models that wrap the word in minimal extra text are coherent, not garbage."""
    class _ChattyAdapter:
        async def invoke(self, *, base_url, secret, model, messages, stream, default_headers, **kwargs):
            word = messages[0]["content"].split('"')[1]
            return {"choices": [{"message": {"role": "assistant", "content": f"{word}."}}]}

        def classify_error(self, exc, **_kwargs):
            raise AssertionError("no error expected")

    result = await _run_probe(monkeypatch, _ChattyAdapter())
    assert result["outcome"] == "ok"


async def test_probe_prompt_carries_canary_and_budget(monkeypatch) -> None:
    """The probe prompt asks for one specific word; budget has reasoning headroom."""
    adapter = _CanaryEchoAdapter()
    await _run_probe(monkeypatch, adapter)
    assert adapter.calls, "probe never invoked the adapter"
    prompt = adapter.calls[0]["messages"][0]["content"]
    assert '"' in prompt, "canary word must be quoted in the prompt"
    max_tokens = adapter.calls[0]["kwargs"]["max_tokens"]
    # Reasoning models truncate with empty content at tiny budgets (observed:
    # finish_reason=length at max_tokens=10) — the budget must leave headroom.
    assert max_tokens >= 32
    assert max_tokens <= 128, "probe cost stays bounded per cycle"
    assert prompt != "ping"
