"""Tests for the batch ``probe_endpoint_models`` sweep — fake adapter, no network, no DB."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from stitch_backend.domains.ai_gateway.commands.probe_models import (
    _extract_text,
    probe_models,
)
from stitch_backend.domains.ai_gateway.schemas.probe_models import (
    ProbeEndpointModelsRequest,
)


class _RateLimited(Exception):
    pass


class FakeAdapter:
    def __init__(
        self,
        *,
        fail_models: tuple[str, ...] = (),
        plain: str = "pong",
        vision: str = "Red",
        delay: float = 0.0,
    ) -> None:
        self.fail_models = set(fail_models)
        self.plain = plain
        self.vision = vision
        self.delay = delay
        self.calls: list[dict] = []
        self.peak = 0
        self._active = 0

    async def invoke(
        self, *, base_url, secret, model, messages, stream, default_headers, **kwargs,
    ) -> dict:
        self.calls.append({"model": model, "messages": messages, **kwargs})
        self._active += 1
        self.peak = max(self.peak, self._active)
        try:
            if self.delay:
                await asyncio.sleep(self.delay)
            if model in self.fail_models:
                raise _RateLimited(model)
            has_image = isinstance(messages[0]["content"], list)
            answer = self.vision if has_image else self.plain
            return {"choices": [{"message": {"role": "assistant", "content": answer}}]}
        finally:
            self._active -= 1

    def classify_error(self, exc, **_kwargs):
        return SimpleNamespace(category="rate_limited")


def test_request_requires_a_target() -> None:
    with pytest.raises(ValidationError):
        ProbeEndpointModelsRequest()
    req = ProbeEndpointModelsRequest(baseUrl="https://api.example.com")
    assert req.base_url == "https://api.example.com"


async def test_probe_models_success_rows() -> None:
    adapter = FakeAdapter()
    rows = await probe_models(
        adapter,
        base_url="https://api.example.com",
        secret="sk-secret",
        default_headers=None,
        models=["m1", "m2"],
        concurrency=4,
        max_tokens=32,
        prompt=None,
        vision_models=None,
        include_multimodal=False,
        budget=30.0,
    )

    assert [r["model"] for r in rows] == ["m1", "m2"]
    assert all(r["ok"] and r["reason"] == "ok" for r in rows)
    assert all(r["text"] == "pong" for r in rows)
    assert all(r["latencyMs"] is not None for r in rows)


async def test_probe_models_failure_uses_classified_reason() -> None:
    adapter = FakeAdapter(fail_models=("m2",))
    rows = await probe_models(
        adapter,
        base_url="https://api.example.com",
        secret="sk-secret",
        default_headers=None,
        models=["m1", "m2"],
        concurrency=4,
        max_tokens=32,
        prompt=None,
        vision_models=None,
        include_multimodal=False,
        budget=30.0,
    )

    by_model = {r["model"]: r for r in rows}
    assert by_model["m1"]["ok"] is True
    assert by_model["m2"]["ok"] is False
    assert by_model["m2"]["reason"] == "rate_limited"
    assert by_model["m2"]["text"] is None


async def test_probe_models_vision_only_for_shortlist() -> None:
    adapter = FakeAdapter(vision="Red")
    rows = await probe_models(
        adapter,
        base_url="https://api.example.com",
        secret="sk-secret",
        default_headers=None,
        models=["m1", "m2"],
        concurrency=4,
        max_tokens=32,
        prompt=None,
        vision_models=["m1"],
        include_multimodal=False,
        budget=30.0,
    )

    by_model = {r["model"]: r for r in rows}
    assert by_model["m1"]["multimodalOk"] is True
    assert by_model["m2"]["multimodalOk"] is None


async def test_probe_models_vision_false_when_model_cannot_see() -> None:
    adapter = FakeAdapter(vision="I can't see any image")
    rows = await probe_models(
        adapter,
        base_url="https://api.example.com",
        secret="sk-secret",
        default_headers=None,
        models=["m1"],
        concurrency=1,
        max_tokens=32,
        prompt=None,
        vision_models=["m1"],
        include_multimodal=False,
        budget=30.0,
    )

    assert rows[0]["ok"] is True
    assert rows[0]["multimodalOk"] is False


async def test_probe_models_include_multimodal_hits_every_model() -> None:
    adapter = FakeAdapter(vision="Red")
    rows = await probe_models(
        adapter,
        base_url="https://api.example.com",
        secret="sk-secret",
        default_headers=None,
        models=["m1", "m2"],
        concurrency=2,
        max_tokens=32,
        prompt=None,
        vision_models=None,
        include_multimodal=True,
        budget=30.0,
    )

    assert all(r["multimodalOk"] is True for r in rows)


async def test_probe_models_concurrency_is_bounded() -> None:
    adapter = FakeAdapter(delay=0.01)
    rows = await probe_models(
        adapter,
        base_url="https://api.example.com",
        secret="sk-secret",
        default_headers=None,
        models=[f"m{i}" for i in range(10)],
        concurrency=3,
        max_tokens=32,
        prompt=None,
        vision_models=None,
        include_multimodal=False,
        budget=30.0,
    )

    assert len(rows) == 10
    assert adapter.peak <= 3


async def test_probe_models_budget_skips_rest() -> None:
    adapter = FakeAdapter(delay=0.05)
    rows = await probe_models(
        adapter,
        base_url="https://api.example.com",
        secret="sk-secret",
        default_headers=None,
        models=[f"m{i}" for i in range(6)],
        concurrency=1,
        max_tokens=32,
        prompt=None,
        vision_models=None,
        include_multimodal=False,
        budget=0.02,
    )

    skipped = [r for r in rows if r["reason"] == "budget_exhausted"]
    assert len(skipped) == 5
    assert rows[0]["ok"] is True


async def test_probe_models_redacts_secret_in_text() -> None:
    adapter = FakeAdapter(plain="echo sk-secret back")
    rows = await probe_models(
        adapter,
        base_url="https://api.example.com",
        secret="sk-secret",
        default_headers=None,
        models=["m1"],
        concurrency=1,
        max_tokens=32,
        prompt=None,
        vision_models=None,
        include_multimodal=False,
        budget=30.0,
    )

    assert "sk-secret" not in rows[0]["text"]


def test_extract_text_handles_shapes() -> None:
    assert _extract_text({"choices": [{"message": {"content": "hi"}}]}) == "hi"
    assert _extract_text({"choices": []}) is None
    assert _extract_text({}) is None
    assert _extract_text("nope") is None
