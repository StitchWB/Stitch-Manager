#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import asyncio
import json
import signal
import sys
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

BRIDGE_RECORD_PORT = 18731

try:
    import websockets
except Exception as e:  # pragma: no cover
    websockets = None
    IMPORT_ERROR = e
else:
    IMPORT_ERROR = None


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Record scenario via browser extension bridge")
    p.add_argument("--alias", required=True)
    p.add_argument("--url", required=True)
    p.add_argument("--scenario-name", default="scenario")
    p.add_argument("--timeout-s", type=int, default=3600)
    p.add_argument("--command-file", default="")
    return p.parse_args()


async def main_async() -> int:
    if websockets is None:
        result(False, error={"code": "import_error", "message": str(IMPORT_ERROR)})
        return 1

    args = parse_args()
    run_id = f"ext_rec_{int(time.time())}"

    base_dir = Path.home() / ".stitch-manager" / "scenarios"
    base_dir.mkdir(parents=True, exist_ok=True)
    session_dir = base_dir / f"{args.scenario_name}_{run_id}"
    session_dir.mkdir(parents=True, exist_ok=True)
    scenario_path = session_dir / "scenario.json"
    command_file = (
        Path(args.command_file).expanduser().resolve()
        if args.command_file
        else (session_dir / "control.ndjson")
    )
    command_file.parent.mkdir(parents=True, exist_ok=True)
    command_pos = 0

    stop_requested = False
    server_state = WsServerState()
    steps: list[dict[str, Any]] = []

    port = BRIDGE_RECORD_PORT

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
        nonlocal stop_requested
        server_state.current_ws = websocket
        event("scenario.record.ready", {"runId": run_id, "mode": "extension"})
        try:
            async for message in websocket:
                try:
                    obj = json.loads(message)
                except Exception:
                    continue
                if not isinstance(obj, dict):
                    continue
                msg_type = str(obj.get("type") or "").strip().lower()
                if msg_type == "hello":
                    await send_json(
                        {
                            "type": "start_record",
                            "payload": {
                                "runId": run_id,
                                "alias": args.alias,
                                "scenarioName": args.scenario_name,
                                "startUrl": args.url,
                            },
                        }
                    )
                    continue

                if msg_type == "record_event":
                    payload = obj.get("payload")
                    if isinstance(payload, dict):
                        kind = str(payload.get("kind") or "unknown")
                        step = {
                            "kind": kind,
                            "ts": str(payload.get("ts") or now_iso()),
                            "url": payload.get("url")
                            if isinstance(payload.get("url"), str)
                            else None,
                            "selector": payload.get("selector")
                            if isinstance(payload.get("selector"), str)
                            else None,
                            "value": payload.get("value")
                            if isinstance(payload.get("value"), str)
                            else None,
                            "meta": payload.get("meta")
                            if isinstance(payload.get("meta"), dict)
                            else {},
                        }
                        steps.append(step)
                        event(
                            "scenario.record.step",
                            {"runId": run_id, "index": len(steps), "kind": kind},
                        )
                    continue

                if msg_type == "record_stopped":
                    stop_requested = True
                    continue

                if msg_type == "session_active":
                    event(
                        "scenario.record.session.active",
                        {
                            "runId": obj.get("payload", {}).get("runId") or run_id,
                            "mode": obj.get("payload", {}).get("mode") or "record",
                            "stepCount": obj.get("payload", {}).get("stepCount"),
                            "paused": obj.get("payload", {}).get("paused"),
                        },
                    )
                    continue

                payload_hint = obj.get("payload") if isinstance(obj.get("payload"), dict) else {}
                log(
                    "warn",
                    f"Unhandled WS message type: {msg_type}",
                    step="ws_handler",
                    data={"rawType": msg_type, "payload": payload_hint},
                )
        finally:
            if server_state.current_ws is websocket:
                server_state.current_ws = None

    try:
        server = await websockets.serve(ws_handler, "127.0.0.1", port)
    except OSError as e:
        result(
            False,
            error={
                "code": "bridge_bind_failed",
                "message": f"Failed to bind extension bridge on 127.0.0.1:{port}: {e}",
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
        "scenario.record.location",
        {
            "runId": run_id,
            "sessionDir": str(session_dir),
            "scenarioPath": str(scenario_path),
            "commandFilePath": str(command_file),
        },
    )
    event(
        "scenario.extension.bridge.ready",
        {
            "runId": run_id,
            "port": port,
            "kind": "record",
            "url": f"ws://127.0.0.1:{port}",
        },
    )
    event("scenario.record.started", {"runId": run_id, "alias": args.alias, "mode": "extension"})

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
            if command in ("stop", "cancel", "abort"):
                stop_requested = True
            elif command in ("pause", "resume", "continue"):
                await send_json({"type": "control", "payload": {"command": command}})
                event("scenario.record.control", {"runId": run_id, "command": command})
        await asyncio.sleep(0.15)

    await send_json({"type": "stop_record", "payload": {"runId": run_id}})

    scenario = {
        "version": 1,
        "name": args.scenario_name,
        "runId": run_id,
        "alias": args.alias,
        "startedUrl": args.url,
        "recordedAt": now_iso(),
        "steps": steps,
    }
    scenario_path.write_text(json.dumps(scenario, ensure_ascii=False, indent=2), encoding="utf-8")

    server.close()
    await server.wait_closed()

    event("scenario.record.saved", {"path": str(scenario_path), "steps": len(steps)})
    result(True, data={"scenarioPath": str(scenario_path), "steps": len(steps), "runId": run_id})
    return 0


def main() -> None:
    try:
        code = asyncio.run(main_async())
    except KeyboardInterrupt:
        result(False, error={"code": "interrupted", "message": "Interrupted"})
        code = 130
    except Exception as e:
        log("error", f"Extension recorder crashed: {e}", step="fatal")
        result(False, error={"code": "record_failed", "message": str(e)})
        code = 1
    raise SystemExit(code)


if __name__ == "__main__":
    main()
