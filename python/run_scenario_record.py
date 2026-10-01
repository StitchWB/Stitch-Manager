#!/usr/bin/env python3
from __future__ import annotations

"""Scenario Recorder (MVP)

Records user interactions in a headed CloakBrowser persistent profile and exports
them as a simple Scenario JSON for later replay.

IMPORTANT (preprod use): this recorder injects a small script into the page to
observe click/input/change/submit/navigation events. This can be detectable.

Protocol to Rust JobManager:
- stdout: NDJSON protocol messages (type=log|event|result)
- stderr: diagnostic logs

Usage example:
  python python/run_scenario_record.py --alias "test@local.profile" --url "https://example.com/login" --scenario-name "login"
"""

# Early startup logging to stderr for debugging (after __future__ import)
import os
import sys
import time


def _safe_stderr(msg: str) -> None:
    """Write to stderr with encoding error handling for Windows."""
    try:
        sys.stderr.write(msg.rstrip() + os.linesep)
        sys.stderr.flush()
    except Exception:
        try:
            if hasattr(sys.stderr, 'buffer'):
                sys.stderr.buffer.write(msg.encode('utf-8', errors='replace') + b'\n')
        except Exception:
            pass

_safe_stderr(f"[run_scenario_record.py] Starting at {time.strftime('%Y-%m-%d %H:%M:%S')}")

import argparse
import asyncio
from pathlib import Path

# Ensure project imports work regardless of cwd (the package root is the "python/" dir).
PYTHON_ROOT = Path(__file__).resolve().parent
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

from autoreg.scenario_runner._common import _result
from autoreg.scenario_runner.record import engine as _engine


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Record a scenario in persistent browser profile")
    p.add_argument("--alias", required=True, help="Profile alias (maps to persistent profile id)")
    p.add_argument("--url", required=True, help="Start URL")
    p.add_argument("--scenario-name", default="scenario", help="Scenario name")
    p.add_argument("--timeout-s", type=int, default=3600, help="Max record duration")
    p.add_argument("--proxy", default="", help="Optional proxy URL")
    p.add_argument("--headless", action="store_true", help="Run browser in headless mode")
    p.add_argument(
        "--engine",
        choices=[
            "cloakbrowser",
            "cloackbrowser",  # legacy typo, kept for backward compatibility
            "shardbrowser",
            "shardx",
            "shard",
        ],
        default="cloakbrowser",
        help="Browser engine (default: cloakbrowser); ProfileLauncher normalizes aliases",
    )
    p.add_argument(
        "--config-json",
        default="",
        help="Optional JSON object for ProfileLauncher config (locale/timezone/geo/launch_kwargs/etc)",
    )
    p.add_argument(
        "--out", default="", help="Output directory (defaults to ~/.stitch-manager/scenarios)"
    )
    p.add_argument(
        "--command-file",
        default="",
        help="Optional NDJSON command file path for pause/resume/stop control",
    )
    p.add_argument(
        "--no-overlay",
        action="store_true",
        help="Disable in-browser recorder overlay UI (recording stays active)",
    )
    p.add_argument(
        "--capture",
        choices=["auto", "extension", "injected"],
        default="auto",
        help=(
            "Capture engine for native runs. auto: extension bridge when it "
            "connects, injected-script fallback (Cloak only). extension: "
            "require the extension bridge. injected: force the injected "
            "script (Cloak only; Shard has no injected path)."
        ),
    )
    return p.parse_args()


async def main_async() -> int:
    return await _engine.main_async(_parse_args())


def main() -> None:
    try:
        code = asyncio.run(main_async())
    except KeyboardInterrupt:
        _result(False, error={"code": "interrupted", "message": "Interrupted"})
        raise
    raise SystemExit(code)


if __name__ == "__main__":
    main()
