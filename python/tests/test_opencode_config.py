from __future__ import annotations

import json
from pathlib import Path

from stitch_backend.domains.opencode_config import service
from stitch_backend.domains.opencode_config.commands import (
    cmd_opencode_agent_assign,
    cmd_opencode_config_get,
    cmd_opencode_provider_upsert,
)


def _write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def test_parse_jsonc_strips_comments_and_trailing_commas() -> None:
    text = """
    {
      // line comment
      "a": 1, /* block comment */
      "b": [1, 2,],
      "url": "https://example.com//path",
    }
    """
    assert service.parse_jsonc(text) == {
        "a": 1,
        "b": [1, 2],
        "url": "https://example.com//path",
    }


def test_default_paths_use_home(monkeypatch) -> None:
    monkeypatch.delenv("OPENCODE_CONFIG", raising=False)
    monkeypatch.delenv("OMO_CONFIG", raising=False)
    assert service.default_opencode_path() == Path.home() / ".config" / "opencode" / "opencode.json"
    assert service.default_omo_path() == Path.home() / ".omo" / "omo.jsonc"


def test_default_paths_env_override(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("OPENCODE_CONFIG", str(tmp_path / "oc.json"))
    monkeypatch.setenv("OMO_CONFIG", str(tmp_path / "omo.jsonc"))
    assert service.default_opencode_path() == tmp_path / "oc.json"
    assert service.default_omo_path() == tmp_path / "omo.jsonc"


def test_read_snapshot_handles_utf8_bom(tmp_path: Path) -> None:
    path = tmp_path / "omo.jsonc"
    path.write_bytes(b"\xef\xbb\xbf" + b'{"[opencode]": {"agents": {}}}')
    snapshot = service.read_snapshot(path)
    assert snapshot.exists is True
    assert snapshot.data == {"[opencode]": {"agents": {}}}


def test_write_config_conflict_guard(tmp_path: Path) -> None:
    path = tmp_path / "opencode.json"
    _write(path, "{}")
    snapshot = service.read_snapshot(path)
    _write(path, '{"changed": true}')
    result = service.write_config(path, {"x": 1}, expected_sha256=snapshot.sha256)
    assert result["ok"] is False
    assert result["error"] == "conflict"


def test_write_config_creates_backup_and_is_atomic(tmp_path: Path) -> None:
    path = tmp_path / "opencode.json"
    _write(path, '{"provider": {}}')
    snapshot = service.read_snapshot(path)
    result = service.write_config(path, {"provider": {"a": {}}}, expected_sha256=snapshot.sha256)
    assert result["ok"] is True
    backup = Path(result["backupPath"])
    assert backup.parent == tmp_path
    assert backup.name.startswith("opencode.json.bak-")
    assert backup.read_text(encoding="utf-8") == '{"provider": {}}'
    assert json.loads(path.read_text(encoding="utf-8")) == {"provider": {"a": {}}}
    assert [p.name for p in tmp_path.iterdir() if p.name.endswith(".tmp")] == []


async def test_provider_upsert_writes_and_masks(tmp_path: Path) -> None:
    oc = tmp_path / "opencode.json"
    _write(oc, json.dumps({"provider": {}}))
    result = await cmd_opencode_provider_upsert({
        "id": "acme",
        "name": "Acme",
        "npm": "@ai-sdk/openai",
        "baseURL": "https://acme.example/v1",
        "apiKey": "sk-secret-value",
        "models": ["m1", "m2"],
        "opencodePath": str(oc),
    })
    assert result["ok"] is True
    assert result["backupPath"] is not None
    assert result["commentsMayBeDropped"] is False
    assert "sk-secret-value" not in json.dumps(result)
    data = json.loads(oc.read_text(encoding="utf-8"))
    assert data["provider"]["acme"]["options"]["apiKey"] == "sk-secret-value"
    assert set(data["provider"]["acme"]["models"]) == {"m1", "m2"}


async def test_provider_upsert_conflict_returns_error(tmp_path: Path, monkeypatch) -> None:
    from stitch_backend.domains.opencode_config import commands as oc_commands

    oc = tmp_path / "opencode.json"
    _write(oc, json.dumps({"provider": {}}))
    real_read = oc_commands.read_snapshot

    def racing_read(path):
        snapshot = real_read(path)
        _write(oc, json.dumps({"provider": {"raced": {}}}))
        return snapshot

    monkeypatch.setattr(oc_commands, "read_snapshot", racing_read)
    result = await cmd_opencode_provider_upsert({
        "id": "acme",
        "name": "Acme",
        "npm": "@ai-sdk/openai",
        "baseURL": "https://acme.example/v1",
        "opencodePath": str(oc),
    })
    assert result["ok"] is False
    assert result["error"] == "conflict"


async def test_agent_assign_builtin_goes_to_omo(tmp_path: Path) -> None:
    oc = tmp_path / "opencode.json"
    omo = tmp_path / "omo.jsonc"
    _write(oc, json.dumps({"agent": {}}))
    _write(omo, '{\n  // comment\n  "[opencode]": {"agents": {}}\n}\n')
    result = await cmd_opencode_agent_assign({
        "agent": "sisyphus",
        "model": "prov/m1",
        "fallbackModels": ["prov/m2"],
        "opencodePath": str(oc),
        "omoPath": str(omo),
    })
    assert result["ok"] is True
    assert result["target"] == "omo"
    assert result["commentsMayBeDropped"] is True
    data = service.parse_jsonc(omo.read_text(encoding="utf-8"))
    assert data["[opencode]"]["agents"]["sisyphus"]["model"] == "prov/m1"
    assert data["[opencode]"]["agents"]["sisyphus"]["fallback_models"] == ["prov/m2"]
    assert json.loads(oc.read_text(encoding="utf-8"))["agent"] == {}


async def test_agent_assign_custom_goes_to_opencode(tmp_path: Path) -> None:
    oc = tmp_path / "opencode.json"
    omo = tmp_path / "omo.jsonc"
    _write(oc, json.dumps({"agent": {}}))
    _write(omo, '{"[opencode]": {"agents": {}}}')
    result = await cmd_opencode_agent_assign({
        "agent": "my-custom",
        "model": "prov/m1",
        "opencodePath": str(oc),
        "omoPath": str(omo),
    })
    assert result["target"] == "opencode"
    data = json.loads(oc.read_text(encoding="utf-8"))
    assert data["agent"]["my-custom"]["model"] == "prov/m1"


async def test_agent_assign_explicit_target_override(tmp_path: Path) -> None:
    oc = tmp_path / "opencode.json"
    omo = tmp_path / "omo.jsonc"
    _write(oc, json.dumps({"agent": {}}))
    _write(omo, '{"[opencode]": {"agents": {}}}')
    result = await cmd_opencode_agent_assign({
        "agent": "sisyphus",
        "model": "prov/m1",
        "target": "opencode",
        "opencodePath": str(oc),
        "omoPath": str(omo),
    })
    assert result["target"] == "opencode"
    data = json.loads(oc.read_text(encoding="utf-8"))
    assert data["agent"]["sisyphus"]["model"] == "prov/m1"


async def test_config_get_masks_keys_and_normalizes(tmp_path: Path) -> None:
    oc = tmp_path / "opencode.json"
    omo = tmp_path / "omo.jsonc"
    _write(oc, json.dumps({
        "model": "prov/top",
        "provider": {
            "acme": {
                "name": "Acme",
                "npm": "@ai-sdk/openai",
                "options": {"baseURL": "https://acme.example/v1", "apiKey": "sk-secret-value"},
                "models": {"m1": {}, "m2": {}},
            }
        },
        "agent": {"build": {"model": "prov/build"}},
    }))
    _write(omo, json.dumps({
        "[opencode]": {
            "agents": {"sisyphus": {"models": ["prov/a", "prov/b"]}},
            "categories": {"quick": {"model": "prov/q", "fallback_models": ["prov/f"]}},
            "runtime_fallback": {"enabled": True},
        }
    }))
    result = await cmd_opencode_config_get({"opencodePath": str(oc), "omoPath": str(omo)})
    assert result["ok"] is True
    assert "sk-secret-value" not in json.dumps(result)
    assert result["opencode"]["model"] == "prov/top"
    assert result["opencode"]["providers"][0]["apiKey"] == service.MASK
    assert result["opencode"]["providers"][0]["modelCount"] == 2
    assert result["opencode"]["agents"]["build"] == "prov/build"
    assert result["omo"]["agents"]["sisyphus"]["models"] == ["prov/a", "prov/b"]
    assert result["omo"]["categories"]["quick"]["fallbackModels"] == ["prov/f"]
    assert result["omo"]["runtimeFallback"] == {"enabled": True}


async def test_config_get_missing_files(tmp_path: Path) -> None:
    result = await cmd_opencode_config_get({
        "opencodePath": str(tmp_path / "nope.json"),
        "omoPath": str(tmp_path / "nope.jsonc"),
    })
    assert result["ok"] is True
    assert result["opencode"]["exists"] is False
    assert result["omo"]["exists"] is False


async def test_invalid_json_returns_error_without_raising(tmp_path: Path) -> None:
    oc = tmp_path / "opencode.json"
    _write(oc, "{ not json")
    result = await cmd_opencode_config_get({
        "opencodePath": str(oc),
        "omoPath": str(tmp_path / "nope.jsonc"),
    })
    assert result["ok"] is False
    assert "error" in result
