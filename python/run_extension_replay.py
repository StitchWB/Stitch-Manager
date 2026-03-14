#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import asyncio
import json
import signal
import time
from pathlib import Path
from typing import Any

from extension_runner_common import (
    WsServerState,
    event,
    log,
    now_iso,
    read_control_commands,
    result,
    wait_for_client_connected,
)

try:
    import websockets
except Exception as e:  # pragma: no cover
    websockets = None
    IMPORT_ERROR = e
else:
    IMPORT_ERROR = None


BRIDGE_REPLAY_PORT = 18732


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Replay scenario via browser extension bridge")
    p.add_argument("--alias", required=True)
    p.add_argument("--scenario-path", required=True)
    p.add_argument("--start-url", default="")
    p.add_argument("--from-step", type=int, default=1)
    p.add_argument("--command-file", default="")
    p.add_argument("--timeout-s", type=int, default=3600)
    return p.parse_args()


def _load_steps(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("Scenario must be JSON object")
    steps = raw.get("steps")
    if not isinstance(steps, list):
        raise ValueError("Scenario steps must be array")
    fixed: list[dict[str, Any]] = []
    for s in steps:
        if isinstance(s, dict):
            fixed.append(s)
    return raw, fixed


async def main_async() -> int:
    if websockets is None:
        result(False, error={"code": "import_error", "message": str(IMPORT_ERROR)})
        return 1

    args = parse_args()
    scenario_path = Path(args.scenario_path).expanduser().resolve()
    if not scenario_path.exists():
        result(False, error={"code": "scenario_not_found", "message": str(scenario_path)})
        return 1

    try:
        scenario, steps = _load_steps(scenario_path)
    except Exception as e:
        result(False, error={"code": "scenario_invalid", "message": str(e)})
        return 1

    run_id = f"ext_replay_{int(time.time())}"
    from_step = max(1, int(args.from_step or 1))
    replay_steps = steps[from_step - 1 :] if steps else []
    total_steps = len(steps)

    base_dir = Path.home() / ".stitch-manager" / "scenarios"
    base_dir.mkdir(parents=True, exist_ok=True)
    session_dir = base_dir / f"replay_{run_id}"
    session_dir.mkdir(parents=True, exist_ok=True)
    report_path = session_dir / "report.json"
    command_file = (
        Path(args.command_file).expanduser().resolve()
        if args.command_file
        else (session_dir / "control.ndjson")
    )
    command_file.parent.mkdir(parents=True, exist_ok=True)
    command_pos = 0

    server_state = WsServerState()
    stop_requested = False
    current_step = from_step - 1
    passed = 0
    failed = 0
    last_error: str | None = None

    async def send_json(payload: dict[str, Any]) -> bool:
        ws = server_state.current_ws
        if ws is None:
            return False
        try:
            await ws.send(json.dumps(payload, ensure_ascii=False))
            return True
        except Exception:
            server_state.current_ws = None
            return False

    async def ws_handler(websocket):
        nonlocal stop_requested, current_step, passed, failed, last_error
        server_state.current_ws = websocket
        try:
            async for message in websocket:
                try:
                    obj = json.loads(message)
                except Exception:
                    continue
                if not isinstance(obj, dict):
                    continue

                msg_type = str(obj.get("type") or "").strip().lower()
                payload = obj.get("payload") if isinstance(obj.get("payload"), dict) else {}

                if msg_type == "hello":
                    await send_json(
                        {
                            "type": "start_replay",
                            "payload": {
                                "runId": run_id,
                                "alias": args.alias,
                                "scenarioPath": str(scenario_path),
                                "startUrl": args.start_url.strip()
                                or str(scenario.get("startedUrl") or "https://google.com"),
                                "fromStep": from_step,
                                "steps": replay_steps,
                            },
                        }
                    )
                    continue

                if msg_type == "replay_step_start":
                    index = int(payload.get("index") or current_step + 1)
                    current_step = index
                    event(
                        "scenario.replay.step.start",
                        {
                            "runId": run_id,
                            "index": index,
                            "total": total_steps,
                            "kind": payload.get("kind") or "unknown",
                            "selector": payload.get("selector"),
                            "url": payload.get("url"),
                        },
                    )
                    continue

                if msg_type == "replay_step_done":
                    index = int(payload.get("index") or current_step)
                    passed += 1
                    event(
                        "scenario.replay.step.done",
                        {
                            "runId": run_id,
                            "index": index,
                            "total": total_steps,
                            "kind": payload.get("kind") or "unknown",
                            "selector": payload.get("selector"),
                            "url": payload.get("url"),
                        },
                    )
                    continue

                if msg_type == "replay_step_fail":
                    index = int(payload.get("index") or current_step)
                    failed += 1
                    err = str(payload.get("error") or "Replay step failed")
                    last_error = err
                    event(
                        "scenario.replay.step.fail",
                        {
                            "runId": run_id,
                            "index": index,
                            "total": total_steps,
                            "kind": payload.get("kind") or "unknown",
                            "selector": payload.get("selector"),
                            "url": payload.get("url"),
                            "error": err,
                        },
                    )
                    continue

                if msg_type == "replay_finished":
                    stop_requested = True
                    continue

                if msg_type == "replay_error":
                    stop_requested = True
                    last_error = str(payload.get("error") or "Replay failed")
                    continue
        finally:
            if server_state.current_ws is websocket:
                server_state.current_ws = None

    try:
        server = await websockets.serve(ws_handler, "127.0.0.1", BRIDGE_REPLAY_PORT)
    except OSError as e:
        result(
            False,
            error={
                "code": "bridge_bind_failed",
                "message": f"Failed to bind extension bridge on 127.0.0.1:{BRIDGE_REPLAY_PORT}: {e}",
            },
        )
        return 1

    def _sig_stop(*_):
        nonlocal stop_requested
        stop_requested = True

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _sig_stop)
        except Exception:
            pass

    event(
        "scenario.replay.location",
        {
            "runId": run_id,
            "sessionDir": str(session_dir),
            "artifactsDir": str(session_dir),
            "reportPath": str(report_path),
            "tracePath": None,
            "commandFilePath": str(command_file),
            "scenarioPath": str(scenario_path),
        },
    )
    event(
        "scenario.extension.bridge.ready",
        {
            "runId": run_id,
            "port": BRIDGE_REPLAY_PORT,
            "kind": "replay",
            "url": f"ws://127.0.0.1:{BRIDGE_REPLAY_PORT}",
        },
    )
    event(
        "scenario.replay.started",
        {
            "runId": run_id,
            "alias": args.alias,
            "steps": total_steps,
            "fromStep": from_step,
            "startUrl": args.start_url.strip()
            or str(scenario.get("startedUrl") or "https://google.com"),
            "mode": "extension",
        },
    )

    ok_client = await wait_for_client_connected(server_state, timeout_s=120.0)
    if not ok_client:
        server.close()
        await server.wait_closed()
        result(
            False, error={"code": "extension_not_connected", "message": "Extension did not connect"}
        )
        return 1

    started = time.time()
    while not stop_requested and (time.time() - started) < max(5, int(args.timeout_s)):
        command_pos, commands = read_control_commands(command_file, command_pos)
        for cmd in commands:
            command = str(cmd.get("command") or "").strip().lower()
            if command in ("stop", "abort", "cancel"):
                stop_requested = True
                await send_json({"type": "control", "payload": {"command": "stop"}})
                event("scenario.replay.control.stop", {"runId": run_id})
            elif command in ("resume", "continue"):
                await send_json({"type": "control", "payload": {"command": "resume"}})
                event("scenario.replay.manual.resume", {"runId": run_id})
            elif command == "pause":
                await send_json({"type": "control", "payload": {"command": "pause"}})
                event("scenario.replay.manual.pause", {"runId": run_id, "reason": "manual"})
        await asyncio.sleep(0.15)

    await send_json({"type": "stop_replay", "payload": {"runId": run_id}})

    finished_at = now_iso()
    report = {
        "runId": run_id,
        "alias": args.alias,
        "scenarioPath": str(scenario_path),
        "startedAt": now_iso(),
        "finishedAt": finished_at,
        "summary": {
            "stepsTotal": total_steps,
            "stepsPassed": passed,
            "stepsFailed": failed,
        },
        "error": last_error,
        "mode": "extension",
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    server.close()
    await server.wait_closed()

    ok = failed == 0 and not last_error
    if ok:
        event("scenario.replay.finished", {"runId": run_id, "passed": passed, "failed": failed})
        result(
            True,
            data={
                "runId": run_id,
                "reportPath": str(report_path),
                "passed": passed,
                "failed": failed,
            },
        )
        return 0

    result(
        False,
        error={
            "code": "replay_failed",
            "message": last_error or "Replay failed",
        },
        data={
            "runId": run_id,
            "reportPath": str(report_path),
            "passed": passed,
            "failed": failed,
        },
    )
    return 1


def main() -> None:
    try:
        code = asyncio.run(main_async())
    except KeyboardInterrupt:
        result(False, error={"code": "interrupted", "message": "Interrupted"})
        code = 130
    except Exception as e:
        log("error", f"Extension replay crashed: {e}", step="fatal")
        result(False, error={"code": "replay_failed", "message": str(e)})
        code = 1
    raise SystemExit(code)


if __name__ == "__main__":
    main()
