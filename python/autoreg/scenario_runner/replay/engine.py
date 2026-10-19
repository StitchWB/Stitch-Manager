"""Replay orchestration: scenario load, sanitize, dispatch to the engine-specific path."""

from __future__ import annotations

import time
from pathlib import Path
from typing import TYPE_CHECKING, Any

from .._common import (
    _event,
    _now_iso,
    _result,
    build_runtime_proxy_map,
    parse_config_json,
    pin_playwright_browsers_path,
    resolve_out_dir,
)
from . import dry_run, extension_engine, pw_loop
from .control import CommandTail
from .scenario import _load_scenario, _normalize_to_v2
from .session import ReplaySession
from .steps import _sanitize_steps

if TYPE_CHECKING:
    import argparse

# Test seam: run_scenario_replay mirrors its module attribute here on each main_async() call.
_REPLAY_BRIDGE_PORT_OVERRIDE: int | None = None


async def main_async(args: argparse.Namespace) -> int:
    try:
        from autoreg.browser.profile_launcher import _normalize_engine
        from autoreg.core.paths import get_paths
    except Exception as e:
        _result(False, error={"code": "import_error", "message": str(e)})
        return 1

    paths = get_paths()

    pin_playwright_browsers_path(paths)

    scenario_path = Path(args.scenario_path).expanduser().resolve()
    if not scenario_path.exists():
        _result(
            False,
            error={"code": "scenario_not_found", "message": f"File not found: {scenario_path}"},
        )
        return 1

    try:
        scenario_raw = _load_scenario(scenario_path)
        scenario = _normalize_to_v2(scenario_raw)
    except Exception as e:
        _result(False, error={"code": "invalid_scenario", "message": str(e)})
        return 1

    run_id = f"replay_{int(time.time())}"
    out_dir = resolve_out_dir(args, paths)
    session_dir = out_dir / run_id
    artifacts_dir = session_dir / "artifacts"
    session_dir.mkdir(parents=True, exist_ok=True)
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    command_file = session_dir / "control.ndjson"
    cmd_tail = CommandTail(command_file)
    cmd_tail.ensure()

    report_path = session_dir / "replay_report.json"
    trace_path = session_dir / "trace.zip"

    config = parse_config_json(args)

    runtime_proxy_map = build_runtime_proxy_map(config)

    start_url = (
        args.start_url.strip()
        if args.start_url.strip()
        else str(
            scenario.get("startedUrl")
            or scenario.get("startUrl")
            or scenario.get("started_url")
            or "about:blank"
        )
    )
    steps_raw = scenario.get("steps")
    steps: list[dict[str, Any]] = (
        [s for s in steps_raw if isinstance(s, dict)] if isinstance(steps_raw, list) else []
    )
    sanitized_steps, dropped_steps = _sanitize_steps(steps, runtime_proxy_map=runtime_proxy_map)
    if dropped_steps:
        _event(
            "scenario.replay.sanitize",
            {
                "dropped": dropped_steps,
                "droppedCount": len(dropped_steps),
                "before": len(steps),
                "after": len(sanitized_steps),
            },
        )
    steps = sanitized_steps
    total_steps = len(steps)
    from_step = max(1, int(getattr(args, "from_step", 1) or 1))
    if total_steps > 0 and from_step > total_steps:
        from_step = total_steps
    replay_steps = steps[from_step - 1 :] if total_steps > 0 else []

    _event(
        "scenario.replay.location",
        {
            "runId": run_id,
            "sessionDir": str(session_dir),
            "artifactsDir": str(artifacts_dir),
            "reportPath": str(report_path),
            "tracePath": str(trace_path),
            "commandFilePath": str(command_file),
            "scenarioPath": str(scenario_path),
        },
    )

    _event(
        "scenario.replay.started",
        {
            "runId": run_id,
            "alias": args.alias,
            "steps": total_steps,
            "fromStep": from_step,
            "startUrl": start_url,
        },
    )

    if total_steps > 0 and from_step > 1:
        _event(
            "scenario.replay.resume.from_step",
            {
                "runId": run_id,
                "fromStep": from_step,
                "totalSteps": total_steps,
            },
        )

    started_at = _now_iso()

    session = ReplaySession(
        args=args,
        run_id=run_id,
        session_dir=session_dir,
        artifacts_dir=artifacts_dir,
        command_file=command_file,
        cmd_tail=cmd_tail,
        report_path=report_path,
        trace_path=trace_path,
        config=config,
        start_url=start_url,
        total_steps=total_steps,
        from_step=from_step,
        replay_steps=replay_steps,
        scenario_path=scenario_path,
        started_at=started_at,
    )

    engine_norm = _normalize_engine(args.engine)

    if engine_norm != "cloakbrowser":
        return await extension_engine.run(
            session, bridge_port_override=_REPLAY_BRIDGE_PORT_OVERRIDE
        )

    if args.dry_run:
        return await dry_run.run(session)

    return await pw_loop.run(session)
