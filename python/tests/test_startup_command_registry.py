import subprocess
import sys
from pathlib import Path


def test_startup_registers_release_preview():
    result = subprocess.run(
        [sys.executable, "-c",
         "from stitch_backend.startup import import_command_modules; "
         "import_command_modules(); "
         "from stitch_backend.core.command_registry import list_commands; "
         "assert 'preview_release' in list_commands(), 'preview_release not registered'"],
        cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
