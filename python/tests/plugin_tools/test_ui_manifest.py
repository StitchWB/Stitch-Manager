"""Tests for the declarative UI contribution gate (F06, WS4).

The gate blocks manifest drift (unknown node kinds, undeclared command
references, unresolved i18n keys, missing paramsFrom fields, dead i18n keys)
at dev-install, publish and CI time.  ``paramsFromRow`` targets outside the
declared columns and ``core_page`` i18n keys are warnings only.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from stitch_plugin_tools.ui_manifest import (
    assert_contributions,
    lint_contributions,
    lint_paths,
)

PLUGIN_ID = "demo"


def _contributions() -> dict:
    return {
        "commands": [
            {"name": "list_items", "readonly": True},
            {"name": "add_item", "readonly": False},
        ],
        "ui": {
            "kind": "declarative",
            "tabs": [{"id": "main", "label": "demo.tab", "icon": "X", "page": "main"}],
            "page": {
                "title": "demo.title",
                "nodes": [
                    {"kind": "heading", "text": "demo.heading"},
                    {
                        "kind": "table",
                        "id": "items",
                        "columns": [{"key": "id", "label": "demo.col.id"}],
                        "source": {"command": "list_items"},
                    },
                    {
                        "kind": "field",
                        "field": "text",
                        "id": "name",
                        "label": "demo.name",
                    },
                    {
                        "kind": "button",
                        "id": "add",
                        "label": "demo.add",
                        "command": "add_item",
                        "paramsFrom": {"name": "name"},
                    },
                ],
            },
        },
        "i18n": {
            "ru": {
                "demo": {
                    "title": "Д",
                    "tab": "Д",
                    "heading": "З",
                    "col": {"id": "ИД"},
                    "name": "Имя",
                    "add": "Доб",
                }
            },
            "en": {
                "demo": {
                    "title": "D",
                    "tab": "D",
                    "heading": "H",
                    "col": {"id": "ID"},
                    "name": "Name",
                    "add": "Add",
                }
            },
        },
    }


def _errors(contributions: dict) -> list[str]:
    errors, _warnings = lint_contributions(PLUGIN_ID, contributions)
    return errors


def _warnings(contributions: dict) -> list[str]:
    _errors, warnings = lint_contributions(PLUGIN_ID, contributions)
    return warnings


def test_clean_declarative_manifest_passes() -> None:
    assert _errors(_contributions()) == []
    assert _warnings(_contributions()) == []


def test_unknown_node_kind_fails() -> None:
    contributions = _contributions()
    contributions["ui"]["page"]["nodes"][0] = {
        "kind": "carousel",
        "text": "demo.heading",
    }
    errors = _errors(contributions)
    assert any("unknown node kind" in e for e in errors)


def test_undeclared_command_fails() -> None:
    contributions = _contributions()
    contributions["ui"]["page"]["nodes"][3]["command"] = "remove_item"
    errors = _errors(contributions)
    assert any("remove_item" in e and "not declared" in e for e in errors)


def test_undeclared_source_command_fails() -> None:
    contributions = _contributions()
    contributions["ui"]["page"]["nodes"][1]["source"]["command"] = "fetch"
    errors = _errors(contributions)
    assert any("'fetch'" in e and "not declared" in e for e in errors)


def test_missing_en_key_fails() -> None:
    contributions = _contributions()
    del contributions["i18n"]["en"]["demo"]["add"]
    errors = _errors(contributions)
    assert any("'demo.add'" in e and "'en'" in e for e in errors)


def test_missing_ru_key_fails() -> None:
    contributions = _contributions()
    del contributions["i18n"]["ru"]["demo"]["heading"]
    errors = _errors(contributions)
    assert any("'demo.heading'" in e and "'ru'" in e for e in errors)


def test_missing_params_from_field_fails() -> None:
    contributions = _contributions()
    contributions["ui"]["page"]["nodes"][3]["paramsFrom"] = {"name": "ghost"}
    errors = _errors(contributions)
    assert any("paramsFrom[name]" in e and "'ghost'" in e for e in errors)


def test_dead_i18n_key_fails() -> None:
    contributions = _contributions()
    contributions["i18n"]["ru"]["demo"]["unused"] = "лишний"
    contributions["i18n"]["en"]["demo"]["unused"] = "unused"
    errors = _errors(contributions)
    assert any("dead i18n key" in e and "demo.unused" in e for e in errors)


def test_dead_key_live_via_src_string_literal(tmp_path: Path) -> None:
    contributions = _contributions()
    contributions["i18n"]["ru"]["demo"]["hostOnly"] = "только хост"
    contributions["i18n"]["en"]["demo"]["hostOnly"] = "host-only"
    src = tmp_path / "src"
    (src / "pages").mkdir(parents=True)
    (src / "pages" / "Host.tsx").write_text(
        "const label = t('demo.hostOnly');\n", encoding="utf-8"
    )
    errors, warnings = lint_contributions(PLUGIN_ID, contributions, src_root=src)
    assert errors == []
    assert warnings == []


def test_truly_dead_key_still_fails_with_src_scan(tmp_path: Path) -> None:
    src = tmp_path / "src"
    src.mkdir()
    (src / "Host.tsx").write_text(
        "const x = 'demo.title';\n", encoding="utf-8"
    )
    contributions = _contributions()
    del contributions["ui"]["page"]["nodes"][0]  # heading demo.heading
    contributions["i18n"]["ru"]["demo"]["unused"] = "лишний"
    contributions["i18n"]["en"]["demo"]["unused"] = "unused"
    errors = _errors_lint(contributions, src)
    assert any("dead i18n key" in e and "demo.unused" in e for e in errors)
    assert any("dead i18n key" in e and "demo.heading" in e for e in errors)


def test_src_literal_substring_does_not_revive_key(tmp_path: Path) -> None:
    src = tmp_path / "src"
    src.mkdir()
    (src / "Host.tsx").write_text(
        "const x = 'demo.unused.extra';\n", encoding="utf-8"
    )
    contributions = _contributions()
    contributions["i18n"]["ru"]["demo"]["unused"] = "лишний"
    contributions["i18n"]["en"]["demo"]["unused"] = "unused"
    errors = _errors_lint(contributions, src)
    assert any("dead i18n key" in e and "demo.unused" in e for e in errors)


def test_dead_key_check_skipped_when_src_absent(tmp_path: Path) -> None:
    contributions = _contributions()
    contributions["i18n"]["ru"]["demo"]["unused"] = "лишний"
    contributions["i18n"]["en"]["demo"]["unused"] = "unused"
    errors, warnings = lint_contributions(
        PLUGIN_ID, contributions, src_root=tmp_path / "absent-src"
    )
    assert errors == []
    assert any("skipped" in w for w in warnings)


def _errors_lint(contributions: dict, src_root: Path) -> list[str]:
    errors, _warnings = lint_contributions(PLUGIN_ID, contributions, src_root=src_root)
    return errors


def test_params_from_row_non_column_warns_only() -> None:
    contributions = _contributions()
    contributions["ui"]["page"]["nodes"][1]["rowActions"] = [
        {
            "id": "row",
            "label": "Remove",
            "command": "list_items",
            "paramsFromRow": {"itemId": "row_id"},
        }
    ]
    assert _errors(contributions) == []
    warnings = _warnings(contributions)
    assert any("paramsFromRow[itemId]" in w for w in warnings)


def test_core_page_skips_dead_key_check() -> None:
    contributions = _contributions()
    contributions["ui"]["page"] = None
    contributions["ui"]["kind"] = "core_page"
    contributions["i18n"]["ru"]["demo"]["unused"] = "лишний"
    contributions["i18n"]["en"]["demo"]["unused"] = "unused"
    assert _errors(contributions) == []


def test_v21_empty_and_confirm_keys_must_resolve() -> None:
    contributions = _contributions()
    contributions["ui"]["page"]["nodes"][1]["empty"] = "demo.empty"
    contributions["ui"]["page"]["nodes"][3]["confirm"] = "demo.confirm"
    for locale in ("ru", "en"):
        contributions["i18n"][locale]["demo"]["empty"] = "Нет"
        contributions["i18n"][locale]["demo"]["confirm"] = "Точно?"
    assert _errors(contributions) == []

    del contributions["i18n"]["en"]["demo"]["confirm"]
    errors = _errors(contributions)
    assert any("'demo.confirm'" in e and "'en'" in e for e in errors)


def test_v21_toggle_field_source_command_must_be_declared() -> None:
    contributions = _contributions()
    contributions["ui"]["page"]["nodes"].append(
        {
            "kind": "field",
            "field": "toggle",
            "id": "watchdog",
            "label": "demo.name",
            "source": {"command": "watchdog_control"},
            "valueKey": "on",
        }
    )
    errors = _errors(contributions)
    assert any("watchdog_control" in e and "not declared" in e for e in errors)

    contributions["commands"].append(
        {"name": "watchdog_control", "readonly": True}
    )
    assert _errors(contributions) == []


def test_v21_refresh_on_success_unknown_node_warns_only() -> None:
    contributions = _contributions()
    contributions["ui"]["page"]["nodes"][3]["refreshOnSuccess"] = ["ghost-node"]
    assert _errors(contributions) == []
    warnings = _warnings(contributions)
    assert any("refreshOnSuccess" in w and "ghost-node" in w for w in warnings)

    contributions["ui"]["page"]["nodes"][3]["refreshOnSuccess"] = ["items"]
    assert _warnings(contributions) == []


def test_unknown_ui_kind_fails() -> None:
    contributions = _contributions()
    contributions["ui"]["kind"] = "observable"
    errors = _errors(contributions)
    assert any("ui.kind" in e for e in errors)


def test_accepts_host_driver_capability() -> None:
    from autoreg.plugin.manifest import validate_manifest

    raw = _manifest(_contributions(), capabilities=["host_driver"])
    validate_manifest(raw)
    assert_contributions(PLUGIN_ID, raw["contributions"])


def _manifest(contributions: dict, capabilities: list[str] | None = None) -> dict:
    return {
        "schema": "stitch.plugin/v2",
        "id": PLUGIN_ID,
        "name": "Demo",
        "version": "0.1.0",
        "service": PLUGIN_ID,
        "kind": "service",
        "engine": {"min": "0.3.0", "api": 2},
        "depends": [],
        "entry": {"module": PLUGIN_ID},
        "capabilities": capabilities or [],
        "outputs": [],
        "signature": "",
        "description": "d",
        "category": "productivity",
        "status": "beta",
        "contributions": contributions,
    }


def _write_package(root: Path, contributions: dict) -> Path:
    pkg = root / "demo-pkg"
    pkg.mkdir(parents=True, exist_ok=True)
    (pkg / "plugin.json").write_text(
        json.dumps(_manifest(contributions), ensure_ascii=False), encoding="utf-8"
    )
    return pkg


def test_dev_install_blocks_broken_manifest(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from stitch_plugin_tools.publish import dev_install

    monkeypatch.setenv("STITCH_PLUGINS_DIR", str(tmp_path / "client_data"))
    broken = copy.deepcopy(_contributions())
    broken["ui"]["page"]["nodes"][0]["kind"] = "carousel"
    pkg = _write_package(tmp_path, broken)

    with pytest.raises(ValueError, match="invalid UI contributions"):
        dev_install(pkg)


def test_publish_package_blocks_broken_manifest(tmp_path: Path) -> None:
    import asyncio

    from stitch_plugin_tools.publish import publish_package

    broken = copy.deepcopy(_contributions())
    del broken["i18n"]["en"]["demo"]["add"]
    pkg = _write_package(tmp_path, broken)

    with pytest.raises(ValueError, match="invalid UI contributions"):
        asyncio.run(
            publish_package(
                pkg, server_url="http://x", admin_key="k", signing_key_pem=None
            )
        )


def test_lint_paths_glob_reports_failures(tmp_path: Path) -> None:
    good = _write_package(tmp_path, _contributions())
    (tmp_path / "good").mkdir()
    good.rename(tmp_path / "good" / "plugin.json")
    bad = copy.deepcopy(_contributions())
    del bad["i18n"]["ru"]["demo"]["add"]
    bad_pkg = tmp_path / "bad"
    bad_pkg.mkdir()
    (bad_pkg / "plugin.json").write_text(
        json.dumps(_manifest(bad), ensure_ascii=False), encoding="utf-8"
    )

    exit_code = lint_paths([str(tmp_path / "*" / "plugin.json")])
    assert exit_code == 1


def _toggle_with_action(action: dict | None, **extra) -> dict:
    node = {
        "kind": "field",
        "field": "toggle",
        "id": "bridge",
        "label": "demo.name",
        "source": {"command": "list_items"},
        "valueKey": "enabled",
    }
    if action is not None:
        node["action"] = action
    node.update(extra)
    return node


def test_v22_toggle_action_valid_passes() -> None:
    contributions = _contributions()
    contributions["commands"].append({"name": "set_bridge", "readonly": False})
    contributions["ui"]["page"]["nodes"].append(
        _toggle_with_action(
            {
                "command": "set_bridge",
                "valueParam": "enabled",
                "confirm": "demo.confirm",
                "refreshOnSuccess": ["items"],
            }
        )
    )
    for locale in ("ru", "en"):
        contributions["i18n"][locale]["demo"]["confirm"] = "Точно?"
    assert _errors(contributions) == []
    assert _warnings(contributions) == []


def test_v22_toggle_action_undeclared_command_fails() -> None:
    contributions = _contributions()
    contributions["ui"]["page"]["nodes"].append(
        _toggle_with_action({"command": "set_bridge"})
    )
    errors = _errors(contributions)
    assert any("set_bridge" in e and "not declared" in e for e in errors)


def test_v22_action_without_source_fails() -> None:
    contributions = _contributions()
    contributions["commands"].append({"name": "set_bridge", "readonly": False})
    node = _toggle_with_action({"command": "set_bridge"})
    del node["source"]
    contributions["ui"]["page"]["nodes"].append(node)
    errors = _errors(contributions)
    assert any("action requires a source" in e for e in errors)


def test_v22_action_on_non_toggle_field_fails() -> None:
    contributions = _contributions()
    contributions["commands"].append({"name": "set_bridge", "readonly": False})
    node = _toggle_with_action({"command": "set_bridge"})
    node["field"] = "text"
    contributions["ui"]["page"]["nodes"].append(node)
    errors = _errors(contributions)
    assert any("only valid on toggle fields" in e for e in errors)


def test_v22_action_value_param_must_be_non_empty_string() -> None:
    contributions = _contributions()
    contributions["commands"].append({"name": "set_bridge", "readonly": False})
    contributions["ui"]["page"]["nodes"].append(
        _toggle_with_action({"command": "set_bridge", "valueParam": ""})
    )
    errors = _errors(contributions)
    assert any("valueParam" in e for e in errors)

    contributions["ui"]["page"]["nodes"][-1]["action"]["valueParam"] = 42
    errors = _errors(contributions)
    assert any("valueParam" in e for e in errors)

    contributions["ui"]["page"]["nodes"][-1]["action"]["valueParam"] = "on"
    assert _errors(contributions) == []


def test_v22_action_confirm_key_must_resolve() -> None:
    contributions = _contributions()
    contributions["commands"].append({"name": "set_bridge", "readonly": False})
    contributions["ui"]["page"]["nodes"].append(
        _toggle_with_action({"command": "set_bridge", "confirm": "demo.confirm"})
    )
    errors = _errors(contributions)
    assert any("'demo.confirm'" in e for e in errors)


def test_v22_action_refresh_on_success_unknown_node_warns_only() -> None:
    contributions = _contributions()
    contributions["commands"].append({"name": "set_bridge", "readonly": False})
    contributions["ui"]["page"]["nodes"].append(
        _toggle_with_action(
            {"command": "set_bridge", "refreshOnSuccess": ["ghost-node"]}
        )
    )
    assert _errors(contributions) == []
    warnings = _warnings(contributions)
    assert any("refreshOnSuccess" in w and "ghost-node" in w for w in warnings)


def test_job_node_kind_accepted_and_commands_validated() -> None:
    contributions = _contributions()
    contributions["commands"].append({"name": "start_sync", "readonly": False})
    contributions["ui"]["page"]["nodes"].append(
        {
            "kind": "job",
            "id": "sync",
            "label": "demo.name",
            "start": {"command": "start_sync"},
        }
    )
    assert _errors(contributions) == []

    contributions["ui"]["page"]["nodes"][-1]["start"]["command"] = "missing"
    errors = _errors(contributions)
    assert any("missing" in e and "not declared" in e for e in errors)
