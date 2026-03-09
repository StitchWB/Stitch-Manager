#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Composed flow runner.

Executes a compiled flow plan (segments), where every segment maps to an
existing scenario replay run with optional context override and variable bindings.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

# Ensure imports are resolvable when started from different cwd.
PYTHON_ROOT = Path(__file__).resolve().parent
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))


def _emit(obj: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _event(name: str, payload: dict[str, Any] | None = None) -> None:
    _emit(
        {
            "type": "event",
            "level": "info",
            "message": name,
            "data": payload or {},
        }
    )


def _result(ok: bool, data: dict[str, Any] | None = None, error: dict[str, Any] | None = None) -> None:
    _emit(
        {
            "type": "result",
            "ok": ok,
            "message": "ok" if ok else "error",
            "data": data or {},
            "error": error,
        }
    )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run composed scenario flow")
    parser.add_argument("--alias", required=True, help="Default profile alias")
    parser.add_argument("--plan-json", default="", help="Compiled flow plan JSON")
    parser.add_argument("--plan-path", default="", help="Path to compiled flow plan JSON")
    parser.add_argument("--headless", action="store_true", help="Run segments in headless mode")
    return parser.parse_args()


async def _run_segment(segment: dict[str, Any], *, force_headless: bool) -> dict[str, Any]:
    import run_scenario_replay as replay_runner

    index = int(segment.get("index") or 0)
    total = int(segment.get("total") or 0)

    scenario_path = str(segment.get("scenarioPath") or "").strip()
    if not scenario_path:
        raise RuntimeError("Segment has empty scenarioPath")

    token_map: dict[str, str] = {}
    variables = segment.get("resolvedVariables")
    if isinstance(variables, dict):
        for key, value in variables.items():
            token_map[str(key)] = "" if value is None else str(value)

    creds = segment.get("credentials")
    if isinstance(creds, dict):
        login = creds.get("login")
        password = creds.get("password")
        if isinstance(login, str):
            token_map.setdefault("login", login)
        if isinstance(password, str):
            token_map.setdefault("password", password)

    working_dir = Path(os.environ.get("STITCH_COMPOSED_FLOW_DIR") or "").expanduser().resolve()
    if not str(working_dir):
        working_dir = Path.cwd().resolve()
    composed_dir = working_dir / "composed-flows"
    composed_dir.mkdir(parents=True, exist_ok=True)

    materialized_path = _materialize_segment_scenario(
        source_path=Path(scenario_path).expanduser().resolve(),
        out_path=composed_dir / f"segment_{index:04d}_of_{max(total, 1):04d}.scenario.json",
        tokens=token_map,
    )

    args = [
        "run_scenario_replay.py",
        "--alias",
        str(segment.get("alias") or ""),
        "--scenario-path",
        str(materialized_path),
    ]

    start_url = segment.get("startUrl")
    if isinstance(start_url, str) and start_url.strip():
        args.extend(["--start-url", start_url.strip()])

    proxy = segment.get("proxy")
    if isinstance(proxy, str) and proxy.strip():
        args.extend(["--proxy", proxy.strip()])

    if bool(segment.get("continueOnError")):
        args.append("--continue-on-error")
    if force_headless:
        args.append("--headless")

    # Inject resolved variables and credentials as config-json overlay.
    merged_cfg: dict[str, Any] = {}
    config_json = segment.get("configJson")
    if isinstance(config_json, str) and config_json.strip():
        try:
            parsed_cfg = json.loads(config_json)
            if isinstance(parsed_cfg, dict):
                merged_cfg.update(parsed_cfg)
        except Exception:
            # keep runner permissive, same philosophy as replay runner config parsing
            pass

    if token_map:
        merged_cfg["flow_vars"] = token_map
    if isinstance(creds, dict):
        login = creds.get("login")
        password = creds.get("password")
        if isinstance(login, str) and login.strip():
            merged_cfg["flow_login"] = login.strip()
        if isinstance(password, str) and password.strip():
            merged_cfg["flow_password"] = password.strip()

    if merged_cfg:
        args.extend(["--config-json", json.dumps(merged_cfg, ensure_ascii=False)])

    prev_argv = list(sys.argv)
    try:
        sys.argv = args
        code = await replay_runner.main_async()
    finally:
        sys.argv = prev_argv

    if code != 0:
        raise RuntimeError(f"Segment failed with code={code}")

    return {
        "index": index,
        "name": str(segment.get("name") or "segment"),
        "scenarioPath": str(segment.get("scenarioPath") or ""),
        "materializedPath": str(materialized_path),
        "alias": str(segment.get("alias") or ""),
        "ok": True,
    }


def _replace_tokens(value: Any, tokens: dict[str, str]) -> Any:
    if isinstance(value, str):
        out = value
        for key, token in tokens.items():
            out = out.replace("{{" + key + "}}", token)
        return out
    if isinstance(value, list):
        return [_replace_tokens(v, tokens) for v in value]
    if isinstance(value, dict):
        return {k: _replace_tokens(v, tokens) for k, v in value.items()}
    return value


def _materialize_segment_scenario(source_path: Path, out_path: Path, tokens: dict[str, str]) -> Path:
    if not source_path.exists():
        raise RuntimeError(f"Scenario file not found: {source_path}")

    try:
        raw = json.loads(source_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RuntimeError(f"Failed to parse scenario JSON {source_path}: {exc}") from exc

    transformed = _replace_tokens(raw, tokens) if tokens else raw
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(transformed, ensure_ascii=False, indent=2), encoding="utf-8")
    return out_path


async def main_async() -> int:
    args = _parse_args()

    try:
        raw_plan = ""
        if args.plan_json and args.plan_json.strip():
            raw_plan = args.plan_json
        elif args.plan_path and args.plan_path.strip():
            raw_plan = Path(args.plan_path).expanduser().resolve().read_text(encoding="utf-8")
        else:
            raise ValueError("Either --plan-json or --plan-path is required")

        plan = json.loads(raw_plan)
    except Exception as exc:
        _result(False, error={"code": "invalid_plan", "message": str(exc)})
        return 1

    segments = plan.get("segments") if isinstance(plan, dict) else None
    if not isinstance(segments, list):
        _result(False, error={"code": "invalid_plan", "message": "segments[] is required"})
        return 1

    _event(
        "flow.run.started",
        {
            "flowId": str(plan.get("flowId") or ""),
            "flowName": str(plan.get("flowName") or ""),
            "segments": len(segments),
            "alias": args.alias,
        },
    )

    completed: list[dict[str, Any]] = []
    started = time.time()

    for raw in segments:
        if not isinstance(raw, dict):
            continue

        idx = int(raw.get("index") or 0)
        total = int(raw.get("total") or len(segments))
        name = str(raw.get("name") or f"segment-{idx}")
        _event("flow.run.segment.start", {"index": idx, "total": total, "name": name, "data": raw})

        try:
            result = await _run_segment(raw, force_headless=bool(args.headless))
            completed.append(result)
            _event("flow.run.segment.done", result)
        except Exception as exc:
            _event(
                "flow.run.segment.fail",
                {
                    "index": idx,
                    "total": total,
                    "name": name,
                    "error": str(exc),
                },
            )
            _result(
                False,
                data={
                    "flowId": str(plan.get("flowId") or ""),
                    "completed": completed,
                    "durationMs": int((time.time() - started) * 1000),
                },
                error={"code": "segment_failed", "message": str(exc)},
            )
            return 1

    _event(
        "flow.run.finished",
        {
            "flowId": str(plan.get("flowId") or ""),
            "segments": len(segments),
            "completed": len(completed),
            "durationMs": int((time.time() - started) * 1000),
        },
    )
    _result(
        True,
        data={
            "flowId": str(plan.get("flowId") or ""),
            "completed": completed,
            "durationMs": int((time.time() - started) * 1000),
        },
    )
    return 0


def main() -> None:
    try:
        code = asyncio.run(main_async())
    except KeyboardInterrupt:
        _result(False, error={"code": "interrupted", "message": "Interrupted"})
        raise
    raise SystemExit(code)


if __name__ == "__main__":
    main()
