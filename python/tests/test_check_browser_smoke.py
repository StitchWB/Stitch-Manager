"""Real-run and sabotage tests for scripts/check-browser-smoke.mjs."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
GATE = REPO / "scripts" / "check-browser-smoke.mjs"
NODE = "node"

pytestmark = pytest.mark.skipif(
    not (REPO / "node_modules" / "playwright-core").exists(),
    reason="playwright-core is not installed (run npm install)",
)


def _run(*extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [NODE, str(GATE), *extra],
        capture_output=True,
        text=True,
        timeout=180,
        cwd=REPO,
    )


def _payload(result: subprocess.CompletedProcess) -> dict:
    for line in reversed(result.stdout.strip().splitlines()):
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue
    return {}


def _skip_when_no_browser(payload: dict) -> None:
    if payload.get("skipped"):
        pytest.skip(payload.get("reason", "browser unavailable"))


def test_browser_smoke_green():
    result = _run()
    payload = _payload(result)
    _skip_when_no_browser(payload)
    assert result.returncode == 0, result.stdout + result.stderr
    assert payload.get("ok") is True


def test_browser_smoke_fails_when_probe_export_missing():
    result = _run("--probe-export", "definitelyNotAnExport")
    payload = _payload(result)
    _skip_when_no_browser(payload)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "definitelyNotAnExport" in result.stdout + result.stderr