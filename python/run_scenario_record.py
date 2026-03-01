#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Scenario Recorder (MVP)

Records user interactions in a headed Camoufox persistent profile and exports
them as a simple Scenario JSON for later replay.

IMPORTANT (preprod use): this recorder injects a small script into the page to
observe click/input/change/submit/navigation events. This can be detectable.

Protocol to Rust JobManager:
- stdout: NDJSON protocol messages (type=log|event|result)
- stderr: diagnostic logs

Usage example:
  python python/run_scenario_record.py --alias "test@local.profile" --url "https://example.com/login" --scenario-name "login"
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


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


@dataclass(frozen=True)
class RecordedStep:
    kind: str
    ts: str
    url: str | None
    selector: str | None
    value: str | None
    meta: dict[str, Any]


RECORDER_INIT_SCRIPT = r"""
(() => {
  if (window.__stitchRecorderInstalled) return;
  window.__stitchRecorderInstalled = true;

  const safe = (fn) => {
    try { return fn(); } catch { return null; }
  };

  const cssPath = (el) => {
    if (!el || !el.tagName) return null;
    // Prefer stable attributes
    const testid = el.getAttribute && (el.getAttribute('data-testid') || el.getAttribute('data-test-id'));
    if (testid) return `[data-testid="${CSS.escape(testid)}"]`;
    const name = el.getAttribute && el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    const id = el.getAttribute && el.getAttribute('id');
    if (id) return `#${CSS.escape(id)}`;
    // Fallback: tag + classes (may be unstable)
    const cls = (el.className && typeof el.className === 'string') ? el.className.trim().split(/\s+/).slice(0,3) : [];
    if (cls && cls.length) return `${el.tagName.toLowerCase()}.${cls.map(c => CSS.escape(c)).join('.')}`;
    return el.tagName.toLowerCase();
  };

  const send = (payload) => {
    // Runner will expose __stitchRecordEvent
    if (typeof window.__stitchRecordEvent === 'function') {
      window.__stitchRecordEvent(payload);
    }
  };

  const describeEl = (el) => {
    if (!el) return {};
    const tag = safe(() => el.tagName?.toLowerCase()) || null;
    const type = safe(() => el.getAttribute?.('type')) || null;
    const aria = safe(() => el.getAttribute?.('aria-label')) || null;
    const placeholder = safe(() => el.getAttribute?.('placeholder')) || null;
    const role = safe(() => el.getAttribute?.('role')) || null;
    const text = safe(() => (el.innerText || '').trim().slice(0, 80)) || null;
    return { tag, type, role, ariaLabel: aria, placeholder, text };
  };

  const redactValue = (el, value) => {
    const t = safe(() => el.getAttribute?.('type')) || '';
    if (t.toLowerCase() === 'password') return '***';
    return value;
  };

  document.addEventListener('click', (e) => {
    const el = e.target;
    send({
      kind: 'click',
      ts: new Date().toISOString(),
      url: location.href,
      selector: cssPath(el),
      value: null,
      meta: { ...describeEl(el), button: e.button }
    });
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target;
    const value = safe(() => el && 'value' in el ? el.value : null);
    send({
      kind: 'change',
      ts: new Date().toISOString(),
      url: location.href,
      selector: cssPath(el),
      value: redactValue(el, value),
      meta: describeEl(el)
    });
  }, true);

  document.addEventListener('submit', (e) => {
    const el = e.target;
    send({
      kind: 'submit',
      ts: new Date().toISOString(),
      url: location.href,
      selector: cssPath(el),
      value: null,
      meta: describeEl(el)
    });
  }, true);

  const origPush = history.pushState;
  history.pushState = function(...args) {
    const res = origPush.apply(this, args);
    send({ kind: 'nav', ts: new Date().toISOString(), url: location.href, selector: null, value: null, meta: { type: 'pushState' } });
    return res;
  };
  const origReplace = history.replaceState;
  history.replaceState = function(...args) {
    const res = origReplace.apply(this, args);
    send({ kind: 'nav', ts: new Date().toISOString(), url: location.href, selector: null, value: null, meta: { type: 'replaceState' } });
    return res;
  };
  window.addEventListener('popstate', () => {
    send({ kind: 'nav', ts: new Date().toISOString(), url: location.href, selector: null, value: null, meta: { type: 'popstate' } });
  });
})();
"""


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Record a scenario in Camoufox persistent profile")
    p.add_argument("--alias", required=True, help="Profile alias (maps to persistent profile id)")
    p.add_argument("--url", required=True, help="Start URL")
    p.add_argument("--scenario-name", default="scenario", help="Scenario name")
    p.add_argument("--timeout-s", type=int, default=3600, help="Max record duration")
    p.add_argument("--proxy", default="", help="Optional proxy URL")
    p.add_argument("--headless", action="store_true", help="Run browser in headless mode")
    p.add_argument(
        "--config-json",
        default="",
        help="Optional JSON object for ProfileLauncher config (locale/timezone/geo/launch_kwargs/etc)",
    )
    p.add_argument(
        "--out", default="", help="Output directory (defaults to ~/.stitch-manager/scenarios)"
    )
    return p.parse_args()


async def main_async() -> int:
    args = _parse_args()

    try:
        from playwright.async_api import Page
        from autoreg.core.paths import get_paths
        from autoreg.browser.profile_launcher import ProfileLauncher
    except Exception as e:
        _result(False, error={"code": "import_error", "message": str(e)})
        return 1

    run_id = f"rec_{int(time.time())}"
    out_dir = (
        Path(args.out).expanduser().resolve()
        if args.out
        else (get_paths().user_data_dir / "scenarios")
    )
    out_dir.mkdir(parents=True, exist_ok=True)
    session_dir = out_dir / f"{args.scenario_name}_{run_id}"
    session_dir.mkdir(parents=True, exist_ok=True)

    scenario_path = session_dir / "scenario.json"
    _event(
        "scenario.record.location",
        {
            "runId": run_id,
            "sessionDir": str(session_dir),
            "scenarioPath": str(scenario_path),
        },
    )

    steps: list[RecordedStep] = []

    config: dict[str, Any] = {"timezone_id": "Auto", "geolocation": "Auto"}
    if args.config_json and args.config_json.strip():
        try:
            loaded = json.loads(args.config_json)
            if isinstance(loaded, dict):
                config.update(loaded)
        except Exception:
            _log("warn", "Invalid --config-json, ignoring", step="init")

    def on_record(payload: dict[str, Any]) -> None:
        # payload is the browser-side event
        try:
            step = RecordedStep(
                kind=str(payload.get("kind") or "unknown"),
                ts=str(payload.get("ts") or _now_iso()),
                url=str(payload.get("url")) if payload.get("url") else None,
                selector=str(payload.get("selector")) if payload.get("selector") else None,
                value=str(payload.get("value")) if payload.get("value") is not None else None,
                meta=dict(payload.get("meta") or {}),
            )
            steps.append(step)
            _event(
                "scenario.record.step",
                {"kind": step.kind, "selector": step.selector, "url": step.url},
            )
        except Exception:
            # don't break recording
            return

    last_len = 0
    last_save_ts = 0.0

    async def install_recorder(page: Page) -> None:
        await page.expose_function("__stitchRecordEvent", on_record)
        await page.add_init_script(RECORDER_INIT_SCRIPT)

    def export_snapshot() -> None:
        # Best-effort autosave snapshot (safe on kill/cancel)
        try:
            nonlocal last_len, last_save_ts
            # avoid excessive disk writes
            if len(steps) == last_len and (time.time() - last_save_ts) < 2.0:
                return
            scenario = {
                "version": 1,
                "name": args.scenario_name,
                "runId": run_id,
                "alias": args.alias,
                "startedUrl": args.url,
                "recordedAt": _now_iso(),
                "steps": [
                    {
                        "kind": s.kind,
                        "ts": s.ts,
                        "url": s.url,
                        "selector": s.selector,
                        "value": s.value,
                        "meta": s.meta,
                    }
                    for s in steps
                ],
            }
            scenario_path.write_text(
                json.dumps(scenario, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            last_len = len(steps)
            last_save_ts = time.time()
        except Exception:
            return

    _log("info", f"Starting recorder: {args.scenario_name}", step="init")
    _event("scenario.record.started", {"runId": run_id, "alias": args.alias})

    try:
        async with ProfileLauncher(
            profile_id=args.alias,
            headless=bool(args.headless),
            proxy=args.proxy or None,
            config=config,
        ) as launcher:
            page = await launcher.open(args.url, wait_until="domcontentloaded")
            await install_recorder(page)

            export_snapshot()

            _log(
                "info",
                "Recording... cancel the job to stop (autosaves) or wait for timeout",
                step="record",
            )

            deadline = time.time() + float(args.timeout_s)
            while time.time() < deadline:
                await asyncio.sleep(0.5)
                export_snapshot()
                if page.is_closed():
                    _log("info", "Page closed - stopping record", step="record")
                    break

    except Exception as e:
        _result(False, error={"code": "record_failed", "message": str(e)})
        return 1

    export_snapshot()

    _event("scenario.record.saved", {"path": str(scenario_path), "steps": len(steps)})
    _result(True, data={"scenarioPath": str(scenario_path), "steps": len(steps), "runId": run_id})
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
