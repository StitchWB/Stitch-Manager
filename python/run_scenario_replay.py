#!/usr/bin/env python3
"""Scenario Replay Runner (MVP)

Replays a previously recorded scenario JSON against a CloakBrowser persistent profile.

Features:
- structured step-by-step events for UI HUD
- manual pause/resume/abort (CAPTCHA handoff)
- artifact capture on failure (screenshot/html + optional trace)
- control channel via NDJSON command file

Protocol to Rust JobManager:
- stdout: NDJSON protocol messages (type=log|event|result)
- stderr: diagnostic logs
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# Ensure project imports work regardless of cwd (the package root is the "python/" dir).
PYTHON_ROOT = Path(__file__).resolve().parent
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

from autoreg.scenario_runner._common import _result
from autoreg.scenario_runner.replay import engine as _engine
from autoreg.scenario_runner.replay.steps import _run_step, _sanitize_step

__all__ = ["_parse_args", "main_async", "main", "_run_step", "_sanitize_step"]

# Test seam: override the extension replay bridge port (None → canonical 18732).
_REPLAY_BRIDGE_PORT_OVERRIDE: int | None = None


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Replay a scenario in persistent browser profile")
    p.add_argument("--alias", required=True, help="Profile alias")
    p.add_argument("--scenario-path", required=True, help="Path to scenario.json")
    p.add_argument(
        "--from-step",
        type=int,
        default=1,
        help="Optional 1-based step index to start replay from",
    )
    p.add_argument("--start-url", default="", help="Optional start URL override")
    p.add_argument("--timeout-s", type=int, default=3600, help="Max replay duration")
    p.add_argument("--pause-timeout-s", type=int, default=1800, help="Timeout for manual pause")
    p.add_argument("--proxy", default="", help="Optional proxy URL")
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
        help=(
            "Browser engine (default: cloakbrowser). Cloak replays via the "
            "Playwright runner; Shard replays via the extension engine "
            "(no Playwright context exists for Shard)."
        ),
    )
    p.add_argument(
        "--config-json",
        default="",
        help="Optional JSON object for ProfileLauncher config (locale/timezone/geo/launch_kwargs/etc)",
    )
    p.add_argument("--continue-on-error", action="store_true", help="Continue after step errors")
    p.add_argument("--headless", action="store_true", help="Run browser in headless mode")
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not launch a browser; only validate scenario + manual pause control flow",
    )
    p.add_argument(
        "--out", default="", help="Output directory (defaults to ~/.stitch-manager/scenarios)"
    )
    return p.parse_args()


async def main_async() -> int:
    # Tests monkeypatch _REPLAY_BRIDGE_PORT_OVERRIDE on this module; forward it to the engine.
    _engine._REPLAY_BRIDGE_PORT_OVERRIDE = _REPLAY_BRIDGE_PORT_OVERRIDE
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
