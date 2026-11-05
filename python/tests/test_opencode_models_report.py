"""Tests for opencode model report / balance / reconcile — HTTP mocked, no real network."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from stitch_backend.core.invoke import WRITE_COMMANDS
from stitch_backend.domains.opencode_config.commands import (
    cmd_opencode_models_reconcile,
    cmd_opencode_models_report,
    cmd_provider_balance,
)


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


def _has_image(body: dict) -> bool:
    content = body["messages"][0]["content"]
    return isinstance(content, list) and any(c.get("type") == "image_url" for c in content)


def test_write_commands_classification() -> None:
    for name in ("opencode_provider_upsert", "opencode_agent_assign", "opencode_models_reconcile"):
        assert name in WRITE_COMMANDS
    for name in ("opencode_models_report", "provider_balance", "opencode_config_get"):
        assert name not in WRITE_COMMANDS


async def test_report_catalog_mode_lists_without_probing() -> None:
    with patch(
        "httpx.AsyncClient.get",
        new=AsyncMock(return_value=_models_response(["m1", "m2"])),
    ), patch("httpx.AsyncClient.post", new=AsyncMock()) as post:
        result = await cmd_opencode_models_report({"baseUrl": "https://api.example.com"})

    assert result["ok"] is True
    assert result["modelCount"] == 2
    assert result["probedCount"] == 0
    assert all(m["probed"] is False for m in result["models"])
    post.assert_not_awaited()


async def test_report_probe_mode_caps_by_limit() -> None:
    with patch(
        "httpx.AsyncClient.get",
        new=AsyncMock(return_value=_models_response(["m1", "m2", "m3"])),
    ), patch("httpx.AsyncClient.post", new=AsyncMock(return_value=_chat_response())):
        result = await cmd_opencode_models_report(
            {"baseUrl": "https://api.example.com", "apiKey": "sk-secret", "mode": "probe", "limit": 2}
        )

    assert result["modelCount"] == 3
    assert result["probedCount"] == 2
    assert result["unprobedCount"] == 1
    assert result["truncated"] is True
    assert [m["id"] for m in result["models"] if m["probed"]] == ["m1", "m2"]
    assert "sk-secret" not in json.dumps(result)


async def test_report_limit_zero_is_catalog_only() -> None:
    with patch(
        "httpx.AsyncClient.get",
        new=AsyncMock(return_value=_models_response(["m1", "m2"])),
    ), patch("httpx.AsyncClient.post", new=AsyncMock()) as post:
        result = await cmd_opencode_models_report(
            {"baseUrl": "https://api.example.com", "mode": "probe", "limit": 0}
        )

    assert result["probedCount"] == 0
    assert result["truncated"] is False
    post.assert_not_awaited()


async def test_report_vision_only_for_shortlist() -> None:
    post = AsyncMock(return_value=_chat_response())
    with patch(
        "httpx.AsyncClient.get",
        new=AsyncMock(return_value=_models_response(["m1", "m2"])),
    ), patch("httpx.AsyncClient.post", new=post):
        result = await cmd_opencode_models_report(
            {
                "baseUrl": "https://api.example.com",
                "mode": "probe",
                "limit": 5,
                "visionShortlist": ["m2"],
            }
        )

    by_model = {call.kwargs["json"]["model"]: call.kwargs["json"] for call in post.call_args_list}
    assert _has_image(by_model["m2"]) is True
    assert _has_image(by_model["m1"]) is False
    assert next(m for m in result["models"] if m["id"] == "m2")["multimodalOk"] is True


async def test_report_auth_failure_stops_before_probing() -> None:
    with patch(
        "httpx.AsyncClient.get",
        new=AsyncMock(return_value=_models_response([], status_code=401)),
    ), patch("httpx.AsyncClient.post", new=AsyncMock()) as post:
        result = await cmd_opencode_models_report(
            {"baseUrl": "https://api.example.com", "apiKey": "sk-bad"}
        )

    assert result["authOk"] is False
    assert result["modelCount"] == 0
    post.assert_not_awaited()


async def test_report_connection_error_is_sanitized() -> None:
    with patch(
        "httpx.AsyncClient.get",
        new=AsyncMock(side_effect=httpx.ConnectError("refused sk-secret")),
    ):
        result = await cmd_opencode_models_report(
            {"baseUrl": "https://api.example.com", "apiKey": "sk-secret"}
        )

    assert result["error"]
    assert "sk-secret" not in result["error"]


async def test_report_resolves_endpoint_from_config(tmp_path: Path) -> None:
    oc = _write_opencode(tmp_path, {"m1": {}})
    get = AsyncMock(return_value=_models_response(["m1"]))
    with patch("httpx.AsyncClient.get", new=get):
        result = await cmd_opencode_models_report({"provider": "acme", "opencodePath": str(oc)})

    assert result["provider"] == "acme"
    assert get.call_args.args[0] == "https://acme.example/v1/models"
    assert get.call_args.kwargs["headers"] == {"Authorization": "Bearer sk-secret"}
    assert "sk-secret" not in json.dumps(result)


async def test_report_concurrency_is_bounded() -> None:
    active = 0
    peak = 0

    async def _post(*args, **kwargs):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.01)
        active -= 1
        return _chat_response()

    with patch(
        "httpx.AsyncClient.get",
        new=AsyncMock(return_value=_models_response([f"m{i}" for i in range(10)])),
    ), patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=_post)):
        result = await cmd_opencode_models_report(
            {"baseUrl": "https://api.example.com", "mode": "probe", "limit": 10, "concurrency": 3}
        )

    assert result["probedCount"] == 10
    assert peak <= 3


async def test_report_budget_deadline_skips_rest() -> None:
    async def _slow(*args, **kwargs):
        await asyncio.sleep(0.05)
        return _chat_response()

    with patch(
        "httpx.AsyncClient.get",
        new=AsyncMock(return_value=_models_response([f"m{i}" for i in range(6)])),
    ), patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=_slow)):
        result = await cmd_opencode_models_report(
            {
                "baseUrl": "https://api.example.com",
                "mode": "probe",
                "limit": 6,
                "concurrency": 1,
                "budgetSeconds": 0.02,
                "timeoutSeconds": 5,
            }
        )

    assert result["probedCount"] == 1
    assert result["unprobedCount"] == 5


async def test_provider_balance_openrouter() -> None:
    resp = httpx.Response(
        200,
        json={"data": {"limit": 10, "usage": 3, "limit_remaining": 7}},
        request=httpx.Request("GET", "https://openrouter.ai/api/v1/key"),
    )
    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=resp)):
        result = await cmd_provider_balance(
            {"baseUrl": "https://openrouter.ai/api/v1", "apiKey": "sk-secret"}
        )

    assert result["supported"] is True
    assert result["vendor"] == "openrouter.ai"
    assert result["balance"]["limit_remaining"] == 7
    assert "sk-secret" not in json.dumps(result)


async def test_provider_balance_deepseek() -> None:
    resp = httpx.Response(
        200,
        json={"is_available": True, "balance_infos": [{"currency": "USD", "total_balance": "5.00"}]},
        request=httpx.Request("GET", "https://api.deepseek.com/user/balance"),
    )
    with patch("httpx.AsyncClient.get", new=AsyncMock(return_value=resp)):
        result = await cmd_provider_balance(
            {"baseUrl": "https://api.deepseek.com", "apiKey": "sk-secret"}
        )

    assert result["vendor"] == "api.deepseek.com"
    assert result["balance"]["is_available"] is True
    assert result["balance"]["balance_infos"][0]["total_balance"] == "5.00"


async def test_provider_balance_unknown_vendor_is_unsupported() -> None:
    with patch("httpx.AsyncClient.get", new=AsyncMock()) as get:
        result = await cmd_provider_balance({"baseUrl": "https://api.example.com/v1"})

    assert result["supported"] is False
    assert result["balance"] is None
    get.assert_not_awaited()


async def test_reconcile_dry_run_reports_diff_without_writing(tmp_path: Path) -> None:
    oc = _write_opencode(tmp_path, {"m1": {}, "m3": {}})
    with patch(
        "httpx.AsyncClient.get",
        new=AsyncMock(return_value=_models_response(["m1", "m2"])),
    ):
        result = await cmd_opencode_models_reconcile({"provider": "acme", "opencodePath": str(oc)})

    assert result["ok"] is True
    assert result["dryRun"] is True
    assert result["toAdd"] == ["m2"]
    assert result["toRemove"] == ["m3"]
    assert set(json.loads(oc.read_text(encoding="utf-8"))["provider"]["acme"]["models"]) == {
        "m1",
        "m3",
    }


async def test_reconcile_apply_writes_and_backs_up(tmp_path: Path) -> None:
    oc = _write_opencode(tmp_path, {"m1": {}, "m3": {}})
    with patch(
        "httpx.AsyncClient.get",
        new=AsyncMock(return_value=_models_response(["m1", "m2"])),
    ):
        result = await cmd_opencode_models_reconcile(
            {"provider": "acme", "apply": True, "opencodePath": str(oc)}
        )

    assert result["dryRun"] is False
    assert result["added"] == ["m2"]
    assert result["removed"] == ["m3"]
    assert result["backupPath"]
    assert set(json.loads(oc.read_text(encoding="utf-8"))["provider"]["acme"]["models"]) == {
        "m1",
        "m2",
    }


async def test_reconcile_prune_false_keeps_extra_models(tmp_path: Path) -> None:
    oc = _write_opencode(tmp_path, {"m1": {}, "m3": {}})
    with patch(
        "httpx.AsyncClient.get",
        new=AsyncMock(return_value=_models_response(["m1", "m2"])),
    ):
        result = await cmd_opencode_models_reconcile(
            {"provider": "acme", "apply": True, "prune": False, "opencodePath": str(oc)}
        )

    assert result["removed"] == []
    assert set(json.loads(oc.read_text(encoding="utf-8"))["provider"]["acme"]["models"]) == {
        "m1",
        "m3",
        "m2",
    }


async def test_reconcile_unknown_provider_errors(tmp_path: Path) -> None:
    oc = _write_opencode(tmp_path, {"m1": {}})
    result = await cmd_opencode_models_reconcile(
        {"provider": "missing", "baseUrl": "https://api.example.com", "opencodePath": str(oc)}
    )
    assert result["ok"] is False


def _write_opencode(tmp_path: Path, models: dict) -> Path:
    oc = tmp_path / "opencode.json"
    oc.write_text(
        json.dumps(
            {
                "provider": {
                    "acme": {
                        "name": "Acme",
                        "npm": "@ai-sdk/openai",
                        "options": {
                            "baseURL": "https://acme.example/v1",
                            "apiKey": "sk-secret",
                        },
                        "models": models,
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    return oc
