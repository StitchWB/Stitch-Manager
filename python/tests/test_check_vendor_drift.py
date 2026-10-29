from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from stitch_plugin_tools.vendoring import vendor_all

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check_vendor_drift.py"
_REPO_PYTHON = Path(__file__).resolve().parents[1]


def _make_plugin_package(plugins_dir: Path) -> Path:
    module_dir = plugins_dir / "demo-svc" / "demo_svc"
    module_dir.mkdir(parents=True)
    (module_dir / "__main__.py").write_text(
        "from __future__ import annotations\n\ndef main() -> None:\n    pass\n",
        encoding="utf-8",
    )
    vendor_all(module_dir)
    return module_dir


def _run_check(plugins_dir: Path) -> subprocess.CompletedProcess[str]:
    # force the child's stdout encoding to match the utf-8 decode below
    env = {
        **os.environ,
        "PYTHONPATH": str(_REPO_PYTHON),
        "PYTHONIOENCODING": "utf-8",
    }
    return subprocess.run(
        [sys.executable, str(_SCRIPT), "--plugins-dir", str(plugins_dir)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
        timeout=60,
    )


def test_helpers_drift_goes_red(tmp_path: Path) -> None:
    module_dir = _make_plugin_package(tmp_path)
    helpers_path = module_dir / "_vendor" / "plugin_helpers.py"
    helpers_path.write_text(
        helpers_path.read_text(encoding="utf-8") + "# drifted\n",
        encoding="utf-8",
    )
    result = _run_check(tmp_path)
    assert result.returncode == 1
    assert "plugin_helpers.py" in result.stdout
    assert "python -m stitch_plugin_tools vendor" in result.stdout


def test_rpc_drift_goes_red(tmp_path: Path) -> None:
    module_dir = _make_plugin_package(tmp_path)
    rpc_path = module_dir / "_vendor" / "rpc_server.py"
    rpc_path.write_text(
        rpc_path.read_text(encoding="utf-8") + "# drifted\n",
        encoding="utf-8",
    )
    result = _run_check(tmp_path)
    assert result.returncode == 1
    assert "rpc_server.py" in result.stdout


def test_clean_package_passes(tmp_path: Path) -> None:
    _make_plugin_package(tmp_path)
    result = _run_check(tmp_path)
    assert result.returncode == 0
    assert "VENDOR CLEAN" in result.stdout
