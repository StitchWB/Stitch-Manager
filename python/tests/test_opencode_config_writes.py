"""Tests for OMO agent/category writes and config restore."""

from __future__ import annotations

import json
from pathlib import Path

from stitch_backend.core.invoke import WRITE_COMMANDS
from stitch_backend.domains.opencode_config import service
from stitch_backend.domains.opencode_config.commands import (
    cmd_opencode_agent_assign,
    cmd_opencode_config_restore,
)


def _write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def _omo(path: Path, section: dict) -> Path:
    _write(path, json.dumps({"[opencode]": section}))
    return path


def _section(path: Path) -> dict:
    return service.parse_jsonc(path.read_text(encoding="utf-8"))["[opencode]"]


def test_restore_is_a_write_command() -> None:
    assert "opencode_config_restore" in WRITE_COMMANDS


async def test_omo_agent_auto_keeps_models_array_style(tmp_path: Path) -> None:
    oc = tmp_path / "opencode.json"
    omo = _omo(
        tmp_path / "omo.jsonc",
        {"agents": {"sisyphus": {"models": ["old/p", "old/f"], "prompt_append": "keep me"}}},
    )
    result = await cmd_opencode_agent_assign(
        {
            "agent": "sisyphus",
            "model": "prov/m1",
            "fallbackModels": ["prov/m2", "prov/m3"],
            "opencodePath": str(oc),
            "omoPath": str(omo),
        }
    )

    assert result["ok"] is True
    assert result["target"] == "omo"
    assert result["style"] == "models"
    entry = _section(omo)["agents"]["sisyphus"]
    assert entry["models"] == ["prov/m1", "prov/m2", "prov/m3"]
    assert "model" not in entry
    assert "fallback_models" not in entry
    assert entry["prompt_append"] == "keep me"


async def test_omo_agent_auto_uses_model_when_absent(tmp_path: Path) -> None:
    oc = tmp_path / "opencode.json"
    omo = _omo(tmp_path / "omo.jsonc", {"agents": {}})
    result = await cmd_opencode_agent_assign(
        {
            "agent": "sisyphus",
            "model": "prov/m1",
            "fallbackModels": ["prov/m2"],
            "opencodePath": str(oc),
            "omoPath": str(omo),
        }
    )

    assert result["style"] == "model"
    entry = _section(omo)["agents"]["sisyphus"]
    assert entry["model"] == "prov/m1"
    assert entry["fallback_models"] == ["prov/m2"]
    assert "models" not in entry


async def test_omo_agent_explicit_models_style(tmp_path: Path) -> None:
    oc = tmp_path / "opencode.json"
    omo = _omo(tmp_path / "omo.jsonc", {"agents": {}})
    result = await cmd_opencode_agent_assign(
        {
            "agent": "sisyphus",
            "model": "prov/m1",
            "fallbackModels": ["prov/m2"],
            "style": "models",
            "opencodePath": str(oc),
            "omoPath": str(omo),
        }
    )

    assert result["style"] == "models"
    assert _section(omo)["agents"]["sisyphus"]["models"] == ["prov/m1", "prov/m2"]


async def test_omo_category_write_uses_model_and_fallbacks(tmp_path: Path) -> None:
    oc = tmp_path / "opencode.json"
    omo = _omo(
        tmp_path / "omo.jsonc",
        {"categories": {"quick": {"model": "old", "fallback_models": ["x"]}}},
    )
    result = await cmd_opencode_agent_assign(
        {
            "agent": "quick",
            "model": "prov/q",
            "fallbackModels": ["prov/f"],
            "kind": "category",
            "opencodePath": str(oc),
            "omoPath": str(omo),
        }
    )

    assert result["ok"] is True
    assert result["kind"] == "category"
    assert result["target"] == "omo"
    assert result["style"] == "model"
    entry = _section(omo)["categories"]["quick"]
    assert entry["model"] == "prov/q"
    assert entry["fallback_models"] == ["prov/f"]


async def test_category_on_opencode_target_is_rejected(tmp_path: Path) -> None:
    oc = tmp_path / "opencode.json"
    _write(oc, "{}")
    result = await cmd_opencode_agent_assign(
        {
            "agent": "quick",
            "model": "prov/q",
            "kind": "category",
            "target": "opencode",
            "opencodePath": str(oc),
        }
    )

    assert result["ok"] is False
    assert "OMO" in result["error"]


async def test_restore_from_backup_writes_and_makes_safety_copy(tmp_path: Path) -> None:
    path = tmp_path / "opencode.json"
    _write(path, '{"current": true}')
    backup = tmp_path / "opencode.json.bak-20200101-000000"
    _write(backup, '{"old": true}')

    result = await cmd_opencode_config_restore(
        {"path": str(path), "backupPath": str(backup)}
    )

    assert result["ok"] is True
    assert json.loads(path.read_text(encoding="utf-8")) == {"old": True}
    safety = Path(result["safetyBackupPath"])
    assert json.loads(safety.read_text(encoding="utf-8")) == {"current": True}


async def test_restore_conflict_guard(tmp_path: Path) -> None:
    path = tmp_path / "opencode.json"
    _write(path, '{"current": true}')
    backup = tmp_path / "opencode.json.bak-20200101-000000"
    _write(backup, '{"old": true}')

    result = await cmd_opencode_config_restore(
        {"path": str(path), "backupPath": str(backup), "expectedSha256": "deadbeef"}
    )

    assert result["ok"] is False
    assert result["error"] == "conflict"
    assert json.loads(path.read_text(encoding="utf-8")) == {"current": True}


async def test_restore_missing_backup_errors(tmp_path: Path) -> None:
    path = tmp_path / "opencode.json"
    _write(path, "{}")
    result = await cmd_opencode_config_restore(
        {"path": str(path), "backupPath": str(tmp_path / "nope.bak")}
    )
    assert result["ok"] is False
    assert "backup" in result["error"]


async def test_restore_rejects_non_object_backup(tmp_path: Path) -> None:
    path = tmp_path / "opencode.json"
    _write(path, "{}")
    backup = tmp_path / "bad.bak"
    _write(backup, "[1, 2, 3]")
    result = await cmd_opencode_config_restore(
        {"path": str(path), "backupPath": str(backup)}
    )
    assert result["ok"] is False
