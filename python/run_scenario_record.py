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
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Ensure project imports work regardless of cwd.
# NOTE: Our python package root is the "python/" directory.
PYTHON_ROOT = Path(__file__).resolve().parent
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))


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
  if (typeof window.__stitchRecorderStepCount !== 'number') {
    window.__stitchRecorderStepCount = 0;
  }
  if (typeof window.__stitchRecorderPaused !== 'boolean') {
    window.__stitchRecorderPaused = false;
  }

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
    if (window.__stitchRecorderPaused) return;
    // Runner will expose __stitchRecordEvent
    if (typeof window.__stitchRecordEvent === 'function') {
      window.__stitchRecordEvent(payload);
      window.__stitchRecorderStepCount = (window.__stitchRecorderStepCount || 0) + 1;
      if (typeof window.__stitchRecorderOverlaySetCount === 'function') {
        window.__stitchRecorderOverlaySetCount(window.__stitchRecorderStepCount);
      }
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


RECORDER_OVERLAY_SCRIPT = r"""
(() => {
  if (window.__stitchRecorderOverlayInstalled) return;
  window.__stitchRecorderOverlayInstalled = true;

  const box = document.createElement('div');
  box.style.position = 'fixed';
  box.style.right = '16px';
  box.style.bottom = '16px';
  box.style.zIndex = '2147483647';
  box.style.background = 'rgba(11,13,18,0.92)';
  box.style.color = '#e2e8f0';
  box.style.border = '1px solid rgba(148,163,184,0.25)';
  box.style.borderRadius = '10px';
  box.style.padding = '10px';
  box.style.fontFamily = 'Inter, Segoe UI, Arial, sans-serif';
  box.style.fontSize = '12px';
  box.style.minWidth = '220px';
  box.style.boxShadow = '0 10px 30px rgba(0,0,0,0.4)';

  const title = document.createElement('div');
  title.textContent = 'Stitch Recorder';
  title.style.fontWeight = '700';
  title.style.marginBottom = '6px';

  const status = document.createElement('div');
  status.textContent = 'Status: Recording';
  status.style.opacity = '0.9';
  status.style.marginBottom = '8px';

  const count = document.createElement('div');
  count.textContent = 'Steps: 0';
  count.style.opacity = '0.85';
  count.style.marginBottom = '8px';

  const reason = document.createElement('div');
  reason.textContent = 'Reason: -';
  reason.style.opacity = '0.8';
  reason.style.marginBottom = '6px';

  const pausedFor = document.createElement('div');
  pausedFor.textContent = 'Paused: -';
  pausedFor.style.opacity = '0.8';
  pausedFor.style.marginBottom = '8px';
  pausedFor.style.display = 'none';

  let pausedSince = null;

  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '6px';

  const mkBtn = (label, bg) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.padding = '6px 10px';
    b.style.borderRadius = '7px';
    b.style.border = '1px solid rgba(148,163,184,0.25)';
    b.style.background = bg;
    b.style.color = '#fff';
    b.style.cursor = 'pointer';
    b.style.fontSize = '12px';
    return b;
  };

  const pauseBtn = mkBtn('Pause', '#334155');
  const stopBtn = mkBtn('Finish & Save', '#7f1d1d');
  let paused = false;

  const sendControl = (cmd) => {
    if (typeof window.__stitchRecordControl === 'function') {
      window.__stitchRecordControl(cmd);
    }
  };

  pauseBtn.onclick = () => {
    paused = !paused;
    window.__stitchRecorderPaused = paused;
    if (paused) {
      pauseBtn.textContent = 'Resume';
      status.textContent = 'Status: Paused';
      reason.textContent = 'Reason: Operator pause';
      if (!pausedSince) pausedSince = Date.now();
      pausedFor.style.display = 'block';
      sendControl('pause');
    } else {
      pauseBtn.textContent = 'Pause';
      status.textContent = 'Status: Recording';
      reason.textContent = 'Reason: -';
      pausedSince = null;
      pausedFor.style.display = 'none';
      pausedFor.textContent = 'Paused: -';
      sendControl('resume');
    }
  };

  stopBtn.onclick = () => {
    status.textContent = 'Status: Stopping...';
    window.__stitchRecorderPaused = true;
    pausedSince = null;
    sendControl('stop');
  };

  row.appendChild(pauseBtn);
  row.appendChild(stopBtn);
  box.appendChild(title);
  box.appendChild(status);
  box.appendChild(count);
  box.appendChild(reason);
  box.appendChild(pausedFor);
  box.appendChild(row);
  document.documentElement.appendChild(box);

  window.__stitchRecorderOverlaySetStatus = (text) => {
    status.textContent = `Status: ${text}`;
  };

  window.__stitchRecorderOverlaySetReason = (text) => {
    const v = (text || '').toString().trim();
    reason.textContent = `Reason: ${v || '-'}`;
  };

  window.__stitchRecorderOverlaySetPaused = (flag) => {
    if (flag) {
      if (!pausedSince) pausedSince = Date.now();
      pausedFor.style.display = 'block';
    } else {
      pausedSince = null;
      pausedFor.style.display = 'none';
      pausedFor.textContent = 'Paused: -';
    }
  };

  window.__stitchRecorderOverlaySetSaved = (path) => {
    status.textContent = 'Status: Saved';
    reason.textContent = `Reason: ${path ? `Saved to ${path}` : 'Saved'}`;
    pausedSince = null;
    pausedFor.style.display = 'none';
    pausedFor.textContent = 'Paused: -';
  };

  window.__stitchRecorderOverlaySetCount = (value) => {
    const n = Number(value || 0);
    count.textContent = `Steps: ${Number.isFinite(n) ? n : 0}`;
  };

  // Restore current count on reinjection/navigation.
  window.__stitchRecorderOverlaySetCount(window.__stitchRecorderStepCount || 0);

  setInterval(() => {
    if (!pausedSince) return;
    const sec = Math.max(0, Math.floor((Date.now() - pausedSince) / 1000));
    pausedFor.textContent = `Paused: ${sec}s`;
  }, 1000);
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
    paths = get_paths()

    # Pin Playwright browsers cache to Stitch-managed directory so first-run downloads
    # go to a predictable location (used by install_browser_runtime.py).
    try:
        pw_cache = paths.cache_dir / "playwright-browsers"
        pw_cache.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(pw_cache))
    except Exception:
        pass

    out_dir = (
        Path(args.out).expanduser().resolve() if args.out else (paths.user_data_dir / "scenarios")
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
    stop_event = asyncio.Event()
    paused = False

    config: dict[str, Any] = {"timezone_id": "Auto", "geolocation": "Auto"}
    if args.config_json and args.config_json.strip():
        try:
            loaded = json.loads(args.config_json)
            if isinstance(loaded, dict):
                config.update(loaded)
        except Exception:
            _log("warn", "Invalid --config-json, ignoring", step="init")

    def on_record(payload: dict[str, Any]) -> None:
        nonlocal paused
        if paused:
            return
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

    def on_control(command: str) -> None:
        nonlocal paused
        cmd = str(command or "").strip().lower()
        if cmd == "pause":
            paused = True
            _event("scenario.record.control.pause", {"runId": run_id})
            return
        if cmd == "resume":
            paused = False
            _event("scenario.record.control.resume", {"runId": run_id})
            return
        if cmd in ("stop", "abort", "cancel"):
            _event("scenario.record.control.stop", {"runId": run_id})
            stop_event.set()
            return

    async def update_overlay(
        page: Any,
        *,
        status: str | None = None,
        reason: str | None = None,
        paused_flag: bool | None = None,
        saved_path: str | None = None,
    ) -> None:
        try:
            if status is not None:
                await page.evaluate(
                    "(arg) => window.__stitchRecorderOverlaySetStatus && window.__stitchRecorderOverlaySetStatus(arg.status)",
                    {"status": status},
                )
            if reason is not None:
                await page.evaluate(
                    "(arg) => window.__stitchRecorderOverlaySetReason && window.__stitchRecorderOverlaySetReason(arg.reason)",
                    {"reason": reason},
                )
            if paused_flag is not None:
                await page.evaluate(
                    "(arg) => window.__stitchRecorderOverlaySetPaused && window.__stitchRecorderOverlaySetPaused(Boolean(arg.paused))",
                    {"paused": paused_flag},
                )
            if saved_path is not None:
                await page.evaluate(
                    "(arg) => window.__stitchRecorderOverlaySetSaved && window.__stitchRecorderOverlaySetSaved(arg.path)",
                    {"path": saved_path},
                )
        except Exception:
            pass

    last_len = 0
    last_save_ts = 0.0

    async def install_recorder(page: Page) -> None:
        await page.expose_function("__stitchRecordEvent", on_record)
        await page.expose_function("__stitchRecordControl", on_control)
        await page.add_init_script(RECORDER_INIT_SCRIPT)
        await page.add_init_script(RECORDER_OVERLAY_SCRIPT)
        # add_init_script only applies to future navigations; also install recorder
        # into the currently loaded document so recording works immediately.
        await page.evaluate(RECORDER_INIT_SCRIPT)
        await page.evaluate(RECORDER_OVERLAY_SCRIPT)

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
            await update_overlay(page, status="Recording", reason="", paused_flag=False)

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
                if paused:
                    await update_overlay(
                        page, status="Paused", reason="Operator pause", paused_flag=True
                    )
                else:
                    await update_overlay(page, status="Recording", reason="", paused_flag=False)
                if stop_event.is_set():
                    _log("info", "Stop requested from browser overlay", step="record")
                    break
                if page.is_closed():
                    _log("info", "Page closed - stopping record", step="record")
                    break

            if not page.is_closed():
                await update_overlay(page, status="Saving", reason="", paused_flag=False)

    except Exception as e:
        _result(False, error={"code": "record_failed", "message": str(e)})
        return 1

    export_snapshot()

    try:
        # best-effort: show final state before context exits
        if "page" in locals() and page is not None and not page.is_closed():
            await update_overlay(page, saved_path=str(scenario_path))
    except Exception:
        pass

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
