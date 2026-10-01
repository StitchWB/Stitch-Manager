"""Extension-hosted replay (ShardBrowser path: the extension executes DOM steps)."""

from __future__ import annotations

import asyncio
import time
from typing import Any

from .._common import _event, _now_iso, _result
from .report import _write_safe_report
from .session import ReplaySession


async def run(session: ReplaySession, *, bridge_port_override: int | None) -> int:
    """Replay delegated to the extension engine (ShardBrowser path).

    Python owns the browser (identity/proxy) via ProfileLauncher; the
    extension — loaded into the engine — executes the DOM steps. There is
    no Playwright context for Shard, so no tracing/Playwright artifacts;
    the report carries ``engine: "extension"`` and ``tracePath: None``.
    """
    from extension_bridge_host import BRIDGE_REPLAY_PORT, ReplayBridgeHost
    from extension_runner_common import read_control_commands

    args = session.args
    run_id = session.run_id
    scenario_path = session.scenario_path
    start_url = session.start_url
    from_step = session.from_step
    replay_steps = session.replay_steps
    total_steps = session.total_steps
    started_at = session.started_at
    report_path = session.report_path
    artifacts_dir = session.artifacts_dir
    command_file = session.command_file

    bridge_state: dict[str, Any] = {"finished": False, "error": None}

    def on_bridge_message(msg_type: str, payload: dict[str, Any]) -> None:
        if msg_type == "replay_step_start":
            _event(
                "scenario.replay.step.start",
                {
                    "runId": run_id,
                    "index": payload.get("index"),
                    "total": total_steps,
                    "kind": payload.get("kind") or "unknown",
                    "selector": payload.get("selector"),
                    "url": payload.get("url"),
                },
            )
        elif msg_type == "replay_step_done":
            session.passed += 1
            _event(
                "scenario.replay.step.done",
                {
                    "runId": run_id,
                    "index": payload.get("index"),
                    "total": total_steps,
                    "kind": payload.get("kind") or "unknown",
                },
            )
        elif msg_type == "replay_step_waiting":
            _event(
                "scenario.replay.step.waiting",
                {
                    "runId": run_id,
                    "index": payload.get("index"),
                    "total": total_steps,
                    "kind": payload.get("kind") or "unknown",
                    "message": payload.get("message") or "Manual action required",
                },
            )
        elif msg_type == "replay_step_fail":
            session.failed += 1
            entry = {
                "index": payload.get("index"),
                "kind": payload.get("kind") or "unknown",
                "selector": payload.get("selector"),
                "url": payload.get("url"),
                "error": str(payload.get("error") or "step failed"),
                "artifacts": {},
            }
            session.failed_steps.append(entry)
            _event("scenario.replay.step.fail", {"runId": run_id, **entry})
        elif msg_type == "replay_finished":
            bridge_state["finished"] = True
        elif msg_type == "replay_error":
            bridge_state["error"] = str(payload.get("error") or "replay failed")
            bridge_state["finished"] = True
        elif msg_type == "session_active":
            _event(
                "scenario.replay.session.active",
                {
                    "runId": payload.get("runId") or run_id,
                    "current": payload.get("current"),
                    "total": payload.get("total"),
                    "paused": payload.get("paused"),
                },
            )

    bridge = ReplayBridgeHost(
        run_id=run_id,
        alias=args.alias,
        scenario_path=str(scenario_path),
        start_url=start_url,
        from_step=from_step,
        steps=replay_steps,
        on_message=on_bridge_message,
        port=(
            bridge_port_override
            if bridge_port_override is not None
            else BRIDGE_REPLAY_PORT
        ),
    )
    if not await bridge.start():
        _result(
            False,
            error={
                "code": "replay_bridge_unavailable",
                "message": (
                    "Could not start the extension replay bridge "
                    "(websockets missing or port busy)."
                ),
            },
        )
        return 1

    ext_launcher: Any | None = None
    try:
        from autoreg.browser.profile_launcher import ProfileLauncher

        ext_launcher = ProfileLauncher(
            profile_id=args.alias,
            headless=bool(args.headless),
            proxy=session.active_proxy or None,
            config=session.config,
            engine=args.engine,
        )
        await ext_launcher.open(start_url, wait_until="domcontentloaded")
    except Exception as e:
        await bridge.close()
        _result(False, error={"code": "browser_launch_failed", "message": str(e)})
        return 1

    # Browser is up: release queued hellos -> start_replay.
    await bridge.arm()

    if not await bridge.wait_client(timeout_s=120.0):
        try:
            await ext_launcher.close()
        except Exception:
            pass
        await bridge.close()
        _result(
            False,
            error={
                "code": "extension_not_connected",
                "message": "Extension did not connect for replay within 120s",
            },
        )
        return 1

    deadline = time.time() + float(max(1, args.timeout_s))
    command_pos = 0
    try:
        while not bridge_state["finished"] and time.time() < deadline:
            command_pos, commands = read_control_commands(command_file, command_pos)
            for cmd in commands:
                command = str(cmd.get("command") or "").strip().lower()
                if command in ("stop", "abort", "cancel"):
                    await bridge.send({"type": "control", "payload": {"command": "stop"}})
                    bridge_state["finished"] = True
                    _event("scenario.replay.control.stop", {"runId": run_id})
                elif command in ("resume", "continue"):
                    await bridge.send({"type": "control", "payload": {"command": "resume"}})
                    _event("scenario.replay.control.resume", {"runId": run_id})
                elif command == "pause":
                    await bridge.send({"type": "control", "payload": {"command": "pause"}})
                    _event("scenario.replay.control.pause", {"runId": run_id})
            await asyncio.sleep(0.15)
    finally:
        await bridge.send({"type": "stop_replay", "payload": {"runId": run_id}})
        try:
            if ext_launcher is not None:
                await ext_launcher.close()
        except Exception:
            pass
        await bridge.close()

    ok = session.failed == 0 and not bridge_state["error"]
    report = {
        "version": 1,
        "runId": run_id,
        "status": "succeeded" if ok else "failed",
        "startedAt": started_at,
        "finishedAt": _now_iso(),
        "scenarioPath": str(scenario_path),
        "stepsTotal": total_steps,
        "stepsPassed": session.passed,
        "stepsFailed": session.failed,
        "failedSteps": session.failed_steps,
        "artifactsDir": str(artifacts_dir),
        "tracePath": None,
        "commandFilePath": str(command_file),
        "error": bridge_state["error"],
        "engine": "extension",
    }
    _write_safe_report(report_path, report)
    if ok:
        _event(
            "scenario.replay.finished",
            {"runId": run_id, "stepsPassed": session.passed, "stepsFailed": session.failed},
        )
        _event("scenario.replay.saved", {"reportPath": str(report_path), "status": "succeeded"})
        _result(
            True,
            data={
                "runId": run_id,
                "stepsTotal": total_steps,
                "stepsPassed": session.passed,
                "stepsFailed": session.failed,
                "reportPath": str(report_path),
                "tracePath": None,
                "artifactsDir": str(artifacts_dir),
                "commandFilePath": str(command_file),
            },
        )
        return 0
    _event("scenario.replay.saved", {"reportPath": str(report_path), "status": "failed"})
    _result(
        False,
        data={"reportPath": str(report_path), "runId": run_id},
        error={
            "code": "replay_failed",
            "message": bridge_state["error"] or f"{session.failed} step(s) failed",
        },
    )
    return 1
