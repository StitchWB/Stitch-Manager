"""Legacy configure_ai_proxy_ide refactor regression + catalog extraction."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from pathlib import Path

import stitch_backend.domains.ai_proxy.commands.ide_config as ide_config
from stitch_backend.core.invoke import WRITE_COMMANDS
from stitch_backend.domains.ai_proxy.model_sync import key_material
from stitch_backend.domains.ai_proxy.model_sync.catalog import (
    catalog_entry_from_public_model,
)


class _FakeModel:
    def __init__(self, mid: str, contract: dict | None = None, display: str | None = None):
        self.id = mid
        self.display_name = display
        self.contract = contract


def test_write_commands_registered() -> None:
    assert "model_sync_apply" in WRITE_COMMANDS
    assert "model_sync_opencode_credential_repair" in WRITE_COMMANDS
    assert "model_sync_restore" in WRITE_COMMANDS
    assert "configure_ai_proxy_ide" in WRITE_COMMANDS
    assert "restore_ai_proxy_ide_config" in WRITE_COMMANDS


def test_catalog_fallbacks() -> None:
    entry = catalog_entry_from_public_model(_FakeModel("m1", None))
    assert entry["contextTokens"] == 128000
    assert entry["outputTokens"] == 8192
    assert entry["outputTokensExplicit"] is False
    assert entry["inputModalities"] == ["text"]
    assert entry["outputModalities"] == ["text"]
    assert entry["tools"] is True
    assert entry["reasoning"] is None  # never fabricated
    assert entry["name"] == "m1"  # falls back to id when no display name


def test_catalog_contract_values() -> None:
    contract = {
        "minContextTokens": 262144,
        "maxOutputTokens": 32768,
        "inputModalities": ["text", "image"],
        "tools": False,
        "reasoning": True,
    }
    entry = catalog_entry_from_public_model(_FakeModel("m2", contract, display="M Two"))
    assert entry["contextTokens"] == 262144
    assert entry["outputTokens"] == 32768
    assert entry["outputTokensExplicit"] is True
    assert entry["inputModalities"] == ["text", "image"]
    assert entry["tools"] is False
    assert entry["reasoning"] is True
    assert entry["name"] == "M Two"


async def test_configure_ai_proxy_ide_response_shape(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    entries = [
        {
            "id": "vision-best",
            "name": "Vision Best",
            "contextTokens": 128000,
            "outputTokens": 8192,
            "outputTokensExplicit": False,
            "inputModalities": ["text"],
            "outputModalities": ["text"],
            "tools": True,
            "reasoning": None,
        }
    ]

    async def fake_entries():
        return entries

    monkeypatch.setattr(ide_config, "_catalog_entries", fake_entries)
    monkeypatch.setattr(ide_config, "_gateway_key", lambda: "tok")
    monkeypatch.setattr(ide_config, "_gateway_base_url", lambda: "http://127.0.0.1:8787/v1")

    install_raw = "install-opencode-secret"

    async def fake_provision(path):
        return key_material.KeyMaterial(
            target="opencode",
            action="create",
            raw=install_raw,
            fingerprint=key_material.sha256_key(install_raw),
            key_id="key-opencode",
            created_key_id="key-opencode",
        )

    monkeypatch.setattr(ide_config, "_provision_opencode_install_key", fake_provision)

    target = tmp_path / "opencode.json"
    target.write_text(json.dumps({"provider": {"other": {"name": "keep"}}}), encoding="utf-8")

    result = await ide_config.cmd_configure_ai_proxy_ide(
        {"ideName": "opencode", "configPath": str(target)}
    )
    # exact legacy response shape
    assert set(result.keys()) == {"success", "ide", "configPath", "baseUrl", "models"}
    assert result["success"] is True
    assert result["ide"] == "opencode"
    assert result["configPath"] == str(target)
    assert result["baseUrl"] == "http://127.0.0.1:8787/v1"
    assert result["models"] == ["vision-best"]

    data = json.loads(target.read_text(encoding="utf-8"))
    assert data["provider"]["stitch"]["npm"] == "@ai-sdk/openai-compatible"
    assert data["provider"]["stitch"]["options"]["apiKey"] == install_raw
    assert "tok" not in json.dumps(data)  # legacy local token is no longer written
    assert data["provider"]["other"]["name"] == "keep"  # unrelated preserved
    # legacy .stitch-backup still produced for restore_ai_proxy_ide_config
    assert (tmp_path / "opencode.json.stitch-backup").exists()


async def test_ide_config_preview_redacts_install_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    entries = [
        {
            "id": "vision-best",
            "name": "Vision Best",
            "contextTokens": 128000,
            "outputTokens": 8192,
            "outputTokensExplicit": False,
            "inputModalities": ["text"],
            "outputModalities": ["text"],
            "tools": True,
            "reasoning": None,
        }
    ]

    async def fake_entries():
        return entries

    install_raw = "install-preview-secret"
    monkeypatch.setattr(ide_config, "_catalog_entries", fake_entries)
    monkeypatch.setattr(ide_config, "_gateway_key", lambda: "tok-local")
    monkeypatch.setattr(ide_config, "_gateway_base_url", lambda: "http://127.0.0.1:8787/v1")

    async def fake_plan(path):
        return key_material.KeyMaterial(
            target="opencode",
            action="reuse",
            raw=install_raw,
            fingerprint=key_material.sha256_key(install_raw),
        )

    monkeypatch.setattr(ide_config, "_planned_opencode_install_key", fake_plan)
    preview = await ide_config.cmd_get_ai_proxy_ide_config_preview(
        {"ideName": "opencode", "configPath": str(tmp_path / "opencode.json")}
    )
    assert install_raw not in preview
    assert "tok-local" not in preview
    assert "********" in preview


async def test_configure_ai_proxy_ide_rejects_other_ides(tmp_path: Path) -> None:
    from stitch_backend.core.exceptions import StitchError

    with pytest.raises(StitchError):
        await ide_config.cmd_configure_ai_proxy_ide({"ideName": "windsurf"})


def test_no_opencode_dual_name_collision() -> None:
    import stitch_backend.domains.ai_proxy.commands  # noqa: F401 — force registration
    from stitch_backend.core.command_registry import get_command_handler, get_command_meta
    from stitch_backend.domains.plugin_runtime.opencode_dual import OPENCODE_DUAL

    for name in (
        "model_sync_catalog",
        "model_sync_status",
        "model_sync_preview",
        "model_sync_apply",
        "model_sync_opencode_credential_repair",
        "model_sync_restore",
    ):
        assert name not in OPENCODE_DUAL  # never intercepted by the plugin router
        assert get_command_handler(name) is not None
    assert get_command_meta("model_sync_apply").admin_only is True
    assert get_command_meta("model_sync_opencode_credential_repair").admin_only is True
    assert get_command_meta("model_sync_opencode_credential_repair").timeout == 90
