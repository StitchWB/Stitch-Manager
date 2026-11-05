"""Tests for direct opencode.json reading in the AI-gateway import path."""

from __future__ import annotations

import json
from pathlib import Path

from stitch_backend.domains.ai_gateway.opencode_import import (
    parse_opencode_providers,
    read_opencode_config,
)


async def test_read_config_then_parse_providers(tmp_path: Path) -> None:
    path = tmp_path / "opencode.json"
    path.write_text(
        json.dumps({
            "provider": {
                "reformboss": {
                    "npm": "@ai-sdk/openai-compatible",
                    "options": {
                        "baseURL": "https://api.reformboss.example/v1",
                        "apiKey": "sk-secret",
                    },
                    "models": {"grok-chat-fast": {}, "kimi-k3": {}},
                }
            }
        }),
        encoding="utf-8",
    )

    config = await read_opencode_config(str(path))
    providers, skipped = parse_opencode_providers(config)

    assert skipped == []
    assert providers[0].name == "reformboss"
    assert providers[0].base_url == "https://api.reformboss.example/v1"
    assert providers[0].adapter_type == "openai_compatible"
    assert providers[0].models == ["grok-chat-fast", "kimi-k3"]


async def test_read_config_env_override(tmp_path: Path, monkeypatch) -> None:
    path = tmp_path / "oc.json"
    path.write_text('{"provider": {}}', encoding="utf-8")
    monkeypatch.setenv("OPENCODE_CONFIG", str(path))
    assert await read_opencode_config() == {"provider": {}}


async def test_read_config_missing_returns_empty(tmp_path: Path) -> None:
    assert await read_opencode_config(str(tmp_path / "nope.json")) == {}


async def test_read_config_bad_json_returns_empty(tmp_path: Path) -> None:
    path = tmp_path / "bad.json"
    path.write_text("{ not json", encoding="utf-8")
    assert await read_opencode_config(str(path)) == {}


async def test_read_config_non_object_returns_empty(tmp_path: Path) -> None:
    path = tmp_path / "arr.json"
    path.write_text("[1, 2, 3]", encoding="utf-8")
    assert await read_opencode_config(str(path)) == {}
