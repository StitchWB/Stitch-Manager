"""Tests for the ``probe_endpoint`` command — HTTP mocked, no real network.

Mirrors the mocking style of ``test_ai_gateway_adapters.py``:
``httpx.AsyncClient.get``/``.post`` are patched with ``AsyncMock``.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import httpx

from stitch_backend.domains.ai_gateway.commands.probe import cmd_probe_endpoint


def _models_response(models: list[str], status_code: int = 200) -> httpx.Response:
    return httpx.Response(
        status_code,
        json={"data": [{"id": m} for m in models]},
        request=httpx.Request("GET", "https://api.example.com/models"),
    )


def _chat_response(status_code: int = 200) -> httpx.Response:
    return httpx.Response(
        status_code,
        json={"choices": [{"message": {"role": "assistant", "content": "pong"}}]},
        request=httpx.Request("POST", "https://api.example.com/chat/completions"),
    )


async def test_probe_success_populates_latency_and_models() -> None:
    with patch(
        "httpx.AsyncClient.get",
        new=AsyncMock(return_value=_models_response(["gpt-4", "gpt-3.5-turbo"])),
    ):
        result = await cmd_probe_endpoint(
            {"baseUrl": "https://api.example.com", "apiKey": "sk-test"},
        )

    assert result["reachable"] is True
    assert result["statusCode"] == 200
    assert result["authOk"] is True
    assert result["models"] == ["gpt-4", "gpt-3.5-turbo"]
    assert isinstance(result["latencyMs"], int)
    assert result["latencyMs"] >= 0
    assert result["error"] is None


async def test_probe_401_sets_auth_not_ok_but_reachable() -> None:
    with patch(
        "httpx.AsyncClient.get",
        new=AsyncMock(return_value=_models_response([], status_code=401)),
    ):
        result = await cmd_probe_endpoint(
            {"baseUrl": "https://api.example.com", "apiKey": "sk-bad"},
        )

    assert result["reachable"] is True
    assert result["statusCode"] == 401
    assert result["authOk"] is False
    assert result["models"] == []


async def test_probe_connection_error_sets_unreachable() -> None:
    with patch(
        "httpx.AsyncClient.get",
        new=AsyncMock(side_effect=httpx.ConnectError("connection refused")),
    ):
        result = await cmd_probe_endpoint({"baseUrl": "https://api.example.com"})

    assert result["reachable"] is False
    assert result["statusCode"] is None
    assert result["error"]


async def test_probe_with_model_reports_chat_latency() -> None:
    with patch(
        "httpx.AsyncClient.get",
        new=AsyncMock(return_value=_models_response(["gpt-4"])),
    ), patch(
        "httpx.AsyncClient.post",
        new=AsyncMock(return_value=_chat_response()),
    ):
        result = await cmd_probe_endpoint(
            {
                "baseUrl": "https://api.example.com",
                "apiKey": "sk-test",
                "model": "gpt-4",
                "imageUrl": "https://example.com/cat.png",
            },
        )

    assert result["chatOk"] is True
    assert isinstance(result["chatLatencyMs"], int)
    assert result["multimodalOk"] is True
