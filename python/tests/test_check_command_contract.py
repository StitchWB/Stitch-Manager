"""Tests for scripts/check_command_contract.py.

Each test is a sabotage check: introduce the bug class into a temp repo,
expect the gate to fail; remove the bug, expect the gate to pass.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

GATE = Path(__file__).resolve().parents[2] / "scripts" / "check_command_contract.py"


def _run(tmp_path: Path, *, frontend_src: Path, backend_python: Path, plugins: list[Path], extra: list[str] = ()) -> subprocess.CompletedProcess:
    args = [
        sys.executable, str(GATE),
        "--frontend-src", str(frontend_src),
        "--backend-python", str(backend_python),
        "--json",
        *sum((["--plugins-dir", str(p)] for p in plugins), []),
        *extra,
    ]
    return subprocess.run(args, cwd=tmp_path, capture_output=True, text=True)


def _make_workspace(tmp_path: Path) -> tuple[Path, Path, Path]:
    fe = tmp_path / "src"
    fe.mkdir()
    py = tmp_path / "py"
    (py / "stitch_backend" / "domains" / "plugin_runtime").mkdir(parents=True)
    (py / "stitch_backend" / "domains" / "plugin_runtime" / "example_dual.py").write_text(
        "EXAMPLE_MAP = {\n  'foo_x': 'x',\n  'foo_y': 'y',\n}\n", encoding="utf-8",
    )
    plugins = tmp_path / "plugins-src"
    plugins.mkdir()
    return fe, py, plugins


def _write_fe(fe: Path, body: str) -> None:
    (fe / "caller.ts").write_text(body, encoding="utf-8")


def _write_decorator(py: Path, name: str) -> None:
    domain = py / "stitch_backend" / "domains" / "domain"
    domain.mkdir(parents=True, exist_ok=True)
    (domain / "commands.py").write_text(
        f"from stitch_backend.core.command_registry import command\n\n"
        f"@command('{name}')\n"
        f"async def cmd_{name}(db, params): return {{}}\n",
        encoding="utf-8",
    )


def _write_plugin_manifest(plugins: Path, plugin_id: str, commands: list[str]) -> None:
    pdir = plugins / plugin_id
    pdir.mkdir(parents=True, exist_ok=True)
    (pdir / "plugin.json").write_text(
        json.dumps({
            "schema": "stitch.plugin/v2", "id": plugin_id, "version": "0.0.1",
            "contributions": {"commands": [{"name": c} for c in commands]},
        }),
        encoding="utf-8",
    )


def test_passes_when_decorator_exists(tmp_path):
    fe, py, plugins = _make_workspace(tmp_path)
    _write_fe(fe, "import {safeInvoke} from 'x';\nexport function call(){ return safeInvoke('do_thing'); }\n")
    _write_decorator(py, "do_thing")
    result = _run(tmp_path, frontend_src=fe, backend_python=py, plugins=[plugins])
    assert result.returncode == 0, result.stdout + result.stderr
    payload = json.loads(result.stdout)
    assert payload["missing_raw"] == []


def test_fails_when_fe_calls_missing_command(tmp_path):
    fe, py, plugins = _make_workspace(tmp_path)
    _write_fe(fe, "import {safeInvoke} from 'x';\nexport function call(){ return safeInvoke('ghost'); }\n")
    _write_decorator(py, "do_thing")
    result = _run(tmp_path, frontend_src=fe, backend_python=py, plugins=[plugins])
    assert result.returncode == 1, result.stdout
    payload = json.loads(result.stdout)
    assert "ghost" in payload["missing_raw"]


def test_resolves_via_plugin_manifest(tmp_path):
    fe, py, plugins = _make_workspace(tmp_path)
    _write_fe(fe, "import {safeInvoke} from 'x';\nexport function call(){ return safeInvoke('plugin_cmd'); }\n")
    _write_decorator(py, "do_thing")
    _write_plugin_manifest(plugins, "stitch-x", ["plugin_cmd"])
    result = _run(tmp_path, frontend_src=fe, backend_python=py, plugins=[plugins])
    assert result.returncode == 0, result.stdout
    payload = json.loads(result.stdout)
    assert "plugin_cmd" not in payload["missing_raw"]


def test_resolves_via_dual_route_dict(tmp_path):
    fe, py, plugins = _make_workspace(tmp_path)
    _write_fe(fe, "import {safeInvoke} from 'x';\nexport function call(){ return safeInvoke('foo_x'); }\n")
    _write_decorator(py, "do_thing")
    result = _run(tmp_path, frontend_src=fe, backend_python=py, plugins=[plugins])
    assert result.returncode == 0, result.stdout
    payload = json.loads(result.stdout)
    assert payload["dual_route_keys"] >= 2
    assert "foo_x" not in payload["missing_raw"]


def test_baseline_suppresses_known_gap(tmp_path):
    fe, py, plugins = _make_workspace(tmp_path)
    _write_fe(fe, "import {safeInvoke} from 'x';\nexport function call(){ return safeInvoke('known_gap'); }\n")
    _write_decorator(py, "do_thing")
    baseline = tmp_path / "baseline.json"
    baseline.write_text(json.dumps({"known_missing": ["known_gap"]}), encoding="utf-8")
    result = _run(tmp_path, frontend_src=fe, backend_python=py, plugins=[plugins], extra=["--baseline", str(baseline)])
    assert result.returncode == 0, result.stdout
    payload = json.loads(result.stdout)
    assert "known_gap" in payload["missing_raw"]
    assert "known_gap" not in payload["missing_baselined"]


def test_baseline_does_not_mask_new_gap(tmp_path):
    fe, py, plugins = _make_workspace(tmp_path)
    _write_fe(fe, "import {safeInvoke} from 'x';\nexport function call(){ return safeInvoke('new_bug'); }\n")
    _write_decorator(py, "do_thing")
    baseline = tmp_path / "baseline.json"
    baseline.write_text(json.dumps({"known_missing": ["something_else"]}), encoding="utf-8")
    result = _run(tmp_path, frontend_src=fe, backend_python=py, plugins=[plugins], extra=["--baseline", str(baseline)])
    assert result.returncode == 1
    payload = json.loads(result.stdout)
    assert "new_bug" in payload["missing_baselined"]


def test_test_paths_are_skipped(tmp_path):
    fe, py, plugins = _make_workspace(tmp_path)
    tests_dir = fe / "__tests__"
    tests_dir.mkdir()
    (tests_dir / "ghost.test.ts").write_text(
        "import {safeInvoke} from 'x';\n"
        "export function call(){ return safeInvoke('not_a_real_command'); }\n",
        encoding="utf-8",
    )
    result = _run(tmp_path, frontend_src=fe, backend_python=py, plugins=[plugins])
    assert result.returncode == 0, result.stdout


def test_production_commands_are_not_exempt_by_name(tmp_path):
    fe, py, plugins = _make_workspace(tmp_path)
    _write_fe(fe,
        "import {safeInvoke} from 'x';\n"
        "export function a(){ return safeInvoke('some_command'); }\n"
        "export function b(){ return safeInvoke('failing_command'); }\n",
    )
    _write_decorator(py, "do_thing")
    result = _run(tmp_path, frontend_src=fe, backend_python=py, plugins=[plugins])
    assert result.returncode == 1
    payload = json.loads(result.stdout)
    assert payload["fe_calls_skipped_test"] == 0
    assert set(payload["missing_raw"]) == {"some_command", "failing_command"}


def test_runtime_rejects_defined_but_unregistered_command(tmp_path):
    fe, py, plugins = _make_workspace(tmp_path)
    _write_fe(fe, "export function call(){ return safeInvoke('ghost'); }")
    _write_decorator(py, "ghost")
    package = py / "stitch_backend"
    (package / "__init__.py").write_text("", encoding="utf-8")
    (package / "startup.py").write_text("def import_command_modules(): return None", encoding="utf-8")
    (package / "core").mkdir()
    (package / "core" / "__init__.py").write_text("", encoding="utf-8")
    (package / "core" / "command_registry.py").write_text("def list_commands(): return []", encoding="utf-8")
    result = _run(tmp_path, frontend_src=fe, backend_python=py, plugins=[plugins], extra=["--runtime"])
    assert result.returncode == 1, result.stderr
    assert json.loads(result.stdout)["missing_raw"] == ["ghost"]


def test_dynamic_factory_registration(tmp_path):
    fe, py, plugins = _make_workspace(tmp_path)
    _write_fe(fe, "export function call(){ return safeInvoke('get_zai_api_keys'); }")
    (py / "commands.py").write_text(
        "_PROVIDERS = ['zai']\n"
        "def factory(provider):\n    command(f'get_{provider}_api_keys')(handler)\n"
        "for p in _PROVIDERS:\n    factory(p)\n", encoding="utf-8",
    )
    result = _run(tmp_path, frontend_src=fe, backend_python=py, plugins=[plugins])
    assert result.returncode == 0, result.stdout + result.stderr


def test_safe_invoke_with_retry_picked_up(tmp_path):
    fe, py, plugins = _make_workspace(tmp_path)
    _write_fe(fe,
        "import {safeInvokeWithRetry} from 'x';\n"
        "export function call(){ return safeInvokeWithRetry('do_thing'); }\n",
    )
    _write_decorator(py, "do_thing")
    result = _run(tmp_path, frontend_src=fe, backend_python=py, plugins=[plugins])
    assert result.returncode == 0, result.stdout


def test_save_connection_detected_in_real_repo(tmp_path):
    """Sabotage against the actual bug: hub backend without save_connection.

    Simulates the workspace setup the user runs and proves the gate catches
    the missing save_connection (the bug from the screenshot) without
    needing the full monorepo to be present.
    """
    fe, py, plugins = _make_workspace(tmp_path)
    _write_fe(fe,
        "import {safeInvoke} from 'x';\n"
        "export function call(){ return safeInvoke('save_connection', {x: 1}); }\n",
    )
    _write_decorator(py, "list_things")
    result = _run(tmp_path, frontend_src=fe, backend_python=py, plugins=[plugins])
    assert result.returncode == 1
    payload = json.loads(result.stdout)
    assert "save_connection" in payload["missing_raw"]
    assert "save_connection" in payload["missing_baselined"]
