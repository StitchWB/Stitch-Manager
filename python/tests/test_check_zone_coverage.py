"""Regression tests for the public -> hub zone coverage gate."""

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SCRIPT = _REPO_ROOT / "python" / "scripts" / "check_zone_coverage.py"


def _load_gate():
    spec = importlib.util.spec_from_file_location("check_zone_coverage", _SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_zone_dir_file_is_covered_without_an_exception(monkeypatch) -> None:
    gate = _load_gate()
    monkeypatch.setattr(gate, "PUBLIC_ONLY_FILES", {})
    assert gate.coverage_errors(["python/stitch_backend/example.py"]) == []


def test_unclassified_file_fails_with_actionable_guidance(monkeypatch) -> None:
    gate = _load_gate()
    monkeypatch.setattr(gate, "PUBLIC_ONLY_FILES", {})
    errors = gate.coverage_errors(["python/tests/test_new_missing_mirror.py"])
    assert len(errors) == 1
    assert "unclassified file" in errors[0]
    assert "export_public_zone.py" in errors[0]
    assert "PUBLIC_ONLY_FILES" in errors[0]


def test_explicit_public_only_exception_is_accepted(monkeypatch) -> None:
    gate = _load_gate()
    rel = "python/tests/test_api_middleware.py"
    assert rel in gate.PUBLIC_ONLY_FILES
    monkeypatch.setattr(gate, "PUBLIC_ONLY_FILES", {rel: "test exception"})
    assert gate.coverage_errors([rel]) == []


def test_stale_exception_is_a_violation() -> None:
    gate = _load_gate()
    errors = gate.coverage_errors([])
    assert any("stale PUBLIC_ONLY_FILES entry" in error for error in errors)


def test_contradictory_exception_is_a_violation(monkeypatch) -> None:
    gate = _load_gate()
    rel = "python/stitch_backend/example.py"
    monkeypatch.setitem(gate.PUBLIC_ONLY_FILES, rel, "sabotage")
    errors = gate.coverage_errors([rel])
    assert any("contradictory PUBLIC_ONLY_FILES" in error for error in errors)


def test_cli_clean_shape_passes_and_sabotage_shape_fails(tmp_path: Path) -> None:
    """CLI contract in an isolated git repo: clean passes, unclassified fails."""
    gate = _load_gate()
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "-C", str(repo), "init", "-q"], check=True, capture_output=True)

    # Materialize every declared exception plus one covered runtime file.  This
    # keeps the isolated repo small while exercising the real CLI end to end.
    for rel in gate.PUBLIC_ONLY_FILES:
        path = repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("classified\n", encoding="utf-8")
    covered = repo / "python" / "stitch_backend" / "ok.py"
    covered.parent.mkdir(parents=True, exist_ok=True)
    covered.write_text("# covered by ZONE_DIRS\n", encoding="utf-8")
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True, capture_output=True)

    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}

    def run_gate() -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(_SCRIPT), "--repo-root", str(repo)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=env,
            timeout=30,
        )

    clean = run_gate()
    assert clean.returncode == 0, clean.stdout + clean.stderr
    assert "ZONE COVERAGE CLEAN" in clean.stdout

    sabotage = repo / "python" / "tests" / "test_zone_coverage_sabotage.py"
    sabotage.parent.mkdir(parents=True, exist_ok=True)
    sabotage.write_text("# gate sabotage fixture\n", encoding="utf-8")
    subprocess.run(
        ["git", "-C", str(repo), "add", "--", "python/tests/test_zone_coverage_sabotage.py"],
        check=True,
        capture_output=True,
    )
    red = run_gate()
    assert red.returncode == 1
    assert "test_zone_coverage_sabotage.py" in red.stdout
    assert "unclassified file" in red.stdout
