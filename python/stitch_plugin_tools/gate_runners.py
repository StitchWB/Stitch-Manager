"""Per-gate runners for the plugin dev loop (``check`` / ``verify``).

Each runner returns a gate dict ``{"name", "status", "blocking", "findings"}``
(plus an optional ``reason`` for a skipped gate); ``status`` is one of
``pass`` / ``fail`` / ``warn`` / ``skipped``.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from autoreg.plugin.manifest import MANIFEST_FILENAME
from stitch_plugin_tools import classify

CATALOG_FILENAME = "catalog.json"

_HUB_PYTHON = Path(__file__).resolve().parents[1]
_MAX_FINDING_CHARS = 2000


def _tail(text: str) -> str:
    text = text.strip()
    if len(text) <= _MAX_FINDING_CHARS:
        return text
    return "…" + text[-_MAX_FINDING_CHARS:]


def _subprocess_gate(
    name: str,
    argv: list[str],
    *,
    blocking: bool,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
) -> dict[str, Any]:
    try:
        proc = subprocess.run(
            argv,
            cwd=str(cwd) if cwd else None,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    except OSError as exc:
        return {
            "name": name,
            "status": "fail",
            "blocking": blocking,
            "findings": [{"code": f"{name}.error", "message": str(exc)}],
        }
    if proc.returncode == 0:
        return {"name": name, "status": "pass", "blocking": blocking, "findings": []}
    return {
        "name": name,
        "status": "fail",
        "blocking": blocking,
        "findings": [
            {"code": f"{name}.failed", "message": _tail(proc.stdout + proc.stderr)}
        ],
    }


def ruff_gate(package_dir: Path) -> dict[str, Any]:
    return _subprocess_gate(
        "ruff",
        [
            sys.executable,
            "-m",
            "ruff",
            "check",
            str(package_dir),
            "--extend-exclude",
            "_vendor",
        ],
        blocking=True,
    )


def manifest_lint_gate(package_dir: Path) -> dict[str, Any]:
    return _subprocess_gate(
        "manifest-lint",
        [
            sys.executable,
            "-m",
            "stitch_plugin_tools",
            "manifest-lint",
            str(package_dir / MANIFEST_FILENAME),
        ],
        blocking=True,
    )


def pytest_gate(package_dir: Path, *, provider: bool) -> dict[str, Any]:
    tests_dir = package_dir / "tests"
    if not tests_dir.is_dir():
        return {
            "name": "pytest",
            "status": "skipped",
            "blocking": True,
            "findings": [],
            "reason": "no tests/ directory",
        }
    env = None
    if provider:
        # provider tests import autoreg; the hub python/ dir is not on the child's sys.path.
        env = dict(os.environ)
        existing = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = str(_HUB_PYTHON) + (
            os.pathsep + existing if existing else ""
        )
    return _subprocess_gate(
        "pytest",
        [sys.executable, "-m", "pytest", str(tests_dir), "-q", "--timeout=60"],
        blocking=True,
        cwd=package_dir,
        env=env,
    )


def typegen_drift_gate(package_dir: Path) -> dict[str, Any]:
    from stitch_plugin_tools.typegen import run_typegen
    from stitch_plugin_tools.upgrade import _package_module_dir

    if _package_module_dir(package_dir) is None:
        return {
            "name": "typegen-drift",
            "status": "skipped",
            "blocking": False,
            "findings": [],
            "reason": "no Python module dir",
        }
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        rc = run_typegen(package_dir, check=True)
    if rc == 0:
        return {
            "name": "typegen-drift",
            "status": "pass",
            "blocking": False,
            "findings": [],
        }
    return {
        "name": "typegen-drift",
        "status": "warn",
        "blocking": False,
        "findings": [
            {"code": "typegen.drift", "message": _tail(err.getvalue() or out.getvalue())}
        ],
    }


def vendor_drift_gate(package_dir: Path) -> dict[str, Any]:
    from stitch_plugin_tools.upgrade import _package_module_dir
    from stitch_plugin_tools.vendoring import (
        vendored_helpers_matches_canonical,
        vendored_matches_canonical,
    )

    module_dir = _package_module_dir(package_dir)
    if module_dir is None:
        return {
            "name": "vendor-drift",
            "status": "skipped",
            "blocking": False,
            "findings": [],
            "reason": "no Python module dir",
        }
    findings: list[dict[str, Any]] = []
    if not vendored_matches_canonical(module_dir):
        findings.append({
            "code": "vendor.rpc_server_drift",
            "message": (
                "vendored _vendor/rpc_server.py drifts from canonical; run "
                "`python -m stitch_plugin_tools vendor <pkg>`"
            ),
        })
    if not vendored_helpers_matches_canonical(module_dir):
        findings.append({
            "code": "vendor.plugin_helpers_drift",
            "message": (
                "vendored _vendor/plugin_helpers.py drifts from canonical; run "
                "`python -m stitch_plugin_tools vendor <pkg>`"
            ),
        })
    return {
        "name": "vendor-drift",
        "status": "warn" if findings else "pass",
        "blocking": False,
        "findings": findings,
    }


def catalog_lint_gate(package_dir: Path) -> dict[str, Any]:
    catalog_path = package_dir / CATALOG_FILENAME
    if not catalog_path.is_file():
        return {
            "name": "catalog-lint",
            "status": "fail",
            "blocking": True,
            "findings": [
                {"code": "catalog.missing", "message": f"requires a {catalog_path}"}
            ],
        }
    return _subprocess_gate(
        "catalog-lint",
        [sys.executable, "-m", "stitch_plugin_tools", "catalog-lint", str(catalog_path)],
        blocking=True,
    )


def _run_classify(package_dir: Path) -> tuple[dict | None, str]:
    """Run classify as a live subprocess; return (verdict, stderr)."""
    proc = subprocess.run(
        [sys.executable, "-m", "stitch_plugin_tools", "classify", str(package_dir)],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    verdict: dict | None = None
    if proc.returncode == 0:
        try:
            parsed = json.loads(proc.stdout.strip())
        except ValueError:
            parsed = None
        if isinstance(parsed, dict):
            verdict = parsed
    return verdict, proc.stderr.strip()


def classify_gate(package_dir: Path) -> tuple[dict[str, Any], dict | None, bool]:
    """Return (gate, verdict, cannot_classify)."""
    if not classify.zone_rules_available():
        gate = {
            "name": "classify", "status": "skipped", "blocking": True,
            "findings": [], "reason": "hub-only on public checkout",
        }
        return gate, None, False
    verdict, stderr = _run_classify(package_dir)
    if verdict is None:
        gate = {
            "name": "classify", "status": "fail", "blocking": True,
            "findings": [{"code": "classify.error", "message": stderr or "no verdict"}],
        }
        return gate, None, True
    if verdict.get("class") == "prohibited":
        gate = {
            "name": "classify", "status": "fail", "blocking": True,
            "findings": [
                {"code": "classify.prohibited", "message": verdict.get("reason", "")}
            ],
        }
        return gate, verdict, False
    gate = {"name": "classify", "status": "pass", "blocking": True, "findings": []}
    return gate, verdict, False
