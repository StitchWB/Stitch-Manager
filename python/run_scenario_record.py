#!/usr/bin/env python3
from __future__ import annotations

"""Scenario Recorder (MVP)

Records user interactions in a headed CloakBrowser persistent profile and exports
them as a simple Scenario JSON for later replay.

IMPORTANT (preprod use): this recorder injects a small script into the page to
observe click/input/change/submit/navigation events. This can be detectable.

Protocol to Rust JobManager:
- stdout: NDJSON protocol messages (type=log|event|result)
- stderr: diagnostic logs

Usage example:
  python python/run_scenario_record.py --alias "test@local.profile" --url "https://example.com/login" --scenario-name "login"
"""

# Early startup logging to stderr for debugging (after __future__ import)
import os
import sys
import time


def _safe_stderr(msg: str) -> None:
    """Write to stderr with encoding error handling for Windows."""
    try:
        sys.stderr.write(msg.rstrip() + os.linesep)
        sys.stderr.flush()
    except Exception:
        try:
            if hasattr(sys.stderr, 'buffer'):
                sys.stderr.buffer.write(msg.encode('utf-8', errors='replace') + b'\n')
        except Exception:
            pass

_safe_stderr(f"[run_scenario_record.py] Starting at {time.strftime('%Y-%m-%d %H:%M:%S')}")

import argparse
import asyncio
import json
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urlsplit

if TYPE_CHECKING:
    from playwright.async_api import Page

# Ensure project imports work regardless of cwd.
# NOTE: Our python package root is the "python/" directory.
PYTHON_ROOT = Path(__file__).resolve().parent
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

from extension_bridge_host import ExtensionBridgeHost
from scenario_io import build_scenario_container, write_scenario


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
    frameSrc: str | None = None


def _parse_proxy_switch_raw(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None

    # URL form: scheme://[user:pass@]host:port
    if "://" in raw:
        try:
            parsed = urlsplit(raw)
            if parsed.hostname and parsed.port:
                return {
                    "scheme": (parsed.scheme or "http").strip().lower(),
                    "host": parsed.hostname,
                    "port": int(parsed.port),
                    "username": parsed.username,
                    "password": parsed.password,
                }
        except Exception:
            return None

    # Legacy bulk form: host:port[:username:password]
    scheme = "http"
    payload = raw

    parts = [p.strip() for p in payload.split(":")]
    if len(parts) not in (2, 4):
        return None

    host = parts[0]
    if not host:
        return None

    try:
        port = int(parts[1])
    except Exception:
        return None
    if port <= 0 or port > 65535:
        return None

    username = parts[2] if len(parts) == 4 and parts[2] else None
    password = parts[3] if len(parts) == 4 and parts[3] else None

    return {
        "scheme": scheme if scheme in ("http", "socks5", "https") else "http",
        "host": host,
        "port": port,
        "username": username,
        "password": password,
    }


def _parse_proxy_library_catalog_item(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None

    proxy_id = str(value.get("id") or "").strip()
    host = str(value.get("host") or "").strip()
    if not proxy_id or not host:
        return None

    try:
        port = int(value.get("port") or 0)
    except Exception:
        return None
    if port <= 0 or port > 65535:
        return None

    scheme = str(value.get("proxyType") or "http").strip().lower()
    if scheme not in ("http", "https", "socks5"):
        scheme = "http"

    return {
        "id": proxy_id,
        "scheme": scheme,
        "host": host,
        "port": port,
        "username": value.get("username"),
        "password": value.get("password"),
    }


def _build_proxy_url_from_catalog_item(item: dict[str, Any]) -> str:
    scheme = str(item.get("scheme") or "http")
    host = str(item.get("host") or "")
    port = int(item.get("port") or 0)
    username = item.get("username")
    password = item.get("password")
    if username:
        return f"{scheme}://{username}:{password or ''}@{host}:{port}"
    return f"{scheme}://{host}:{port}"


def _mask_proxy_for_display(data: dict[str, Any]) -> str:
    scheme = str(data.get("scheme") or "http")
    host = str(data.get("host") or "")
    port = str(data.get("port") or "")
    username = data.get("username")
    if username:
        return f"{scheme}://{username}:***@{host}:{port}"
    return f"{scheme}://{host}:{port}"


RECORDER_INIT_SCRIPT = r"""
(() => {
  // Record events in top-level document and same-origin iframes.
  // Cross-origin iframes are blocked by browser security.
  let _isTopFrame = true;
  let _frameSrc = null;
  try {
    if (window.top !== window.self) {
      try {
        void window.top.document;
        _isTopFrame = false;
        _frameSrc = location.href;
      } catch {
        return;
      }
    }
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
      if (!_isTopFrame && _frameSrc) {
        payload.frameSrc = _frameSrc;
      }
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

  const isOverlayEvent = (event, el) => {
    try {
      if (el && el.closest && el.closest('[data-stitch-recorder="1"]')) return true;
    } catch {}
    try {
      if (event && typeof event.composedPath === 'function') {
        const path = event.composedPath();
        if (Array.isArray(path)) {
          for (const node of path) {
            if (node && node.nodeType === 1 && node.getAttribute) {
              if (node.getAttribute('data-stitch-recorder') === '1') return true;
            }
          }
        }
      }
    } catch {}
    return false;
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

  const looksSensitive = (s) => {
    const value = (s ?? '').toString().trim().toLowerCase();
    if (!value) return false;
    return [
      'password',
      'passcode',
      'otp',
      'one-time',
      'token',
      'secret',
      'cvv',
      'cvc',
      'security code',
      'card',
      'pan',
      'expiry',
      'exp',
      'iban',
      'ssn',
    ].some((part) => value.includes(part));
  };

  const shouldRedact = (el) => {
    const type = (safe(() => el?.getAttribute?.('type')) || '').toString().toLowerCase();
    if (type === 'password') return true;
    const attrs = [
      safe(() => el?.getAttribute?.('name')),
      safe(() => el?.getAttribute?.('id')),
      safe(() => el?.getAttribute?.('autocomplete')),
      safe(() => el?.getAttribute?.('aria-label')),
      safe(() => el?.getAttribute?.('placeholder')),
    ];
    return attrs.some((v) => looksSensitive(v));
  };

  const redactValue = (el, value) => {
    if (shouldRedact(el)) return '***';
    return value;
  };

  const inputTimers = new WeakMap();

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (isOverlayEvent(e, el)) return;

    try {
      const prev = inputTimers.get(el);
      if (prev) clearTimeout(prev);
    } catch {}

    const timer = setTimeout(() => {
      const value = safe(() => el && 'value' in el ? el.value : null);
      send({
        kind: 'input',
        ts: new Date().toISOString(),
        url: location.href,
        selector: cssPath(el),
        value: redactValue(el, value),
        meta: describeEl(el)
      });
      try { inputTimers.delete(el); } catch {}
    }, 220);

    try { inputTimers.set(el, timer); } catch {}
  }, true);

  document.addEventListener('click', (e) => {
    const el = e.target;
    if (isOverlayEvent(e, el)) return;
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
    if (isOverlayEvent(e, el)) return;
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
    if (isOverlayEvent(e, el)) return;
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


_SHARED_OVERLAY_RUNTIME_PATH = (
    PYTHON_ROOT.parent / "extension" / "stitch-toolkit" / "overlay_runtime.js"
)


def _overlay_runtime_shim_script() -> str:
    return r"""
(() => {
  if (window.StitchOverlayRuntime) return;
  const fallback = {
    createOverlayShell(options = {}) {
      const parent = document.documentElement || document.body;
      if (!parent) return null;
      const hostId = String(options.hostId || '__stitch-overlay-host');
      let host = document.getElementById(hostId);
      if (!host) {
        host = document.createElement('div');
        host.id = hostId;
      }
      host.style.position = 'fixed';
      host.style.zIndex = '2147483647';
      host.style.pointerEvents = 'none';
      host.style.right = `${Number.isFinite(Number(options.offsetX)) ? Number(options.offsetX) : 16}px`;
      if (String(options.position || '') === 'bottom-right') {
        host.style.bottom = `${Number.isFinite(Number(options.offsetY)) ? Number(options.offsetY) : 16}px`;
        host.style.top = '';
      } else {
        host.style.top = `${Number.isFinite(Number(options.offsetY)) ? Number(options.offsetY) : 16}px`;
        host.style.bottom = '';
      }
      if (options.markerAttr) host.setAttribute(String(options.markerAttr), '1');
      if (!host.isConnected) parent.appendChild(host);
      if (!host.shadowRoot) host.attachShadow({ mode: 'open' });
      const root = host.shadowRoot;
      let panel = root.getElementById('__shim_panel');
      if (!panel) {
        panel = document.createElement('div');
        panel.id = '__shim_panel';
        panel.style.pointerEvents = 'auto';
        panel.style.background = 'rgba(8,14,22,.95)';
        panel.style.color = '#f0f7ff';
        panel.style.border = '1px solid rgba(133,180,208,.36)';
        panel.style.borderRadius = '12px';
        panel.style.padding = '10px';
        panel.style.fontFamily = 'Segoe UI, Tahoma, sans-serif';
        panel.style.fontSize = '12px';
        panel.style.minWidth = '220px';
        const title = document.createElement('div');
        title.id = '__shim_title';
        const status = document.createElement('div');
        status.id = '__shim_status';
        const main = document.createElement('div');
        main.id = '__shim_main';
        main.style.margin = '6px 0';
        const reason = document.createElement('div');
        reason.id = '__shim_reason';
        const paused = document.createElement('div');
        paused.id = '__shim_paused';
        const compact = document.createElement('div');
        compact.id = '__shim_compact';
        compact.style.display = 'none';
        const body = document.createElement('div');
        body.id = '__shim_body';
        const extra = document.createElement('div');
        extra.id = '__shim_extra';
        const controls = document.createElement('div');
        controls.id = '__shim_controls';
        controls.style.display = 'flex';
        controls.style.gap = '6px';
        controls.style.flexWrap = 'wrap';
        body.appendChild(main);
        body.appendChild(reason);
        body.appendChild(paused);
        body.appendChild(extra);
        body.appendChild(controls);
        panel.appendChild(title);
        panel.appendChild(status);
        panel.appendChild(compact);
        panel.appendChild(body);
        root.appendChild(panel);
      }
      return {
        host,
        root,
        panel,
        titleEl: root.getElementById('__shim_title'),
        statusEl: root.getElementById('__shim_status'),
        mainEl: root.getElementById('__shim_main'),
        reasonEl: root.getElementById('__shim_reason'),
        pausedEl: root.getElementById('__shim_paused'),
        extraEl: root.getElementById('__shim_extra'),
        controlsEl: root.getElementById('__shim_controls'),
        compactEl: root.getElementById('__shim_compact'),
        bodyEl: root.getElementById('__shim_body'),
        collapseBtn: null,
        collapsed: false,
        setCollapsed(next) {
          this.collapsed = Boolean(next);
          if (this.compactEl) this.compactEl.style.display = this.collapsed ? 'block' : 'none';
          if (this.bodyEl) this.bodyEl.style.display = this.collapsed ? 'none' : 'block';
        },
        setVisible(visible) {
          host.style.display = visible ? 'block' : 'none';
        },
      };
    },
    renderControls(shell, controls, onCommand) {
      if (!shell || !shell.controlsEl) return;
      shell.controlsEl.textContent = '';
      for (const entry of controls || []) {
        const btn = document.createElement('button');
        const command = String((entry && entry.command) || '');
        btn.type = 'button';
        btn.textContent = String((entry && entry.label) || command || 'Action');
        btn.dataset.command = command;
        btn.style.padding = '6px 8px';
        btn.style.borderRadius = '7px';
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (typeof onCommand === 'function') onCommand(command, entry || {}, event);
        });
        shell.controlsEl.appendChild(btn);
      }
    },
    setControlState(shell, command, patch = {}) {
      const btn = shell && shell.controlsEl
        ? shell.controlsEl.querySelector(`button[data-command="${String(command || '')}"]`)
        : null;
      if (!btn) return;
      if (Object.prototype.hasOwnProperty.call(patch, 'disabled')) btn.disabled = Boolean(patch.disabled);
      if (Object.prototype.hasOwnProperty.call(patch, 'label')) btn.textContent = String(patch.label || btn.textContent || '');
    },
  };
  window.StitchOverlayRuntime = fallback;
})();
"""


def _load_shared_overlay_runtime_script() -> str:
    try:
        source = _SHARED_OVERLAY_RUNTIME_PATH.read_text(encoding="utf-8")
        if source.strip():
            return source
    except Exception as e:
        _log(
            "warn",
            f"Shared overlay runtime unavailable, using shim: {e}",
            step="overlay",
        )
    return _overlay_runtime_shim_script()


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
      collapsed: false,
      count: Number(window.__stitchRecorderStepCount || 0),
      savedPath: '',
      tabs: [],
      activeTabId: null,
      activeProxyId: (window.__stitchRecorderActiveProxyId || '').toString(),
      activeProxyLabel: (window.__stitchRecorderActiveProxyLabel || '').toString(),
    };
  }
  window.__stitchRecorderRecording = true;

  const state = window.__stitchRecorderOverlayState;
  const runtime = window.StitchOverlayRuntime;
  if (!runtime || typeof runtime.createOverlayShell !== 'function') return;

  const getRuntimeCatalog = () => (
    Array.isArray(window.__stitchRecorderRuntimeProxyCatalog)
      ? window.__stitchRecorderRuntimeProxyCatalog
      : []
  );

  const getRuntimeMap = () => (
    window.__stitchRecorderRuntimeProxyMap &&
    typeof window.__stitchRecorderRuntimeProxyMap === 'object'
      ? window.__stitchRecorderRuntimeProxyMap
      : {}
  );

  const syncProxyPicker = (picker, input) => {
    if (!picker) return;
    const runtimeCatalog = getRuntimeCatalog();
    const runtimeMap = getRuntimeMap();
    const runtimeMapKeys = Object.keys(runtimeMap || {});
    const currentProxyId = (state.activeProxyId || '').toString().trim();
    const currentProxyLabel = (state.activeProxyLabel || '').toString().trim();
    const preserved = (
      (picker.value || '').toString().trim() ||
      (input && input.value ? input.value.toString().trim() : '') ||
      currentProxyId
    );

    while (picker.firstChild) picker.removeChild(picker.firstChild);

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = runtimeCatalog.length || runtimeMapKeys.length
      ? 'Pick proxy from library'
      : 'No enabled proxies in library';
    picker.appendChild(defaultOpt);

    const seen = new Set();
    if (currentProxyId) {
      const currentOpt = document.createElement('option');
      currentOpt.value = currentProxyId;
      currentOpt.textContent = currentProxyLabel || `Current proxy (${currentProxyId})`;
      picker.appendChild(currentOpt);
      seen.add(currentProxyId);
    }

    for (const item of runtimeCatalog) {
      try {
        const id = (item.id || '').toString().trim();
        if (!id || seen.has(id)) continue;
        const opt = document.createElement('option');
        opt.value = id;
        const label = (item.label || '').toString().trim() || id;
        const host = (item.host || '').toString();
        const port = String(item.port || '');
        const type = (item.proxyType || 'http').toString();
        opt.textContent = `${label} (${type}://${host}:${port})`;
        picker.appendChild(opt);
        seen.add(id);
      } catch {}
    }

    if (!runtimeCatalog.length && runtimeMapKeys.length) {
      for (const key of runtimeMapKeys) {
        try {
          const id = String(key || '').trim();
          if (!id || seen.has(id)) continue;
          const raw = (runtimeMap[key] || '').toString();
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = raw ? `${id} (${raw})` : id;
          picker.appendChild(opt);
          seen.add(id);
        } catch {}
      }
    }

    const selectedId = preserved && seen.has(preserved)
      ? preserved
      : currentProxyId && seen.has(currentProxyId)
        ? currentProxyId
        : '';
    picker.value = selectedId;
    if (input && !input.value && selectedId) input.value = selectedId;
  };

  const sendControl = (cmd) => {
    try {
      if (typeof window.__stitchRecordControl === 'function') {
        window.__stitchRecordControl(cmd);
        return;
      }
    } catch {}
    try {
      console.info('__STITCH_REC_CTRL__' + String(cmd || ''));
    } catch {}
  };

  const emitProxySwitch = (proxyLibraryId) => {
    const id = (proxyLibraryId || '').toString().trim();
    if (!id) return;
    try {
      const payload = {
        kind: 'proxy.switch',
        ts: new Date().toISOString(),
        url: location.href,
        selector: null,
        value: null,
        meta: {
          proxyLibraryId: id,
          hasDirectProxy: false,
        },
      };
      if (typeof window.__stitchRecordEvent === 'function') {
        window.__stitchRecordEvent(payload);
      } else {
        console.info('__STITCH_REC_STEP__' + JSON.stringify(payload));
      }
    } catch {}
  };

  const requestProxyRestart = (proxyLibraryId) => {
    try {
      sendControl(JSON.stringify({
        action: 'proxy.restart',
        proxyLibraryId: (proxyLibraryId || '').toString().trim() || null,
        url: location.href,
      }));
    } catch {}
  };

  let shell = null;
  let ui = null;

  const ensureShell = () => {
    if (shell && shell.host && shell.host.isConnected) return shell;
    shell = runtime.createOverlayShell({
      hostId: '__stitch-recorder-overlay-host',
      position: 'bottom-right',
      offsetX: 16,
      offsetY: 16,
      markerAttr: 'data-stitch-recorder',
      title: 'Recorder',
      status: 'Status: Recording',
      mainText: 'Steps: 0',
      reasonText: 'Reason: -',
      pausedText: '',
      visible: true,
      collapsible: true,
      collapsed: Boolean(state.collapsed),
      onToggleCollapse: (collapsed) => {
        state.collapsed = Boolean(collapsed);
        renderOverlay();
      },
    });
    if (!shell) return null;

    runtime.renderControls(
      shell,
      [
        ...(window.__stitchRecorderRecording && !state.paused ? [{ command: 'manual', label: 'Manual ⏸', variant: 'accent' }] : []),
        { command: 'pause', label: state.paused ? 'Resume' : 'Pause' },
        { command: 'stop', label: 'Finish & Save', variant: 'stop' },
        { command: 'browser.close', label: 'Close Browser', variant: 'accent' },
      ],
      (command) => {
        if (command === 'manual') {
          // Record manual step and pause
          if (window.__stitchRecordEvent) {
            window.__stitchRecordEvent({
              kind: 'manual',
              ts: new Date().toISOString(),
              url: location.href,
              selector: null,
              value: null,
              meta: { source: 'manual-step', description: 'Manual action required (e.g., captcha)' },
            });
          } else {
            console.info('__STITCH_REC_STEP__' + JSON.stringify({
              kind: 'manual',
              ts: new Date().toISOString(),
              url: location.href,
              selector: null,
              value: null,
              meta: { source: 'manual-step', description: 'Manual action required (e.g., captcha)' },
            }));
          }
          // Pause recording
          state.paused = true;
          window.__stitchRecorderPaused = true;
          state.status = 'Manual step';
          state.reason = 'Complete the action manually, then click Resume';
          state.pausedSince = Date.now();
          sendControl('pause');
          renderOverlay();
          return;
        }

        if (command === 'pause') {
          // If resuming from manual step, record manual-continue step
          if (state.status === 'Manual step' && state.paused) {
            if (window.__stitchRecordEvent) {
              window.__stitchRecordEvent({
                kind: 'manual-continue',
                ts: new Date().toISOString(),
                url: location.href,
                selector: null,
                value: null,
                meta: { source: 'manual-step-continue' },
              });
            } else {
              console.info('__STITCH_REC_STEP__' + JSON.stringify({
                kind: 'manual-continue',
                ts: new Date().toISOString(),
                url: location.href,
                selector: null,
                value: null,
                meta: { source: 'manual-step-continue' },
              }));
            }
          }
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
          return;
        }

        if (command === 'stop') {
          state.status = 'Stopping...';
          window.__stitchRecorderPaused = true;
          state.pausedSince = null;
          renderOverlay();
          sendControl('stop');
          return;
        }

        if (command === 'browser.close') {
          state.status = 'Closing browser...';
          state.reason = 'Operator requested browser close';
          renderOverlay();
          sendControl(JSON.stringify({ action: 'browser.close' }));
        }
      }
    );
    return shell;
  };

  const makeBtn = (label, variant) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `stitch-btn${variant ? ` ${variant}` : ''}`;
    btn.textContent = label;
    return btn;
  };

  const ensureUi = () => {
    const currentShell = ensureShell();
    if (!currentShell || !currentShell.extraEl) return null;
    if (ui && ui.tabsList && ui.tabsList.isConnected) return ui;

    const extra = currentShell.extraEl;
    extra.textContent = '';

    const tabsBlock = document.createElement('div');
    tabsBlock.style.marginBottom = '8px';
    const tabsHeader = document.createElement('div');
    tabsHeader.textContent = 'Tabs';
    tabsHeader.className = 'stitch-subhead';
    const tabsList = document.createElement('div');
    tabsList.style.display = 'flex';
    tabsList.style.flexDirection = 'column';
    tabsList.style.gap = '4px';
    tabsBlock.appendChild(tabsHeader);
    tabsBlock.appendChild(tabsList);

    const proxyPicker = document.createElement('select');
    proxyPicker.className = 'stitch-field';
    proxyPicker.style.marginBottom = '8px';

    const proxyRow = document.createElement('div');
    proxyRow.style.display = 'grid';
    proxyRow.style.gridTemplateColumns = '1fr auto auto';
    proxyRow.style.gap = '6px';
    proxyRow.style.marginBottom = '8px';

    const proxyInput = document.createElement('input');
    proxyInput.type = 'text';
    proxyInput.placeholder = 'proxyLibraryId';
    proxyInput.className = 'stitch-field';
    proxyInput.style.padding = '8px 10px';

    const proxyRecordBtn = makeBtn('Record Step', 'success');
    const proxyApplyBtn = makeBtn('Apply&Continue', 'accent');

    proxyPicker.onchange = () => {
      const id = (proxyPicker.value || '').trim();
      if (id) proxyInput.value = id;
    };

    proxyRecordBtn.onclick = () => {
      const id = (proxyInput.value || '').trim();
      if (!id) return;
      emitProxySwitch(id);
      state.reason = `Proxy switched (${id})`;
      renderOverlay();
    };

    proxyApplyBtn.onclick = () => {
      const id = (proxyInput.value || '').trim();
      if (!id) return;
      emitProxySwitch(id);
      requestProxyRestart(id);
      state.status = 'Restarting...';
      state.reason = `Restarting with ${id}`;
      renderOverlay();
    };

    proxyRow.appendChild(proxyInput);
    proxyRow.appendChild(proxyRecordBtn);
    proxyRow.appendChild(proxyApplyBtn);

    const utilityRow = document.createElement('div');
    utilityRow.style.display = 'flex';
    utilityRow.style.gap = '6px';
    utilityRow.style.marginTop = '8px';
    const newTabBtn = makeBtn('New tab', '');
    newTabBtn.onclick = () => {
      sendControl(JSON.stringify({ action: 'tab.new' }));
    };
    utilityRow.appendChild(newTabBtn);

    extra.appendChild(tabsBlock);
    extra.appendChild(proxyPicker);
    extra.appendChild(proxyRow);
    extra.appendChild(utilityRow);

    ui = {
      tabsList,
      proxyPicker,
      proxyInput,
      newTabBtn,
    };
    return ui;
  };

  const renderTabs = () => {
    const refs = ensureUi();
    if (!refs) return;
    const tabsList = refs.tabsList;
    while (tabsList.firstChild) tabsList.removeChild(tabsList.firstChild);

    const tabs = Array.isArray(state.tabs) ? state.tabs : [];
    const activeTabId = (state.activeTabId || '').toString();
    if (!tabs.length) {
      const empty = document.createElement('div');
      empty.textContent = 'No tabs';
      empty.style.opacity = '0.7';
      tabsList.appendChild(empty);
      return;
    }

    let tabIdx = 0;
    for (const tab of tabs) {
      const tabId = (tab && tab.id != null ? String(tab.id) : '').trim();
      if (!tabId) continue;
      tabIdx += 1;

      const row = document.createElement('div');
      row.className = 'stitch-tab-row';

      const activate = document.createElement('button');
      activate.type = 'button';
      activate.className = `stitch-tab-btn${tabId === activeTabId ? ' active' : ''}`;
      activate.title = (tab.url || '').toString();

      const content = document.createElement('span');
      content.style.display = 'inline-flex';
      content.style.alignItems = 'center';
      content.style.gap = '6px';

      const indexBadge = document.createElement('span');
      indexBadge.textContent = String(tabIdx);
      indexBadge.style.opacity = '0.75';
      indexBadge.style.minWidth = '12px';

      const faviconUrl = (tab.favicon || '').toString().trim();
      if (faviconUrl) {
        const img = document.createElement('img');
        img.src = faviconUrl;
        img.alt = '';
        img.width = 14;
        img.height = 14;
        img.style.width = '14px';
        img.style.height = '14px';
        img.style.borderRadius = '3px';
        img.style.objectFit = 'cover';
        img.style.background = 'rgba(15,23,42,0.5)';
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => {
          try { img.remove(); } catch {}
        };
        content.appendChild(img);
      }

      const label = document.createElement('span');
      label.textContent = (tab.title || tab.url || 'tab').toString().slice(0, 42);
      content.appendChild(indexBadge);
      content.appendChild(label);
      activate.textContent = '';
      activate.appendChild(content);

      activate.onclick = () => {
        sendControl(JSON.stringify({ action: 'tab.activate', tabId }));
      };

      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '×';
      close.className = 'stitch-tab-close';
      close.onclick = () => {
        sendControl(JSON.stringify({ action: 'tab.close', tabId }));
      };

      row.appendChild(activate);
      row.appendChild(close);
      tabsList.appendChild(row);
    }
  };

  const renderOverlay = () => {
    const currentShell = ensureShell();
    const refs = ensureUi();
    if (!currentShell || !refs) return;

    syncProxyPicker(refs.proxyPicker, refs.proxyInput);

    if (currentShell.titleEl) currentShell.titleEl.textContent = 'Recorder';
    if (currentShell.statusEl) currentShell.statusEl.textContent = `Status: ${state.status || 'Recording'}`;
    if (currentShell.mainEl) currentShell.mainEl.textContent = `Steps: ${Number.isFinite(Number(state.count)) ? Number(state.count) : 0}`;

    let reasonValue = (state.reason || '-').toString();
    if (!reasonValue || reasonValue === '-') {
      const currentProxyId = (state.activeProxyId || '').toString().trim();
      const currentProxyLabel = (state.activeProxyLabel || '').toString().trim();
      if (currentProxyId || currentProxyLabel) {
        reasonValue = currentProxyLabel ? `Proxy: ${currentProxyLabel}` : `Proxy: ${currentProxyId}`;
      }
    }
    if (currentShell.reasonEl) {
      currentShell.reasonEl.textContent = `Reason: ${reasonValue || '-'}`;
      currentShell.reasonEl.style.display = 'block';
    }

    if (currentShell.pausedEl) {
      if (state.paused && state.pausedSince) {
        const sec = Math.max(0, Math.floor((Date.now() - state.pausedSince) / 1000));
        currentShell.pausedEl.textContent = `Paused: ${sec}s`;
        currentShell.pausedEl.style.display = 'block';
      } else {
        currentShell.pausedEl.textContent = 'Paused: -';
        currentShell.pausedEl.style.display = 'none';
      }
    }

    if (currentShell.compactEl) {
      currentShell.compactEl.textContent = `${state.paused ? 'PAUSED' : 'REC'} • ${Number.isFinite(Number(state.count)) ? Number(state.count) : 0}`;
    }

    runtime.setControlState(currentShell, 'pause', { label: state.paused ? 'Resume' : 'Pause' });
    currentShell.setCollapsed(Boolean(state.collapsed));
    currentShell.setVisible(true);
    renderTabs();
  };

  const ensureOverlayAttached = () => {
    const currentShell = ensureShell();
    if (!currentShell) return;
    if (!currentShell.host.isConnected) {
      (document.body || document.documentElement).appendChild(currentShell.host);
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

  window.__stitchRecorderOverlaySetTabs = (payload) => {
    const data = payload && typeof payload === 'object' ? payload : {};
    const tabs = Array.isArray(data.tabs) ? data.tabs : [];
    state.tabs = tabs
      .map((t) => {
        if (!t || typeof t !== 'object') return null;
        const id = (t.id || '').toString().trim();
        if (!id) return null;
        return {
          id,
          title: (t.title || '').toString(),
          url: (t.url || '').toString(),
          favicon: (t.favicon || '').toString(),
        };
      })
      .filter(Boolean);
    const activeTabId = (data.activeTabId || '').toString().trim();
    state.activeTabId = activeTabId || (state.tabs[0] ? state.tabs[0].id : null);
    ensureOverlayAttached();
  };

  window.__stitchRecorderOverlaySetProxy = (payload) => {
    const data = payload && typeof payload === 'object' ? payload : {};
    state.activeProxyId = (data.proxyLibraryId || '').toString().trim();
    state.activeProxyLabel = (data.label || '').toString().trim();
    ensureOverlayAttached();
  };

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


RECORDER_OVERLAY_SCRIPT = _load_shared_overlay_runtime_script() + "\n" + RECORDER_OVERLAY_SCRIPT


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Record a scenario in persistent browser profile")
    p.add_argument("--alias", required=True, help="Profile alias (maps to persistent profile id)")
    p.add_argument("--url", required=True, help="Start URL")
    p.add_argument("--scenario-name", default="scenario", help="Scenario name")
    p.add_argument("--timeout-s", type=int, default=3600, help="Max record duration")
    p.add_argument("--proxy", default="", help="Optional proxy URL")
    p.add_argument("--headless", action="store_true", help="Run browser in headless mode")
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
        help="Browser engine (default: cloakbrowser); ProfileLauncher normalizes aliases",
    )
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
    p.add_argument(
        "--no-overlay",
        action="store_true",
        help="Disable in-browser recorder overlay UI (recording stays active)",
    )
    return p.parse_args()


async def main_async() -> int:
    args = _parse_args()
    overlay_enabled = not bool(args.no_overlay)

    # Enhanced error logging for debugging startup failures
    try:

        from autoreg.browser.profile_launcher import ProfileLauncher, _normalize_engine
        from autoreg.core.paths import get_paths
    except Exception as e:
        import traceback
        _log("error", f"Import error: {e}", step="init")
        sys.stderr.write(f"IMPORT ERROR: {e}\n")
        sys.stderr.write(traceback.format_exc())
        sys.stderr.flush()
        _result(False, error={"code": "import_error", "message": str(e), "details": traceback.format_exc()})
        return 1

    if _normalize_engine(args.engine) != "cloakbrowser":
        # The capture path is Playwright-specific (context init scripts,
        # bindings, console channel). ShardBrowser's DrissionPage facade
        # exposes none of those, so fail fast instead of crashing mid-launch.
        _result(
            False,
            error={
                "code": "engine_not_supported_for_record",
                "message": (
                    f"Scenario recording does not support engine '{args.engine}' yet: "
                    "capture needs the Playwright context APIs that only the "
                    "CloakBrowser path provides. Use engine 'cloakbrowser' for recording."
                ),
            },
        )
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
    stop_requested = False
    paused = False
    keep_browser_open_after_save = False
    console_hooks_page_ids: set[int] = set()
    runtime_proxy_map: dict[str, str] = {}
    pending_proxy_restart: dict[str, Any] | None = None
    pending_browser_close = False
    pending_tab_controls: list[dict[str, Any]] = []
    active_proxy_url: str | None = args.proxy or None
    active_page_id: str | None = None

    config: dict[str, Any] = {"timezone_id": "Auto", "geolocation": "Auto"}
    if args.config_json and args.config_json.strip():
        try:
            loaded = json.loads(args.config_json)
            if isinstance(loaded, dict):
                config.update(loaded)
        except Exception:
            _log("warn", "Invalid --config-json, ignoring", step="init")

    runtime_proxy_map = {
        str(k): str(v)
        for k, v in dict(config.get("runtime_proxy_map") or {}).items()
        if isinstance(k, str) and isinstance(v, str) and k.strip() and v.strip()
    }

    runtime_proxy_catalog = [
        item
        for item in list(config.get("runtime_proxy_catalog") or [])
        if isinstance(item, dict)
        and str(item.get("id") or "").strip()
        and str(item.get("host") or "").strip()
        and str(item.get("label") or "").strip()
    ]

    runtime_proxy_catalog_map: dict[str, dict[str, Any]] = {}
    for item in runtime_proxy_catalog:
        parsed_item = _parse_proxy_library_catalog_item(item)
        if parsed_item is not None:
            runtime_proxy_catalog_map[parsed_item["id"]] = parsed_item

    for proxy_id, item in runtime_proxy_catalog_map.items():
        if proxy_id not in runtime_proxy_map:
            runtime_proxy_map[proxy_id] = _build_proxy_url_from_catalog_item(item)

    active_proxy_library_id = str(config.get("proxy_library_id") or "").strip() or None

    # Auto-apply configured profile proxy on startup.
    # Previously proxy was only applied after manual overlay restart action,
    # which caused recording sessions to start without proxy even when profile
    # had proxy_library_id + runtime_proxy_map configured.
    if not active_proxy_url:
        if active_proxy_library_id and active_proxy_library_id in runtime_proxy_map:
            active_proxy_url = runtime_proxy_map.get(active_proxy_library_id)
        elif len(runtime_proxy_map) == 1:
            only_id, only_url = next(iter(runtime_proxy_map.items()))
            active_proxy_library_id = active_proxy_library_id or str(only_id)
            active_proxy_url = str(only_url)

    def _build_active_proxy_payload(
        proxy_library_id: str | None, proxy_url: str | None
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "proxyLibraryId": proxy_library_id or "",
            "label": "",
            "proxyUrl": proxy_url or "",
        }

        if proxy_library_id:
            item = runtime_proxy_catalog_map.get(proxy_library_id)
            if item is not None:
                label = str(item.get("label") or "").strip()
                host = str(item.get("host") or "").strip()
                port = str(item.get("port") or "").strip()
                proxy_type = str(item.get("proxyType") or "http").strip()
                payload["label"] = label or f"{proxy_type}://{host}:{port}"
            else:
                payload["label"] = proxy_library_id
        elif proxy_url:
            payload["label"] = proxy_url

        return payload

    def _ensure_recorder_tab_ui_prefs() -> None:
        """Force native clickable tabs for recorder windows.

        Some profile-level prefs can hide tab UI, which makes newly opened tabs
        switchable only via keyboard shortcuts (e.g. Ctrl+Tab). Recorder should
        preserve native tab interaction (click to switch/close).
        """

        raw_launch_kwargs = config.get("launch_kwargs")
        launch_kwargs: dict[str, Any] = (
            dict(raw_launch_kwargs) if isinstance(raw_launch_kwargs, dict) else {}
        )

        raw_prefs = launch_kwargs.get("firefox_user_prefs")
        firefox_prefs: dict[str, Any] = dict(raw_prefs) if isinstance(raw_prefs, dict) else {}

        # Keep tab strip visible and avoid closing browser window when the last
        # tab is closed by accident during recording.
        firefox_prefs.setdefault("browser.tabs.autoHide", False)
        firefox_prefs.setdefault("browser.tabs.forceHide", False)
        firefox_prefs.setdefault("browser.tabs.closeWindowWithLastTab", False)

        # Prefer classic tab behavior over sidebar-only vertical tabs.
        firefox_prefs.setdefault("sidebar.verticalTabs", False)

        launch_kwargs["firefox_user_prefs"] = firefox_prefs
        config["launch_kwargs"] = launch_kwargs

    _ensure_recorder_tab_ui_prefs()

    def on_record(payload: dict[str, Any]) -> None:
        nonlocal paused
        if paused:
            return

        if not payload or not isinstance(payload, dict):
            return

        kind = str(payload.get("kind") or "").strip().lower()

        # Normalize proxy.switch payload and avoid leaking credentials in step.value.
        if kind == "proxy.switch":
            switch_meta = dict(payload.get("meta") or {})
            proxy_id = str(switch_meta.get("proxyLibraryId") or "").strip() or None

            resolved_raw = runtime_proxy_map.get(proxy_id) if proxy_id else None

            parsed = _parse_proxy_switch_raw(resolved_raw)
            if not parsed:
                _event(
                    "scenario.record.proxy_switch.invalid",
                    {
                        "runId": run_id,
                        "proxyLibraryId": proxy_id,
                    },
                )
                return

            display = _mask_proxy_for_display(parsed)
            payload = dict(payload)
            payload["kind"] = "proxy.switch"
            payload["value"] = None
            payload["meta"] = {
                **switch_meta,
                "proxyLibraryId": proxy_id,
                "proxyType": parsed.get("scheme"),
                "host": parsed.get("host"),
                "port": parsed.get("port"),
                "hasAuth": bool(parsed.get("username")),
                "display": display,
            }
            kind = "proxy.switch"
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
                frameSrc=str(payload.get("frameSrc")) if payload.get("frameSrc") else None,
            )
            steps.append(step)
            _event(
                "scenario.record.step",
                {
                    "kind": step.kind,
                    "selector": step.selector,
                    "url": step.url,
                    "display": step.meta.get("display") if isinstance(step.meta, dict) else None,
                },
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
        nonlocal \
            paused, \
            stop_requested, \
            pending_proxy_restart, \
            pending_tab_controls, \
            pending_browser_close, \
            keep_browser_open_after_save
        raw_cmd = str(command or "").strip()
        if not raw_cmd:
            return

        # Structured overlay controls are JSON messages.
        if raw_cmd.startswith("{") and raw_cmd.endswith("}"):
            try:
                payload = json.loads(raw_cmd)
            except Exception:
                payload = None
            if isinstance(payload, dict):
                action = str(payload.get("action") or "").strip().lower()
                if action == "proxy.restart":
                    pending_proxy_restart = payload
                    _event(
                        "scenario.record.control.proxy_restart",
                        {
                            "runId": run_id,
                            "proxyLibraryId": payload.get("proxyLibraryId"),
                            "url": payload.get("url"),
                        },
                    )
                    return

                if action in ("tab.new", "tab.activate", "tab.close"):
                    pending_tab_controls.append(payload)
                    _event(
                        "scenario.record.control.tab",
                        {
                            "runId": run_id,
                            "action": action,
                            "tabId": payload.get("tabId"),
                        },
                    )
                    return

                if action == "browser.close":
                    pending_browser_close = True
                    _event(
                        "scenario.record.control.browser_close",
                        {
                            "runId": run_id,
                        },
                    )
                    return

        cmd = raw_cmd.lower()
        if cmd in ("pause", "resume", "continue", "stop", "abort", "cancel"):
            # Forward transport controls to the extension capture engine
            # regardless of the control source (command file, native overlay
            # binding, console fallback). Queued here, sent in the record loop.
            pending_bridge_controls.append(cmd)
        if cmd == "pause":
            paused = True
            _event("scenario.record.control.pause", {"runId": run_id})
            return
        if cmd == "resume":
            paused = False
            _event("scenario.record.control.resume", {"runId": run_id})
            return
        if cmd == "stop":
            keep_browser_open_after_save = True
            _event("scenario.record.control.stop", {"runId": run_id, "mode": "save_only"})
            stop_requested = True
            return
        if cmd in ("abort", "cancel"):
            keep_browser_open_after_save = False
            _event("scenario.record.control.stop", {"runId": run_id})
            stop_requested = True
            return

    async def resolve_runtime_proxy_from_payload(payload: dict[str, Any]) -> str | None:
        proxy_id = str(payload.get("proxyLibraryId") or "").strip()

        if proxy_id and proxy_id in runtime_proxy_map:
            return runtime_proxy_map.get(proxy_id)
        return None

    async def attach_console_listeners(ctx: Any) -> None:
        try:
            pages = [p for p in getattr(ctx, "pages", []) if p and not p.is_closed()]
        except Exception:
            pages = []
        for p in pages:
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
                continue

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

    # ── Stage-2 convergence: extension capture bridge (fallback-safe) ────────
    # CloakBrowser always loads the Stitch toolkit extension. If the extension
    # connects to this bridge, its richer content stack becomes the capture
    # source and the injected recorder is skipped. Otherwise (ShardBrowser,
    # broken/absent extension) the injected-script recorder stays in charge.
    capture_via_extension = False
    bridge_decided = False
    pending_bridge_controls: list[str] = []
    bridge: ExtensionBridgeHost | None = None
    bridge_started = False

    def _bridge_stop() -> None:
        nonlocal stop_requested
        stop_requested = True

    if _normalize_engine(args.engine) == "cloakbrowser":
        bridge = ExtensionBridgeHost(
            run_id=run_id,
            alias=args.alias,
            scenario_name=args.scenario_name,
            start_url=args.url,
            on_event=lambda payload: on_record(payload) if capture_via_extension else None,
            on_stopped=_bridge_stop,
            native_hosted=True,
        )
        bridge_started = await bridge.start()

    async def update_overlay(
        page: Any,
        *,
        status: str | None = None,
        reason: str | None = None,
        paused_flag: bool | None = None,
        count: int | None = None,
        saved_path: str | None = None,
        tabs_payload: dict[str, Any] | None = None,
        proxy_payload: dict[str, Any] | None = None,
    ) -> None:
        if not overlay_enabled:
            return
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
            if count is not None:
                await page.evaluate(
                    "(arg) => window.__stitchRecorderOverlaySetCount && window.__stitchRecorderOverlaySetCount(arg.count)",
                    {"count": int(max(0, count))},
                )
            if saved_path is not None:
                await page.evaluate(
                    "(arg) => window.__stitchRecorderOverlaySetSaved && window.__stitchRecorderOverlaySetSaved(arg.path)",
                    {"path": saved_path},
                )
            if tabs_payload is not None:
                await page.evaluate(
                    "(arg) => window.__stitchRecorderOverlaySetTabs && window.__stitchRecorderOverlaySetTabs(arg)",
                    tabs_payload,
                )
            if proxy_payload is not None:
                await page.evaluate(
                    "(arg) => window.__stitchRecorderOverlaySetProxy && window.__stitchRecorderOverlaySetProxy(arg)",
                    proxy_payload,
                )
        except Exception:
            pass

    async def update_overlay_all(
        ctx: Any,
        *,
        status: str | None = None,
        reason: str | None = None,
        paused_flag: bool | None = None,
        count: int | None = None,
        saved_path: str | None = None,
        tabs_payload: dict[str, Any] | None = None,
        proxy_payload: dict[str, Any] | None = None,
    ) -> None:
        if not overlay_enabled:
            return
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
                count=count,
                saved_path=saved_path,
                tabs_payload=tabs_payload,
                proxy_payload=proxy_payload,
            )

    def _page_id(p: Any) -> str:
        try:
            return str(id(p))
        except Exception:
            return ""

    def _tab_title(url: str) -> str:
        try:
            parsed = urlsplit(url)
            host = (parsed.hostname or "").strip()
            if host:
                return host
        except Exception:
            pass
        return "tab"

    def _tab_favicon(url: str) -> str:
        try:
            parsed = urlsplit(url)
            if parsed.scheme in ("http", "https") and parsed.netloc:
                return f"{parsed.scheme}://{parsed.netloc}/favicon.ico"
        except Exception:
            pass
        return ""

    def build_tabs_payload(ctx: Any) -> dict[str, Any]:
        nonlocal active_page_id
        try:
            pages = [p for p in getattr(ctx, "pages", []) if p and not p.is_closed()]
        except Exception:
            pages = []

        tabs: list[dict[str, str]] = []
        active_exists = False
        seen_blank = False
        kept_blank_id: str | None = None
        active_blank_skipped = False

        for p in pages:
            pid = _page_id(p)
            if not pid:
                continue
            try:
                url = str(p.url or "")
            except Exception:
                url = ""

            is_blank = url.strip().lower() == "about:blank"
            if is_blank and seen_blank:
                if active_page_id and pid == active_page_id:
                    active_blank_skipped = True
                continue

            if is_blank:
                seen_blank = True
                kept_blank_id = pid

            tabs.append(
                {
                    "id": pid,
                    "title": _tab_title(url),
                    "url": url,
                    "favicon": _tab_favicon(url),
                }
            )
            if active_page_id and pid == active_page_id:
                active_exists = True

        if not active_exists and active_blank_skipped and kept_blank_id:
            active_page_id = kept_blank_id
            active_exists = True

        if not active_exists:
            active_page_id = tabs[0]["id"] if tabs else None

        return {
            "tabs": tabs,
            "activeTabId": active_page_id,
        }

    async def update_tabs_overlay(ctx: Any) -> None:
        await update_overlay_all(ctx, tabs_payload=build_tabs_payload(ctx))

    async def apply_pending_tab_controls(ctx: Any) -> None:
        nonlocal pending_tab_controls, page, active_page_id

        if not pending_tab_controls:
            return

        queue = list(pending_tab_controls)
        pending_tab_controls = []

        for payload in queue:
            action = str(payload.get("action") or "").strip().lower()
            tab_id = str(payload.get("tabId") or "").strip()

            try:
                pages = [p for p in getattr(ctx, "pages", []) if p and not p.is_closed()]
            except Exception:
                pages = []

            if action == "tab.new":
                try:
                    new_page = await ctx.new_page()
                    try:
                        await new_page.goto("about:blank", wait_until="domcontentloaded")
                    except Exception:
                        pass
                    page = new_page
                    active_page_id = _page_id(new_page) or active_page_id
                except Exception:
                    continue

            elif action == "tab.activate" and tab_id:
                target = None
                for p in pages:
                    if _page_id(p) == tab_id:
                        target = p
                        break
                if target is not None:
                    try:
                        await target.bring_to_front()
                    except Exception:
                        pass
                    page = target
                    active_page_id = tab_id

            elif action == "tab.close" and tab_id:
                target = None
                for p in pages:
                    if _page_id(p) == tab_id:
                        target = p
                        break
                if target is not None:
                    try:
                        await target.close()
                    except Exception:
                        pass
                    try:
                        remaining = [
                            p for p in getattr(ctx, "pages", []) if p and not p.is_closed()
                        ]
                    except Exception:
                        remaining = []
                    if remaining:
                        if active_page_id == tab_id:
                            page = remaining[0]
                            active_page_id = _page_id(page)
                    else:
                        # Keep recording session alive with at least one tab.
                        try:
                            replacement = await ctx.new_page()
                            try:
                                await replacement.goto("about:blank", wait_until="domcontentloaded")
                            except Exception:
                                pass
                            page = replacement
                            active_page_id = _page_id(replacement)
                        except Exception:
                            pass

        await ensure_recorder_installed(ctx, include_recorder=not capture_via_extension)
        await attach_console_listeners(ctx)
        await update_tabs_overlay(ctx)

    last_len = 0
    last_save_ts = 0.0

    context_scripts_installed = False
    context_bindings_installed = False

    async def _install_context_scripts(ctx: Any, *, include_recorder: bool) -> None:
        nonlocal context_scripts_installed
        if context_scripts_installed:
            return
        try:
            if include_recorder:
                await ctx.add_init_script(RECORDER_INIT_SCRIPT)
            if overlay_enabled:
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

    async def install_recorder_on_page(page: Page, *, include_recorder: bool = True) -> None:
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
            if include_recorder:
                await page.add_init_script(RECORDER_INIT_SCRIPT)
            if overlay_enabled:
                await page.add_init_script(RECORDER_OVERLAY_SCRIPT)
        except Exception:
            pass

        # Install into the currently loaded document so recording works immediately.
        if include_recorder:
            try:
                await page.evaluate(RECORDER_INIT_SCRIPT)
            except Exception:
                pass
        if overlay_enabled:
            try:
                await page.evaluate(RECORDER_OVERLAY_SCRIPT)
            except Exception:
                pass
            try:
                await page.evaluate(
                    "(catalog) => { window.__stitchRecorderRuntimeProxyCatalog = catalog; }",
                    runtime_proxy_catalog,
                )
                await page.evaluate(
                    "(proxyMap) => { window.__stitchRecorderRuntimeProxyMap = proxyMap; }",
                    runtime_proxy_map,
                )
                await page.evaluate(
                    "(payload) => { window.__stitchRecorderActiveProxyId = payload.proxyLibraryId || ''; window.__stitchRecorderActiveProxyLabel = payload.label || ''; }",
                    _build_active_proxy_payload(active_proxy_library_id, active_proxy_url),
                )
                await page.evaluate(RECORDER_OVERLAY_SCRIPT)
            except Exception:
                pass

    async def ensure_recorder_installed(ctx: Any, *, include_recorder: bool = True) -> None:
        # Make overlay resilient across navigations and new tabs.
        # include_recorder=False (extension capture): bindings + overlay HUD only —
        # the injected recorder would double-capture next to the extension.
        await _install_context_bindings(ctx)
        await _install_context_scripts(ctx, include_recorder=include_recorder)
        try:
            pages = [p for p in getattr(ctx, "pages", []) if p and not p.is_closed()]
        except Exception:
            pages = []
        for p in pages:
            try:
                await install_recorder_on_page(p, include_recorder=include_recorder)
            except Exception:
                continue

    def export_snapshot() -> None:
        # Best-effort autosave snapshot (safe on kill/cancel)
        try:
            nonlocal last_len, last_save_ts
            # avoid excessive disk writes
            if len(steps) == last_len and (time.time() - last_save_ts) < 2.0:
                return
            scenario = build_scenario_container(
                name=args.scenario_name,
                run_id=run_id,
                alias=args.alias,
                started_url=args.url,
                steps=[
                    {
                        "kind": s.kind,
                        "ts": s.ts,
                        "url": s.url,
                        "selector": s.selector,
                        "value": s.value,
                        "meta": s.meta,
                        "frameSrc": s.frameSrc,
                    }
                    for s in steps
                ],
            )
            write_scenario(scenario_path, scenario)
            last_len = len(steps)
            last_save_ts = time.time()
        except Exception:
            return

    _log("info", f"Starting recorder: {args.scenario_name}", step="init")
    # Log versions for debugging
    import platform
    _log("info", f"Python {platform.python_version()} on {platform.system()}", step="init")
    try:
        import playwright
        _log("info", f"Playwright {playwright.__version__}", step="init")
        # Check if browsers are installed
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                browser_path = p.chromium.executable_path
                _log("info", f"Chromium browser path: {browser_path}", step="init")
                if not browser_path or not Path(browser_path).exists():
                    _log("error", "Chromium browser not found! Run: playwright install chromium", step="init")
                    sys.stderr.write("ERROR: Chromium browser not found! Run: playwright install chromium\n")
                    _result(False, error={"code": "browser_not_installed", "message": "Chromium not found. Run: playwright install chromium"})
                    return 1
        except Exception as browser_err:
            _log("warn", f"Could not check browser path: {browser_err}", step="init")
    except Exception:
        pass
    _log("info", f"Starting recording: alias={args.alias}, url={args.url}, headless={args.headless}", step="init")

    _event("scenario.record.started", {"runId": run_id, "alias": args.alias})

    launcher: Any | None = None
    page: Any | None = None
    ctx: Any | None = None

    async def start_recording_session(url: str, proxy_url: str | None) -> tuple[Any, Any, Any]:
        nonlocal \
            context_bindings_installed, \
            context_scripts_installed, \
            active_page_id, \
            active_proxy_library_id
        if bridge is not None and bridge.started:
            # The extension says hello during browser launch, before the
            # start URL loads; hold start_record until the page is ready.
            bridge.disarm()
        try:
            _log("info", f"Creating ProfileLauncher with profile_id={args.alias}, headless={args.headless}, proxy={'yes' if proxy_url else 'no'}", step="init")
            local_launcher = ProfileLauncher(
                profile_id=args.alias,
                headless=bool(args.headless),
                proxy=proxy_url or None,
                config=config,
                engine=args.engine,
            )
            _log("info", "ProfileLauncher created successfully", step="init")
        except Exception as e:
            import traceback
            _log("error", f"Failed to create ProfileLauncher: {e}", step="init")
            sys.stderr.write(f"PROFILE LAUNCHER ERROR: {e}\n")
            sys.stderr.write(traceback.format_exc())
            sys.stderr.flush()
            raise
        try:
            local_page = await local_launcher.open(url, wait_until="domcontentloaded")
            local_ctx = local_page.context
        except Exception as e:
            import traceback
            _log("error", f"Failed to open browser page: {e}", step="init")
            sys.stderr.write(f"BROWSER OPEN ERROR: {e}\n")
            sys.stderr.write(traceback.format_exc())
            sys.stderr.flush()
            raise

        context_bindings_installed = False
        context_scripts_installed = False
        nonlocal capture_via_extension, bridge_decided
        if bridge_started and not bridge_decided:
            # The extension service worker starts with the browser; give it a
            # short grace window to attach before falling back to injection.
            bridge_decided = True
            capture_via_extension = await bridge.wait_client(timeout_s=5.0)
            if not capture_via_extension and bridge is not None:
                # Fallback chosen: refuse late extension clients so a rogue
                # extension HUD session never starts next to the injected
                # recorder (which would double-capture).
                bridge.stop_accepting()
            _event(
                "scenario.record.capture_mode",
                {
                    "runId": run_id,
                    "mode": "extension" if capture_via_extension else "injected",
                },
            )
        if capture_via_extension:
            # Extension content stack captures; the native overlay HUD keeps
            # orchestration (tabs, proxy.switch, manual, close). Install
            # bindings + overlay WITHOUT the injected recorder to avoid
            # double-capture.
            await ensure_recorder_installed(local_ctx, include_recorder=False)
            await attach_console_listeners(local_ctx)
            if bridge is not None:
                # Page is loaded: release queued hellos → start_record.
                await bridge.arm()
        else:
            await ensure_recorder_installed(local_ctx)
            await attach_console_listeners(local_ctx)
        await update_overlay_all(
            local_ctx,
            status="Recording",
            reason="",
            paused_flag=False,
            count=len(steps),
            proxy_payload=_build_active_proxy_payload(active_proxy_library_id, proxy_url),
        )
        active_page_id = _page_id(local_page) or active_page_id
        await update_tabs_overlay(local_ctx)
        return local_launcher, local_page, local_ctx

    def _safe_current_url(default_url: str) -> str:
        try:
            if page is not None and not page.is_closed():
                candidate = str(page.url or "").strip()
                if candidate:
                    return candidate
        except Exception:
            pass
        return default_url

    async def recover_recording_context(reason: str) -> bool:
        """Best-effort recovery when pages/context disappear during recording."""

        nonlocal launcher, page, ctx, active_page_id

        _event(
            "scenario.record.recover.started",
            {
                "runId": run_id,
                "reason": reason,
            },
        )

        # Fast path: if context still exists, create a replacement page.
        try:
            if ctx is not None:
                replacement = await ctx.new_page()
                try:
                    await replacement.goto("about:blank", wait_until="domcontentloaded")
                except Exception:
                    pass
                page = replacement
                active_page_id = _page_id(replacement) or active_page_id
                await ensure_recorder_installed(ctx, include_recorder=not capture_via_extension)
                await attach_console_listeners(ctx)
                await update_overlay_all(
                    ctx,
                    status="Recording",
                    reason="Recovered after tab close",
                    paused_flag=False,
                    count=len(steps),
                )
                await update_tabs_overlay(ctx)
                _event(
                    "scenario.record.recover.done",
                    {
                        "runId": run_id,
                        "reason": reason,
                        "mode": "new_page",
                    },
                )
                return True
        except Exception:
            pass

        # Fallback: restart browser session and continue recording with current steps.
        restart_url = _safe_current_url(args.url)
        try:
            await close_recording_session()
            launcher, page, ctx = await start_recording_session(restart_url, active_proxy_url)
            active_page_id = _page_id(page) if page is not None else active_page_id
            await update_overlay_all(
                ctx,
                status="Recording",
                reason="Recovered after browser close",
                paused_flag=False,
                count=len(steps),
            )
            await update_tabs_overlay(ctx)
            _event(
                "scenario.record.recover.done",
                {
                    "runId": run_id,
                    "reason": reason,
                    "mode": "session_restart",
                    "url": restart_url,
                },
            )
            return True
        except Exception as e:
            _event(
                "scenario.record.recover.failed",
                {
                    "runId": run_id,
                    "reason": reason,
                    "error": str(e),
                },
            )
            return False

    async def close_recording_session() -> None:
        nonlocal launcher, page, ctx
        if launcher is not None:
            try:
                await launcher.close()
            except Exception:
                pass
        launcher = None
        page = None
        ctx = None

    try:
        launcher, page, ctx = await start_recording_session(args.url, active_proxy_url)

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
            if capture_via_extension and bridge is not None and pending_bridge_controls:
                for ctrl in pending_bridge_controls:
                    await bridge.send({"type": "control", "payload": {"command": ctrl}})
                pending_bridge_controls.clear()
            export_snapshot()
            if pending_proxy_restart is not None:
                restart_payload = pending_proxy_restart
                pending_proxy_restart = None

                next_proxy = await resolve_runtime_proxy_from_payload(restart_payload)
                if not next_proxy:
                    await update_overlay_all(
                        ctx,
                        status="Recording",
                        reason="Invalid proxy for restart",
                        paused_flag=False,
                        count=len(steps),
                    )
                    _event(
                        "scenario.record.proxy_restart.failed",
                        {
                            "runId": run_id,
                            "reason": "invalid_proxy",
                            "proxyLibraryId": restart_payload.get("proxyLibraryId"),
                        },
                    )
                    continue

                try:
                    current_url = str(page.url or args.url) if page is not None else args.url
                except Exception:
                    current_url = args.url

                _event(
                    "scenario.record.proxy_restart.started",
                    {
                        "runId": run_id,
                        "proxyLibraryId": restart_payload.get("proxyLibraryId"),
                        "url": current_url,
                    },
                )
                await close_recording_session()
                active_proxy_library_id = (
                    str(restart_payload.get("proxyLibraryId") or "").strip() or None
                )
                active_proxy_url = next_proxy
                launcher, page, ctx = await start_recording_session(current_url, active_proxy_url)
                active_page_id = _page_id(page) if page is not None else active_page_id
                await update_overlay_all(
                    ctx,
                    status="Recording",
                    reason="Proxy switched (restart)",
                    paused_flag=False,
                    count=len(steps),
                    proxy_payload=_build_active_proxy_payload(
                        active_proxy_library_id, active_proxy_url
                    ),
                )
                await update_tabs_overlay(ctx)
                _event(
                    "scenario.record.proxy_restart.done",
                    {
                        "runId": run_id,
                        "proxyLibraryId": restart_payload.get("proxyLibraryId"),
                    },
                )

            if pending_browser_close:
                pending_browser_close = False
                await close_recording_session()
                _event(
                    "scenario.record.browser.closed",
                    {
                        "runId": run_id,
                    },
                )
                break

            await apply_pending_tab_controls(ctx)

            try:
                await ensure_recorder_installed(ctx, include_recorder=not capture_via_extension)
                # Ensure console listeners attached to any new pages
                await attach_console_listeners(ctx)
            except Exception:
                recovered = await recover_recording_context("context_unavailable")
                if not recovered:
                    _log(
                        "warn",
                        "Recorder context unavailable and recovery failed - stopping record",
                        step="record",
                    )
                    break
                continue

            await update_tabs_overlay(ctx)

            if paused:
                await update_overlay_all(
                    ctx,
                    status="Paused",
                    reason="Operator pause",
                    paused_flag=True,
                    count=len(steps),
                )
            else:
                await update_overlay_all(
                    ctx,
                    status="Recording",
                    reason="",
                    paused_flag=False,
                    count=len(steps),
                )
            if stop_requested:
                _log("info", "Stop requested from browser overlay", step="record")
                break
            try:
                live_pages = [p for p in getattr(ctx, "pages", []) if p and not p.is_closed()]
            except Exception:
                live_pages = []
            if not live_pages:
                recovered = await recover_recording_context("all_pages_closed")
                if not recovered:
                    _log(
                        "warn",
                        "All pages closed and recovery failed - stopping record",
                        step="record",
                    )
                    break
                continue

        await update_overlay_all(
            ctx, status="Saving", reason="", paused_flag=False, count=len(steps)
        )
        if capture_via_extension and bridge is not None:
            await bridge.send({"type": "stop_record", "payload": {"runId": run_id}})
    except Exception as e:
        import traceback
        error_msg = str(e)
        error_traceback = traceback.format_exc()
        _log("error", f"Recording failed: {error_msg}", step="record")
        sys.stderr.write(f"RECORDING ERROR: {error_msg}\n")
        sys.stderr.write(error_traceback)
        sys.stderr.flush()
        await close_recording_session()
        if bridge is not None:
            await bridge.close()
        _result(False, error={"code": "record_failed", "message": error_msg, "traceback": error_traceback})
        return 1

    if not keep_browser_open_after_save:
        await close_recording_session()

    export_snapshot()

    try:
        if ctx is not None:
            await update_overlay_all(
                ctx,
                status="Saved",
                reason="Scenario saved",
                paused_flag=True,
                count=len(steps),
                saved_path=str(scenario_path),
            )
    except Exception:
        pass

    _event("scenario.record.saved", {"path": str(scenario_path), "steps": len(steps)})
    if bridge is not None:
        await bridge.close()
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
