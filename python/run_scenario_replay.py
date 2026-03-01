#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Scenario Replay Runner (MVP)

Replays a previously recorded scenario JSON against a Camoufox persistent profile.

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
import json
import sys
import time
from pathlib import Path
from typing import Any

# Ensure project imports work regardless of cwd.
CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _now_iso() -> str:
    return (
        time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int((time.time() % 1) * 1000):03d}Z"
    )


def _emit(obj: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _log(level: str, message: str, *, step: str | None = None, data: Any | None = None) -> None:
    _emit(
        {
            "type": "log",
            "level": level,
            "message": message,
            "step": step,
            "data": data,
        }
    )


def _event(name: str, payload: dict[str, Any] | None = None) -> None:
    _emit(
        {
            "type": "event",
            "level": "info",
            "message": name,
            "data": payload or {},
        }
    )


def _result(
    ok: bool, data: dict[str, Any] | None = None, error: dict[str, Any] | None = None
) -> None:
    _emit(
        {
            "type": "result",
            "ok": ok,
            "message": "ok" if ok else "error",
            "data": data or {},
            "error": error,
        }
    )


class ReplayAbort(Exception):
    pass


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Replay a scenario in Camoufox persistent profile")
    p.add_argument("--alias", required=True, help="Profile alias")
    p.add_argument("--scenario-path", required=True, help="Path to scenario.json")
    p.add_argument("--start-url", default="", help="Optional start URL override")
    p.add_argument("--timeout-s", type=int, default=3600, help="Max replay duration")
    p.add_argument("--pause-timeout-s", type=int, default=1800, help="Timeout for manual pause")
    p.add_argument("--proxy", default="", help="Optional proxy URL")
    p.add_argument(
        "--config-json",
        default="",
        help="Optional JSON object for ProfileLauncher config (locale/timezone/geo/launch_kwargs/etc)",
    )
    p.add_argument("--continue-on-error", action="store_true", help="Continue after step errors")
    p.add_argument("--headless", action="store_true", help="Run browser in headless mode")
    p.add_argument(
        "--out", default="", help="Output directory (defaults to ~/.stitch-manager/scenarios)"
    )
    return p.parse_args()


def _load_scenario(path: Path) -> dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("Scenario file must be a JSON object")
    steps = raw.get("steps")
    if not isinstance(steps, list):
        raise ValueError("Scenario file must contain steps: []")
    return raw


def _looks_like_v2(raw: dict[str, Any]) -> bool:
    try:
        return int(raw.get("version") or 0) >= 2 and isinstance(raw.get("steps"), list)
    except Exception:
        return False


def _normalize_to_v2(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize scenario input to a minimal v2-like dict.

    Runner expects either:
    - v2 steps with selectorCandidates
    - or legacy v1 steps with selector
    """
    if _looks_like_v2(raw):
        return raw

    try:
        from autoreg.scenario.normalize_v1_to_v2 import normalize_recorded_scenario_v1_to_v2

        v2 = normalize_recorded_scenario_v1_to_v2(raw)
        return {
            "version": v2.version,
            "name": v2.name,
            "createdAt": v2.created_at,
            "startedUrl": raw.get("startedUrl") or raw.get("started_url") or "about:blank",
            "steps": [
                {
                    "id": s.id,
                    "tabId": s.tab_id,
                    "kind": s.kind,
                    "selectorCandidates": [
                        {"kind": c.kind, "value": c.value, "weight": c.weight}
                        for c in s.selector_candidates
                    ],
                    "value": s.value,
                    "url": s.url,
                    "timeoutMs": s.timeout_ms,
                    "retry": s.retry,
                    "sensitive": s.sensitive,
                    "meta": s.meta or {},
                }
                for s in v2.steps
            ],
        }
    except Exception:
        # Best-effort fallback to raw v1
        return raw


def _looks_like_captcha(step: dict[str, Any]) -> bool:
    bits: list[str] = []
    for key in ("selector", "url", "kind"):
        v = step.get(key)
        if isinstance(v, str):
            bits.append(v)

    # v2 selector candidates
    candidates = step.get("selectorCandidates")
    if isinstance(candidates, list):
        for item in candidates:
            if not isinstance(item, dict):
                continue
            value = item.get("value")
            if isinstance(value, str):
                bits.append(value)

    meta = step.get("meta")
    if isinstance(meta, dict):
        for key in ("text", "ariaLabel", "placeholder", "role", "tag", "type"):
            v = meta.get(key)
            if isinstance(v, str):
                bits.append(v)
    hay = " ".join(bits).lower()
    return any(
        token in hay
        for token in (
            "captcha",
            "hcaptcha",
            "recaptcha",
            "turnstile",
            "cf-chl",
            "cloudflare",
        )
    )


def _step_kind(step: dict[str, Any]) -> str:
    kind = step.get("kind")
    return str(kind).strip().lower() if isinstance(kind, str) else "unknown"


def _best_selector(step: dict[str, Any]) -> str | None:
    """Choose best selector from v2 selectorCandidates or legacy selector field."""
    cand = step.get("selectorCandidates")
    if isinstance(cand, list) and cand:
        best_css: str | None = None
        best_w = -1.0
        for item in cand:
            if not isinstance(item, dict):
                continue
            if str(item.get("kind") or "") != "css":
                continue
            value = item.get("value")
            if not isinstance(value, str) or not value.strip():
                continue
            w = item.get("weight")
            try:
                wf = float(w) if w is not None else 1.0
            except Exception:
                wf = 1.0
            if wf > best_w:
                best_w = wf
                best_css = value.strip()
        if best_css:
            return best_css

    legacy = step.get("selector")
    if isinstance(legacy, str) and legacy.strip():
        return legacy.strip()
    return None


class CommandTail:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.offset = 0

    def ensure(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text("", encoding="utf-8")

    def read_new_commands(self) -> list[tuple[str, dict[str, Any] | None]]:
        if not self.path.exists():
            return []
        raw = self.path.read_text(encoding="utf-8", errors="replace")
        if self.offset >= len(raw):
            return []
        chunk = raw[self.offset :]
        self.offset = len(raw)
        out: list[tuple[str, dict[str, Any] | None]] = []
        for line in chunk.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                if isinstance(obj, dict):
                    cmd = obj.get("command")
                    payload = obj.get("payload")
                    if isinstance(cmd, str) and cmd.strip():
                        out.append(
                            (cmd.strip().lower(), payload if isinstance(payload, dict) else None)
                        )
                        continue
            except Exception:
                pass
            out.append((line.lower(), None))
        return out


async def _manual_pause(
    *,
    reason: str,
    step_index: int,
    total_steps: int,
    command_tail: CommandTail,
    command_file_path: str,
    timeout_s: int,
) -> None:
    _event(
        "scenario.replay.manual.pause",
        {
            "reason": reason,
            "stepIndex": step_index,
            "totalSteps": total_steps,
            "commandFilePath": command_file_path,
        },
    )
    deadline = time.time() + max(1, timeout_s)
    last_ping = 0.0

    while time.time() < deadline:
        commands = command_tail.read_new_commands()
        for cmd, payload in commands:
            if cmd in ("resume", "continue"):
                _event(
                    "scenario.replay.manual.resume",
                    {
                        "reason": reason,
                        "stepIndex": step_index,
                        "totalSteps": total_steps,
                        "payload": payload or {},
                    },
                )
                return
            if cmd in ("abort", "cancel", "stop"):
                _event(
                    "scenario.replay.manual.abort",
                    {
                        "reason": reason,
                        "stepIndex": step_index,
                        "totalSteps": total_steps,
                        "payload": payload or {},
                    },
                )
                raise ReplayAbort("Manual abort requested")

        if time.time() - last_ping >= 5.0:
            _event(
                "scenario.replay.manual.waiting",
                {
                    "reason": reason,
                    "stepIndex": step_index,
                    "totalSteps": total_steps,
                    "secondsLeft": int(max(0, deadline - time.time())),
                },
            )
            last_ping = time.time()

        await asyncio.sleep(0.35)

    raise TimeoutError("Manual pause timeout")


async def _save_step_artifacts(page: Any, artifacts_dir: Path, step_index: int) -> dict[str, str]:
    artifacts: dict[str, str] = {}
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    png = artifacts_dir / f"step_{step_index:04d}_error.png"
    html = artifacts_dir / f"step_{step_index:04d}_error.html"

    try:
        await page.screenshot(path=str(png), full_page=True)
        artifacts["screenshot"] = str(png)
    except Exception:
        pass

    try:
        content = await page.content()
        html.write_text(content, encoding="utf-8")
        artifacts["html"] = str(html)
    except Exception:
        pass

    return artifacts


async def _run_step(page: Any, step: dict[str, Any], timeout_ms: int = 15_000) -> None:
    kind = _step_kind(step)
    selector = _best_selector(step)
    value = step.get("value") if isinstance(step.get("value"), str) else None
    url = step.get("url") if isinstance(step.get("url"), str) else None

    if kind in ("nav", "goto", "navigate"):
        if not url:
            raise ValueError("nav step has no url")
        await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        return

    if kind in ("click",):
        if not selector:
            raise ValueError("click step has no selector")
        await page.locator(selector).first.click(timeout=timeout_ms)
        return

    if kind in ("change", "fill", "input"):
        if not selector:
            raise ValueError("change step has no selector")
        # Password-like values are redacted during record; skip writing them.
        if value == "***":
            return
        await page.locator(selector).first.fill(value or "", timeout=timeout_ms)
        return

    if kind in ("submit",):
        if selector:
            await page.locator(selector).first.press("Enter", timeout=timeout_ms)
        else:
            await page.keyboard.press("Enter")
        return

    if kind in ("manual.pause", "manual", "manual.captcha", "captcha"):
        # handled by outer loop
        return

    # unknown step kinds are no-op (do not fail whole run)
    return


async def main_async() -> int:
    args = _parse_args()

    try:
        from autoreg.core.paths import get_paths
        from autoreg.browser.profile_launcher import ProfileLauncher
    except Exception as e:
        _result(False, error={"code": "import_error", "message": str(e)})
        return 1

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
    out_dir = (
        Path(args.out).expanduser().resolve()
        if args.out
        else (get_paths().user_data_dir / "scenarios")
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    session_dir = out_dir / run_id
    artifacts_dir = session_dir / "artifacts"
    session_dir.mkdir(parents=True, exist_ok=True)
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    command_file = session_dir / "control.ndjson"
    cmd_tail = CommandTail(command_file)
    cmd_tail.ensure()

    report_path = session_dir / "replay_report.json"
    trace_path = session_dir / "trace.zip"

    config: dict[str, Any] = {"timezone_id": "Auto", "geolocation": "Auto"}
    if args.config_json and args.config_json.strip():
        try:
            loaded = json.loads(args.config_json)
            if isinstance(loaded, dict):
                config.update(loaded)
        except Exception:
            _log("warn", "Invalid --config-json, ignoring", step="init")

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
    total_steps = len(steps)

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
            "startUrl": start_url,
        },
    )

    passed = 0
    failed = 0
    started_at = _now_iso()
    failed_steps: list[dict[str, Any]] = []
    trace_saved = False

    try:
        async with ProfileLauncher(
            profile_id=args.alias,
            headless=bool(args.headless),
            proxy=args.proxy or None,
            config=config,
        ) as launcher:
            page = await launcher.open(start_url, wait_until="domcontentloaded")

            tracing_started = False
            try:
                await page.context.tracing.start(screenshots=True, snapshots=True)
                tracing_started = True
            except Exception:
                _log("warn", "Failed to start Playwright tracing", step="trace")

            try:
                deadline = time.time() + float(max(1, args.timeout_s))
                for idx, step in enumerate(steps, start=1):
                    if time.time() > deadline:
                        raise TimeoutError("Replay timeout reached")

                    kind = _step_kind(step)
                    selector = _best_selector(step)
                    url = step.get("url") if isinstance(step.get("url"), str) else None

                    _event(
                        "scenario.replay.step.start",
                        {
                            "runId": run_id,
                            "index": idx,
                            "total": total_steps,
                            "kind": kind,
                            "selector": selector,
                            "url": url,
                        },
                    )

                    try:
                        # explicit manual steps OR heuristic captcha detection
                        if kind in (
                            "manual.pause",
                            "manual",
                            "manual.captcha",
                            "captcha",
                        ) or _looks_like_captcha(step):
                            reason = "captcha" if _looks_like_captcha(step) else kind
                            await _manual_pause(
                                reason=reason,
                                step_index=idx,
                                total_steps=total_steps,
                                command_tail=cmd_tail,
                                command_file_path=str(command_file),
                                timeout_s=max(1, args.pause_timeout_s),
                            )

                        await _run_step(page, step)
                        passed += 1
                        _event(
                            "scenario.replay.step.done",
                            {
                                "runId": run_id,
                                "index": idx,
                                "total": total_steps,
                                "kind": kind,
                            },
                        )
                    except ReplayAbort:
                        raise
                    except Exception as e:
                        failed += 1
                        artifacts = await _save_step_artifacts(page, artifacts_dir, idx)
                        failed_entry = {
                            "index": idx,
                            "kind": kind,
                            "selector": selector,
                            "url": url,
                            "error": str(e),
                            "artifacts": artifacts,
                        }
                        failed_steps.append(failed_entry)
                        _event(
                            "scenario.replay.step.fail",
                            {
                                "runId": run_id,
                                **failed_entry,
                            },
                        )
                        if not args.continue_on_error:
                            raise
            finally:
                if tracing_started:
                    try:
                        await page.context.tracing.stop(path=str(trace_path))
                        trace_saved = trace_path.exists()
                    except Exception:
                        _log("warn", "Failed to save trace", step="trace")

    except ReplayAbort as e:
        report = {
            "version": 1,
            "runId": run_id,
            "status": "aborted",
            "startedAt": started_at,
            "finishedAt": _now_iso(),
            "scenarioPath": str(scenario_path),
            "stepsTotal": total_steps,
            "stepsPassed": passed,
            "stepsFailed": failed,
            "failedSteps": failed_steps,
            "artifactsDir": str(artifacts_dir),
            "tracePath": str(trace_path) if trace_saved and trace_path.exists() else None,
            "commandFilePath": str(command_file),
            "error": str(e),
        }
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        _event("scenario.replay.saved", {"reportPath": str(report_path), "status": "aborted"})
        _result(
            False,
            data={"reportPath": str(report_path), "runId": run_id},
            error={"code": "aborted", "message": str(e)},
        )
        return 2
    except Exception as e:
        report = {
            "version": 1,
            "runId": run_id,
            "status": "failed",
            "startedAt": started_at,
            "finishedAt": _now_iso(),
            "scenarioPath": str(scenario_path),
            "stepsTotal": total_steps,
            "stepsPassed": passed,
            "stepsFailed": failed,
            "failedSteps": failed_steps,
            "artifactsDir": str(artifacts_dir),
            "tracePath": str(trace_path) if trace_saved and trace_path.exists() else None,
            "commandFilePath": str(command_file),
            "error": str(e),
        }
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        _event("scenario.replay.saved", {"reportPath": str(report_path), "status": "failed"})
        _result(
            False,
            data={"reportPath": str(report_path), "runId": run_id},
            error={"code": "replay_failed", "message": str(e)},
        )
        return 1

    report = {
        "version": 1,
        "runId": run_id,
        "status": "succeeded",
        "startedAt": started_at,
        "finishedAt": _now_iso(),
        "scenarioPath": str(scenario_path),
        "stepsTotal": total_steps,
        "stepsPassed": passed,
        "stepsFailed": failed,
        "failedSteps": failed_steps,
        "artifactsDir": str(artifacts_dir),
        "tracePath": str(trace_path) if trace_saved and trace_path.exists() else None,
        "commandFilePath": str(command_file),
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    _event(
        "scenario.replay.finished",
        {
            "runId": run_id,
            "stepsTotal": total_steps,
            "stepsPassed": passed,
            "stepsFailed": failed,
            "reportPath": str(report_path),
            "tracePath": str(trace_path) if trace_saved and trace_path.exists() else None,
        },
    )
    _event("scenario.replay.saved", {"reportPath": str(report_path), "status": "succeeded"})
    _result(
        True,
        data={
            "runId": run_id,
            "stepsTotal": total_steps,
            "stepsPassed": passed,
            "stepsFailed": failed,
            "reportPath": str(report_path),
            "tracePath": str(trace_path) if trace_saved and trace_path.exists() else None,
            "artifactsDir": str(artifacts_dir),
            "commandFilePath": str(command_file),
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
