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
  // Only record events in top-level document.
  // Prevent duplicate listeners inside iframes (e.g., reCAPTCHA).
  try {
    if (window.top !== window.self) return;
  } catch {
    return;
  }

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

  const cssEscape = (value) => {
    const s = (value ?? '').toString();
    try {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    } catch {}
    // minimal fallback
    return s.replace(/[^a-zA-Z0-9_\-]/g, (c) => `\\${c}`);
  };

  const cssPath = (el) => {
    if (!el || !el.tagName) return null;
    // Prefer stable attributes
    const testid = el.getAttribute && (el.getAttribute('data-testid') || el.getAttribute('data-test-id'));
    if (testid) return `[data-testid="${cssEscape(testid)}"]`;
    const name = el.getAttribute && el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
    const id = el.getAttribute && el.getAttribute('id');
    if (id) return `#${cssEscape(id)}`;
    // Fallback: tag + classes (may be unstable)
    const cls = (el.className && typeof el.className === 'string') ? el.className.trim().split(/\s+/).slice(0,3) : [];
    if (cls && cls.length) return `${el.tagName.toLowerCase()}.${cls.map(c => cssEscape(c)).join('.')}`;
    return el.tagName.toLowerCase();
  };

  const send = (payload) => {
    if (window.__stitchRecorderPaused) return;
    try {
      // Primary channel: console-based protocol. More reliable than window bindings on some pages.
      console.info('__STITCH_REC_STEP__' + JSON.stringify(payload));
      window.__stitchRecorderStepCount = (window.__stitchRecorderStepCount || 0) + 1;
      if (typeof window.__stitchRecorderOverlaySetCount === 'function') {
        window.__stitchRecorderOverlaySetCount(window.__stitchRecorderStepCount);
      }
    } catch (e) {
      // ignore
    }
  };

  const isOverlayEvent = (el) => {
    try {
      return !!(el && el.closest && el.closest('[data-stitch-recorder="1"]'));
    } catch {
      return false;
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
    if (isOverlayEvent(el)) return;
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
    if (isOverlayEvent(el)) return;
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
    if (isOverlayEvent(el)) return;
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

  // Record initial page load URL. Helps when operator navigates via address bar.
  send({ kind: 'nav', ts: new Date().toISOString(), url: location.href, selector: null, value: null, meta: { type: 'load' } });
})();
"""


RECORDER_OVERLAY_SCRIPT = r"""
(() => {
  // Only render overlay in top-level document (avoid iframes like reCAPTCHA).
  try {
    if (window.top !== window.self) return;
  } catch {
    return;
  }

  if (!window.__stitchRecorderOverlayState) {
    window.__stitchRecorderOverlayState = {
      status: 'Recording',
      reason: '-',
      paused: false,
      pausedSince: null,
      count: Number(window.__stitchRecorderStepCount || 0),
      savedPath: '',
    };
  }

  const state = window.__stitchRecorderOverlayState;

  const sendControl = (cmd) => {
    // Primary channel: Playwright binding (if available)
    try {
      if (typeof window.__stitchRecordControl === 'function') {
        window.__stitchRecordControl(cmd);
        return;
      }
    } catch {}
    // Fallback channel: console protocol (works even if bindings are blocked)
    try {
      console.info('__STITCH_REC_CTRL__' + String(cmd || ''));
    } catch {}
  };

  const makeOverlay = () => {
    const existing = document.getElementById('__stitch-recorder-overlay');
    if (existing) return existing;

    const box = document.createElement('div');
    box.id = '__stitch-recorder-overlay';
    box.setAttribute('data-stitch-recorder', '1');
    box.style.all = 'initial';
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
    box.style.display = 'block';

    const title = document.createElement('div');
    title.textContent = 'Stitch Recorder';
    title.style.fontWeight = '700';
    title.style.marginBottom = '6px';

    const status = document.createElement('div');
    status.id = '__stitch-recorder-status';
    status.style.opacity = '0.9';
    status.style.marginBottom = '8px';

    const count = document.createElement('div');
    count.id = '__stitch-recorder-count';
    count.style.opacity = '0.85';
    count.style.marginBottom = '8px';

    const reason = document.createElement('div');
    reason.id = '__stitch-recorder-reason';
    reason.style.opacity = '0.8';
    reason.style.marginBottom = '6px';

    const pausedFor = document.createElement('div');
    pausedFor.id = '__stitch-recorder-paused';
    pausedFor.style.opacity = '0.8';
    pausedFor.style.marginBottom = '8px';
    pausedFor.style.display = 'none';

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
    pauseBtn.id = '__stitch-recorder-pause';
    const stopBtn = mkBtn('Finish & Save', '#7f1d1d');

    pauseBtn.onclick = () => {
      state.paused = !state.paused;
      window.__stitchRecorderPaused = state.paused;
      if (state.paused) {
        state.status = 'Paused';
        state.reason = 'Operator pause';
        if (!state.pausedSince) state.pausedSince = Date.now();
        sendControl('pause');
      } else {
        state.status = 'Recording';
        state.reason = '-';
        state.pausedSince = null;
        sendControl('resume');
      }
      renderOverlay();
    };

    stopBtn.onclick = () => {
      state.status = 'Stopping...';
      window.__stitchRecorderPaused = true;
      state.pausedSince = null;
      renderOverlay();
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

    (document.body || document.documentElement).appendChild(box);
    return box;
  };

  const renderOverlay = () => {
    const box = makeOverlay();
    const status = box.querySelector('#__stitch-recorder-status');
    const count = box.querySelector('#__stitch-recorder-count');
    const reason = box.querySelector('#__stitch-recorder-reason');
    const pausedFor = box.querySelector('#__stitch-recorder-paused');
    const pauseBtn = box.querySelector('#__stitch-recorder-pause');

    if (status) status.textContent = `Status: ${state.status || 'Recording'}`;
    if (count) count.textContent = `Steps: ${Number.isFinite(Number(state.count)) ? Number(state.count) : 0}`;
    if (reason) reason.textContent = `Reason: ${(state.reason || '-').toString()}`;

    if (pauseBtn) {
      pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
    }

    if (pausedFor) {
      if (state.paused && state.pausedSince) {
        pausedFor.style.display = 'block';
        const sec = Math.max(0, Math.floor((Date.now() - state.pausedSince) / 1000));
        pausedFor.textContent = `Paused: ${sec}s`;
      } else {
        pausedFor.style.display = 'none';
        pausedFor.textContent = 'Paused: -';
      }
    }
  };

  const ensureOverlayAttached = () => {
    const box = makeOverlay();
    if (!box.isConnected) {
      (document.body || document.documentElement).appendChild(box);
    }
    renderOverlay();
  };

  window.__stitchRecorderOverlaySetStatus = (text) => {
    state.status = (text || 'Recording').toString();
    ensureOverlayAttached();
  };

  window.__stitchRecorderOverlaySetReason = (text) => {
    const v = (text || '').toString().trim();
    state.reason = v || '-';
    ensureOverlayAttached();
  };

  window.__stitchRecorderOverlaySetPaused = (flag) => {
    state.paused = Boolean(flag);
    if (state.paused) {
      if (!state.pausedSince) state.pausedSince = Date.now();
    } else {
      state.pausedSince = null;
    }
    ensureOverlayAttached();
  };

  window.__stitchRecorderOverlaySetSaved = (path) => {
    state.status = 'Saved';
    state.reason = path ? `Saved to ${path}` : 'Saved';
    state.paused = false;
    state.pausedSince = null;
    state.savedPath = (path || '').toString();
    ensureOverlayAttached();
  };

  window.__stitchRecorderOverlaySetCount = (value) => {
    const n = Number(value || 0);
    state.count = Number.isFinite(n) ? n : 0;
    ensureOverlayAttached();
  };

  // Restore current count on reinjection/navigation.
  state.count = Number(window.__stitchRecorderStepCount || 0);
  ensureOverlayAttached();

  window.addEventListener('pageshow', ensureOverlayAttached);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) ensureOverlayAttached();
  });

  setInterval(() => {
    ensureOverlayAttached();
  }, 700);
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
    p.add_argument(
        "--command-file",
        default="",
        help="Optional NDJSON command file path for pause/resume/stop control",
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
    command_file = (
        Path(args.command_file).expanduser().resolve()
        if args.command_file
        else (session_dir / "control.ndjson")
    )
    command_file.parent.mkdir(parents=True, exist_ok=True)
    command_pos = 0
    _event(
        "scenario.record.location",
        {
            "runId": run_id,
            "sessionDir": str(session_dir),
            "scenarioPath": str(scenario_path),
            "commandFilePath": str(command_file),
        },
    )

    steps: list[RecordedStep] = []
    stop_event = asyncio.Event()
    paused = False
    console_hooks_page_ids: set[int] = set()

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

        if not payload or not isinstance(payload, dict):
            return

        kind = str(payload.get("kind") or "").strip().lower()
        url_raw = payload.get("url")
        if kind in ("nav", "goto", "navigate"):
            # Ignore malformed nav steps; they break replay with "nav step has no url".
            if not isinstance(url_raw, str) or not url_raw.strip():
                return

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
            return

    def _maybe_parse_console_step(text: str) -> None:
        prefix = "__STITCH_REC_STEP__"
        if not text or prefix not in text:
            return
        idx = text.find(prefix)
        if idx < 0:
            return
        raw = text[idx + len(prefix) :].strip()
        if not raw:
            return
        try:
            payload = json.loads(raw)
            if isinstance(payload, dict):
                on_record(payload)
        except Exception:
            return
        return

    def _maybe_parse_console_control(text: str) -> None:
        prefix = "__STITCH_REC_CTRL__"
        if not text or prefix not in text:
            return
        idx = text.find(prefix)
        if idx < 0:
            return
        raw = text[idx + len(prefix) :].strip()
        if not raw:
            return
        try:
            on_control(raw)
        except Exception:
            return
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

    def _read_control_file() -> None:
        nonlocal command_pos
        try:
            if not command_file.exists():
                return
            with command_file.open("r", encoding="utf-8") as fh:
                fh.seek(command_pos)
                for raw in fh:
                    line = raw.strip()
                    if not line:
                        continue
                    try:
                        payload = json.loads(line)
                    except Exception:
                        continue
                    if not isinstance(payload, dict):
                        continue
                    cmd = payload.get("command")
                    if isinstance(cmd, str):
                        on_control(cmd)
                command_pos = fh.tell()
        except Exception:
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

    async def update_overlay_all(
        ctx: Any,
        *,
        status: str | None = None,
        reason: str | None = None,
        paused_flag: bool | None = None,
        saved_path: str | None = None,
    ) -> None:
        try:
            pages = [p for p in getattr(ctx, "pages", []) if p and not p.is_closed()]
        except Exception:
            pages = []
        for p in pages:
            await update_overlay(
                p,
                status=status,
                reason=reason,
                paused_flag=paused_flag,
                saved_path=saved_path,
            )

    last_len = 0
    last_save_ts = 0.0

    context_scripts_installed = False
    context_bindings_installed = False

    async def _install_context_scripts(ctx: Any) -> None:
        nonlocal context_scripts_installed
        if context_scripts_installed:
            return
        try:
            await ctx.add_init_script(RECORDER_INIT_SCRIPT)
            await ctx.add_init_script(RECORDER_OVERLAY_SCRIPT)
            context_scripts_installed = True
        except Exception:
            # best-effort
            return

    async def _install_context_bindings(ctx: Any) -> None:
        """Expose bridge functions at context-level so they survive navigations/new tabs."""
        nonlocal context_bindings_installed
        if context_bindings_installed:
            return
        try:
            # In Playwright, bindings are shared across all pages in the context.
            # This avoids "Bridge not ready" when navigating or opening new tabs.
            await ctx.expose_binding(
                "__stitchRecordEvent",
                lambda _source, payload=None: on_record(payload or {}),
            )
        except Exception:
            # likely already registered
            pass
        try:
            await ctx.expose_binding(
                "__stitchRecordControl",
                lambda _source, cmd=None: on_control(str(cmd or "")),
            )
        except Exception:
            pass
        context_bindings_installed = True

    async def install_recorder_on_page(page: Page) -> None:
        # Prefer context-level bindings; keep page-level expose as best-effort fallback.
        # Some pages may block init scripts briefly; this ensures bridge appears eventually.
        try:
            await page.expose_function("__stitchRecordEvent", on_record)
        except Exception:
            pass
        try:
            await page.expose_function("__stitchRecordControl", on_control)
        except Exception:
            pass

        # Ensure init scripts apply for future navigations on this page.
        try:
            await page.add_init_script(RECORDER_INIT_SCRIPT)
            await page.add_init_script(RECORDER_OVERLAY_SCRIPT)
        except Exception:
            pass

        # Install into the currently loaded document so recording works immediately.
        try:
            await page.evaluate(RECORDER_INIT_SCRIPT)
        except Exception:
            pass
        try:
            await page.evaluate(RECORDER_OVERLAY_SCRIPT)
        except Exception:
            pass

    async def ensure_recorder_installed(ctx: Any) -> None:
        # Make overlay resilient across navigations and new tabs.
        await _install_context_bindings(ctx)
        await _install_context_scripts(ctx)
        try:
            pages = [p for p in getattr(ctx, "pages", []) if p and not p.is_closed()]
        except Exception:
            pages = []
        for p in pages:
            try:
                await install_recorder_on_page(p)
            except Exception:
                continue

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
            ctx = page.context
            await ensure_recorder_installed(ctx)
            await update_overlay_all(ctx, status="Recording", reason="", paused_flag=False)

            # Listen for console-based step protocol from any page.
            try:
                for p in ctx.pages:
                    try:
                        page_key = id(p)
                        if page_key in console_hooks_page_ids:
                            continue
                        p.on(
                            "console",
                            lambda msg: _maybe_parse_console_step(msg.text),
                        )
                        p.on(
                            "console",
                            lambda msg: _maybe_parse_console_control(msg.text),
                        )
                        console_hooks_page_ids.add(page_key)
                    except Exception:
                        pass
            except Exception:
                pass

            _event(
                "scenario.record.ready",
                {
                    "runId": run_id,
                    "alias": args.alias,
                    "url": args.url,
                },
            )

            export_snapshot()

            _log(
                "info",
                "Recording... cancel the job to stop (autosaves) or wait for timeout",
                step="record",
            )

            deadline = time.time() + float(args.timeout_s)
            while time.time() < deadline:
                await asyncio.sleep(0.5)
                _read_control_file()
                export_snapshot()
                await ensure_recorder_installed(ctx)
                # Ensure console listeners attached to any new pages
                try:
                    for p in ctx.pages:
                        try:
                            page_key = id(p)
                            if page_key in console_hooks_page_ids:
                                continue
                            p.on(
                                "console",
                                lambda msg: _maybe_parse_console_step(msg.text),
                            )
                            p.on(
                                "console",
                                lambda msg: _maybe_parse_console_control(msg.text),
                            )
                            console_hooks_page_ids.add(page_key)
                        except Exception:
                            pass
                except Exception:
                    pass
                if paused:
                    await update_overlay_all(
                        ctx, status="Paused", reason="Operator pause", paused_flag=True
                    )
                else:
                    await update_overlay_all(ctx, status="Recording", reason="", paused_flag=False)
                if stop_event.is_set():
                    _log("info", "Stop requested from browser overlay", step="record")
                    break
                try:
                    live_pages = [p for p in ctx.pages if p and not p.is_closed()]
                except Exception:
                    live_pages = []
                if not live_pages:
                    _log("info", "All pages closed - stopping record", step="record")
                    break

            await update_overlay_all(ctx, status="Saving", reason="", paused_flag=False)

    except Exception as e:
        _result(False, error={"code": "record_failed", "message": str(e)})
        return 1

    export_snapshot()

    try:
        # best-effort: show final state before context exits
        if "ctx" in locals() and ctx is not None:
            await update_overlay_all(ctx, saved_path=str(scenario_path))
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
