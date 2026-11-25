"""OpenCode writer tests: v1/v2 shapes, split files, version detection."""

from __future__ import annotations

import json
from pathlib import Path

from stitch_backend.domains.ai_proxy.model_sync import opencode as oc
from stitch_backend.domains.ai_proxy.model_sync.detection import (
    _parse_version_output,
    detect_opencode_version,
    resolve_opencode_layout,
    resolve_schema,
)

ENTRIES = [
    {
        "id": "vision-best",
        "name": "Vision Best",
        "contextTokens": 200000,
        "outputTokens": 16384,
        "outputTokensExplicit": True,
        "inputModalities": ["text", "image"],
        "outputModalities": ["text"],
        "tools": True,
        "reasoning": None,
    },
    {
        "id": "text-fast",
        "name": "Text Fast",
        "contextTokens": 128000,
        "outputTokens": 8192,
        "outputTokensExplicit": False,
        "inputModalities": ["text"],
        "outputModalities": ["text"],
        "tools": True,
        "reasoning": True,
    },
]

BASE = "http://127.0.0.1:8787/v1"
KEY = "test-token-123"


def test_v1_write_empty_config() -> None:
    merged = oc.merge_stitch_block({}, ENTRIES, BASE, KEY, "v1")
    stitch = merged["provider"]["stitch"]
    assert stitch["npm"] == "@ai-sdk/openai-compatible"
    assert stitch["options"] == {"baseURL": BASE, "apiKey": KEY}
    models = stitch["models"]
    assert set(models) == {"vision-best", "text-fast"}
    vision = models["vision-best"]
    assert vision["limit"] == {"context": 200000, "output": 16384}
    assert vision["attachment"] is True  # image in input modalities
    assert vision["tool_call"] is True
    assert vision["modalities"]["input"] == ["text", "image"]
    assert "reasoning" not in vision  # never fabricated
    assert models["text-fast"]["reasoning"] is True  # explicit
    assert models["text-fast"]["attachment"] is False
    # v1 top-level model + small_model
    assert merged["model"] == "stitch/vision-best"
    assert merged["small_model"] == "stitch/vision-best"


def test_v1_write_preserves_unrelated_keys() -> None:
    existing = {
        "$schema": "https://opencode.ai/config.json",
        "model": "other/model",
        "provider": {
            "agentrouter": {"name": "AgentRouter", "npm": "@ai-sdk/openai"},
        },
        "mcp": {"x": {"enabled": False}},
    }
    merged = oc.merge_stitch_block(existing, ENTRIES, BASE, KEY, "v1")
    assert merged["provider"]["agentrouter"]["name"] == "AgentRouter"
    assert merged["mcp"] == {"x": {"enabled": False}}
    # explicit model selection is never overridden
    assert merged["model"] == "other/model"
    assert merged["small_model"] == "stitch/vision-best"
    # original object not mutated
    assert "stitch" not in existing["provider"]


def test_v1_removes_v2_stitch_entry_only() -> None:
    existing = {
        "providers": {
            "stitch": {"name": "old"},
            "keepme": {"name": "unrelated"},
        }
    }
    merged = oc.merge_stitch_block(existing, ENTRIES, BASE, KEY, "v1")
    assert "stitch" in merged["provider"]
    assert "stitch" not in merged.get("providers", {})
    assert merged["providers"]["keepme"]["name"] == "unrelated"


def test_v2_write_shape_and_legacy_removal() -> None:
    existing = {
        "provider": {
            "stitch": {"npm": "@ai-sdk/openai-compatible", "models": {"old": {}}},
            "other": {"name": "untouched"},
        },
        "small_model": "stitch/old",
    }
    merged = oc.merge_stitch_block(existing, ENTRIES, BASE, KEY, "v2")
    stitch = merged["providers"]["stitch"]
    assert stitch["package"] == "@opencode/ai/providers/openai-compatible"
    assert stitch["settings"] == {"baseURL": BASE, "apiKey": KEY}
    vision = stitch["models"]["vision-best"]
    assert vision["capabilities"]["tools"] is True
    assert vision["capabilities"]["input"] == ["text", "image"]
    assert vision["limit"]["context"] == 200000
    assert "modelID" not in vision  # key == upstream id
    # legacy singular stitch removed, unrelated provider untouched
    assert "stitch" not in merged.get("provider", {})
    assert merged["provider"]["other"]["name"] == "untouched"
    # v2 never writes small_model/model
    assert "small_model" not in merged or merged.get("small_model") == "stitch/old"
    assert merged.get("model") is None


def test_v1_explicit_small_model_written() -> None:
    merged = oc.merge_stitch_block({}, ENTRIES, BASE, KEY, "v1", small_model="stitch/text-fast")
    assert merged["small_model"] == "stitch/text-fast"


def test_v1_explicit_small_model_overrides_existing() -> None:
    existing = {"small_model": "stitch/old-small"}
    merged = oc.merge_stitch_block(
        existing, ENTRIES, BASE, KEY, "v1", small_model="stitch/text-fast"
    )
    assert merged["small_model"] == "stitch/text-fast"


def test_v1_existing_small_model_never_clobbered_implicitly() -> None:
    existing = {"small_model": "other/user-choice"}
    merged = oc.merge_stitch_block(existing, ENTRIES, BASE, KEY, "v1")
    assert merged["small_model"] == "other/user-choice"


def test_v1_small_model_falls_back_to_first_when_absent() -> None:
    merged = oc.merge_stitch_block({}, ENTRIES, BASE, KEY, "v1")
    assert merged["small_model"] == "stitch/vision-best"


def test_v2_never_writes_small_model_even_when_requested() -> None:
    merged = oc.merge_stitch_block({}, ENTRIES, BASE, KEY, "v2", small_model="stitch/text-fast")
    assert "small_model" not in merged
    assert "model" not in merged


def test_v2_does_not_write_small_model() -> None:
    merged = oc.merge_stitch_block({}, ENTRIES, BASE, KEY, "v2")
    assert "small_model" not in merged
    assert "model" not in merged


def test_purge_stitch_entries() -> None:
    data = {
        "provider": {"stitch": {"x": 1}, "other": {"y": 2}},
        "model": "stitch/vision-best",
    }
    purged, removed = oc.purge_stitch_entries(data)
    assert removed is True
    assert "stitch" not in purged["provider"]
    assert purged["provider"]["other"] == {"y": 2}
    assert "model" not in purged  # dangling stitch pointer dropped


def test_layout_both_json_and_jsonc(tmp_path: Path) -> None:
    (tmp_path / "opencode.json").write_text("{}", encoding="utf-8")
    (tmp_path / "opencode.jsonc").write_text("{}", encoding="utf-8")
    layout = resolve_opencode_layout(config_dir=tmp_path)
    assert layout.write_target.name == "opencode.jsonc"  # highest precedence
    assert layout.secondary_path is not None
    assert layout.secondary_path.name == "opencode.json"
    assert any("both" in w for w in layout.warnings)


def test_layout_json_only(tmp_path: Path) -> None:
    (tmp_path / "opencode.json").write_text("{}", encoding="utf-8")
    layout = resolve_opencode_layout(config_dir=tmp_path)
    assert layout.write_target.name == "opencode.json"
    assert layout.secondary_path is None


def test_layout_new_file_defaults_to_json(tmp_path: Path) -> None:
    layout = resolve_opencode_layout(config_dir=tmp_path)
    assert layout.write_target.name == "opencode.json"
    assert layout.primary_path is None


def test_layout_explicit_path_wins(tmp_path: Path) -> None:
    custom = tmp_path / "custom.json"
    layout = resolve_opencode_layout(config_path=str(custom), config_dir=tmp_path)
    assert layout.write_target == custom
    assert layout.explicit is True


def test_layout_config_json_never_written(tmp_path: Path) -> None:
    (tmp_path / "config.json").write_text("{}", encoding="utf-8")
    layout = resolve_opencode_layout(config_dir=tmp_path)
    assert layout.config_json_path is not None
    assert layout.write_target.name != "config.json"
    assert any("config.json" in w for w in layout.warnings)


# ── version detection ───────────────────────────────────────────────────────


def _no_binary():
    return None, None


def test_parse_version_output() -> None:
    assert _parse_version_output("opencode 2.1.0") == "v2"
    assert _parse_version_output("1.5.3") == "v1"
    assert _parse_version_output("no version here") is None


def test_detect_binary_wins(tmp_path: Path) -> None:
    result = detect_opencode_version(tmp_path, binary_probe=lambda: ("v2", "2.0.0"))
    assert result["version"] == "v2"
    assert result["source"] == "binary"


def test_detect_cli_json_means_v2(tmp_path: Path) -> None:
    (tmp_path / "cli.json").write_text("{}", encoding="utf-8")
    result = detect_opencode_version(tmp_path, binary_probe=_no_binary)
    assert result["version"] == "v2"
    assert result["source"] == "cli.json"


def test_detect_tui_json_means_v1(tmp_path: Path) -> None:
    (tmp_path / "tui.json").write_text("{}", encoding="utf-8")
    result = detect_opencode_version(tmp_path, binary_probe=_no_binary)
    assert result["version"] == "v1"


def test_detect_providers_key_means_v2(tmp_path: Path) -> None:
    (tmp_path / "opencode.json").write_text(json.dumps({"providers": {}}), encoding="utf-8")
    result = detect_opencode_version(tmp_path, binary_probe=_no_binary)
    assert result["version"] == "v2"
    assert result["source"] == "config-providers-key"


def test_detect_unknown(tmp_path: Path) -> None:
    result = detect_opencode_version(tmp_path, binary_probe=_no_binary)
    assert result["version"] == "unknown"


def test_resolve_schema_fallbacks() -> None:
    assert resolve_schema("v2", "v1") == "v2"  # user override wins
    assert resolve_schema("auto", "v2") == "v2"
    assert resolve_schema(None, "unknown") == "v1"  # v1-compatible for unknown
    assert resolve_schema(None, "v1") == "v1"
