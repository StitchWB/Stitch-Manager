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
from urllib.parse import urlsplit
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
    if (isOverlayEvent(el)) return;

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
      collapsed: false,
      count: Number(window.__stitchRecorderStepCount || 0),
      savedPath: '',
      tabs: [],
      activeTabId: null,
      activeProxyId: (window.__stitchRecorderActiveProxyId || '').toString(),
      activeProxyLabel: (window.__stitchRecorderActiveProxyLabel || '').toString(),
    };
  }

  const state = window.__stitchRecorderOverlayState;
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
    if (input && !input.value && selectedId) {
      input.value = selectedId;
    }
  };

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
            proxyLibraryId: id || null,
            hasDirectProxy: false,
          },
        };

        // Primary secure channel: Playwright binding (avoids sensitive console logs)
        if (typeof window.__stitchRecordEvent === 'function') {
          window.__stitchRecordEvent(payload);
        } else {
          console.info('__STITCH_REC_STEP__' + JSON.stringify(payload));
        }
      } catch {}
    };

    const requestProxyRestart = (proxyLibraryId) => {
      try {
        const payload = {
          action: 'proxy.restart',
          proxyLibraryId: (proxyLibraryId || '').toString().trim() || null,
          url: location.href,
        };
        sendControl(JSON.stringify(payload));
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

    const topRow = document.createElement('div');
    topRow.style.display = 'flex';
    topRow.style.alignItems = 'center';
    topRow.style.justifyContent = 'space-between';
    topRow.style.marginBottom = '6px';

    const topActions = document.createElement('div');
    topActions.style.display = 'flex';
    topActions.style.gap = '6px';

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

    const collapseBtn = mkBtn(state.collapsed ? 'Expand' : 'Collapse', '#1e293b');
    collapseBtn.id = '__stitch-recorder-collapse';

    const compact = document.createElement('div');
    compact.id = '__stitch-recorder-compact';
    compact.style.display = 'none';
    compact.style.opacity = '0.9';
    compact.style.fontSize = '11px';
    compact.style.fontWeight = '600';
    compact.style.marginTop = '2px';

    const body = document.createElement('div');
    body.id = '__stitch-recorder-body';

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

    const tabsBlock = document.createElement('div');
    tabsBlock.id = '__stitch-recorder-tabs';
    tabsBlock.style.marginBottom = '8px';

    const tabsHeader = document.createElement('div');
    tabsHeader.textContent = 'Tabs';
    tabsHeader.style.opacity = '0.85';
    tabsHeader.style.marginBottom = '4px';

    const tabsList = document.createElement('div');
    tabsList.id = '__stitch-recorder-tabs-list';
    tabsList.style.display = 'flex';
    tabsList.style.flexDirection = 'column';
    tabsList.style.gap = '4px';

    tabsBlock.appendChild(tabsHeader);
    tabsBlock.appendChild(tabsList);

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '6px';

    const utilityRow = document.createElement('div');
    utilityRow.style.display = 'flex';
    utilityRow.style.gap = '6px';
    utilityRow.style.marginTop = '8px';

    const proxyRow = document.createElement('div');
    proxyRow.style.display = 'grid';
    proxyRow.style.gridTemplateColumns = '1fr auto auto';
    proxyRow.style.gap = '6px';
    proxyRow.style.marginBottom = '8px';

    const proxyInput = document.createElement('input');
    proxyInput.type = 'text';
    proxyInput.id = '__stitch-recorder-proxy-input';
    proxyInput.placeholder = 'proxyLibraryId';
    proxyInput.style.background = 'rgba(2,6,23,0.45)';
    proxyInput.style.border = '1px solid rgba(148,163,184,0.25)';
    proxyInput.style.color = '#e2e8f0';
    proxyInput.style.borderRadius = '7px';
    proxyInput.style.padding = '6px 8px';
    proxyInput.style.fontSize = '12px';

    const proxyPicker = document.createElement('select');
    proxyPicker.id = '__stitch-recorder-proxy-picker';
    proxyPicker.style.background = 'rgba(2,6,23,0.45)';
    proxyPicker.style.border = '1px solid rgba(148,163,184,0.25)';
    proxyPicker.style.color = '#e2e8f0';
    proxyPicker.style.borderRadius = '7px';
    proxyPicker.style.padding = '6px 8px';
    proxyPicker.style.fontSize = '12px';
    proxyPicker.style.marginBottom = '8px';

    syncProxyPicker(proxyPicker, proxyInput);

    proxyPicker.onchange = () => {
      const id = (proxyPicker.value || '').trim();
      if (!id) return;
      proxyInput.value = id;
    };

    const initialProxyId = (state.activeProxyId || '').toString().trim();
    if (initialProxyId && !proxyInput.value) {
      proxyInput.value = initialProxyId;
    }

    const proxyRecordBtn = mkBtn('Record Step', '#0f766e');
    const proxyApplyBtn = mkBtn('Apply&Continue', '#1d4ed8');

    const splitProxyInput = () => {
      const raw = (proxyInput.value || '').trim();
      if (!raw) return null;
      return { proxyId: raw };
    };

    proxyRecordBtn.onclick = () => {
      const data = splitProxyInput();
      if (!data) return;
      const { proxyId } = data;
      emitProxySwitch(proxyId);
      state.reason = proxyId ? `Proxy switched (${proxyId})` : 'Proxy switch recorded';
      ensureOverlayAttached();
    };

    proxyApplyBtn.onclick = () => {
      const data = splitProxyInput();
      if (!data) return;
      const { proxyId } = data;
      emitProxySwitch(proxyId);
      requestProxyRestart(proxyId);
      state.status = 'Restarting...';
      state.reason = proxyId ? `Restarting with ${proxyId}` : 'Restarting with proxy';
      ensureOverlayAttached();
    };

    proxyRow.appendChild(proxyInput);
    proxyRow.appendChild(proxyRecordBtn);
    proxyRow.appendChild(proxyApplyBtn);

    const pauseBtn = mkBtn('Pause', '#334155');
    pauseBtn.id = '__stitch-recorder-pause';
    const stopBtn = mkBtn('Finish & Save', '#7f1d1d');
    const closeBrowserBtn = mkBtn('Close Browser', '#7c3aed');
    const newTabBtn = mkBtn('New tab', '#475569');

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

    closeBrowserBtn.onclick = () => {
      state.status = 'Closing browser...';
      state.reason = 'Operator requested browser close';
      renderOverlay();
      try {
        sendControl(JSON.stringify({ action: 'browser.close' }));
      } catch {}
    };

    newTabBtn.onclick = () => {
      try {
        sendControl(JSON.stringify({ action: 'tab.new' }));
      } catch {}
    };

    collapseBtn.onclick = () => {
      state.collapsed = !state.collapsed;
      renderOverlay();
    };

    row.appendChild(pauseBtn);
    row.appendChild(stopBtn);
    row.appendChild(closeBrowserBtn);

    utilityRow.appendChild(newTabBtn);

    topActions.appendChild(collapseBtn);
    topRow.appendChild(title);
    topRow.appendChild(topActions);

    body.appendChild(status);
    body.appendChild(count);
    body.appendChild(reason);
    body.appendChild(pausedFor);
    body.appendChild(tabsBlock);
    body.appendChild(proxyPicker);
    body.appendChild(proxyRow);
    body.appendChild(row);
    body.appendChild(utilityRow);

    box.appendChild(topRow);
    box.appendChild(compact);
    box.appendChild(body);

    (document.body || document.documentElement).appendChild(box);
    return box;
  };

  const renderOverlay = () => {
    const box = makeOverlay();
    const status = box.querySelector('#__stitch-recorder-status');
    const count = box.querySelector('#__stitch-recorder-count');
    const reason = box.querySelector('#__stitch-recorder-reason');
    const pausedFor = box.querySelector('#__stitch-recorder-paused');
    const tabsList = box.querySelector('#__stitch-recorder-tabs-list');
    const pauseBtn = box.querySelector('#__stitch-recorder-pause');
    const collapseBtn = box.querySelector('#__stitch-recorder-collapse');
    const compact = box.querySelector('#__stitch-recorder-compact');
    const body = box.querySelector('#__stitch-recorder-body');
    const proxyPicker = box.querySelector('#__stitch-recorder-proxy-picker');
    const proxyInput = box.querySelector('#__stitch-recorder-proxy-input');

    syncProxyPicker(proxyPicker, proxyInput);

    if (status) status.textContent = `Status: ${state.status || 'Recording'}`;
    if (count) count.textContent = `Steps: ${Number.isFinite(Number(state.count)) ? Number(state.count) : 0}`;
    if (reason) reason.textContent = `Reason: ${(state.reason || '-').toString()}`;

    const currentProxyId = (state.activeProxyId || '').toString().trim();
    const currentProxyLabel = (state.activeProxyLabel || '').toString().trim();
    if (!state.reason || state.reason === '-') {
      if (currentProxyId || currentProxyLabel) {
        state.reason = currentProxyLabel
          ? `Proxy: ${currentProxyLabel}`
          : `Proxy: ${currentProxyId}`;
        if (reason) reason.textContent = `Reason: ${state.reason}`;
      }
    }

    if (pauseBtn) {
      pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
    }

    if (collapseBtn) {
      collapseBtn.textContent = state.collapsed ? 'Expand' : 'Collapse';
    }

    if (compact) {
      compact.textContent = `${state.paused ? 'PAUSED' : 'REC'} • ${Number.isFinite(Number(state.count)) ? Number(state.count) : 0}`;
      compact.style.display = state.collapsed ? 'block' : 'none';
    }

    if (body) {
      body.style.display = state.collapsed ? 'none' : 'block';
    }

    box.style.minWidth = state.collapsed ? '140px' : '220px';

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

    if (tabsList) {
      while (tabsList.firstChild) tabsList.removeChild(tabsList.firstChild);
      const tabs = Array.isArray(state.tabs) ? state.tabs : [];
      const activeTabId = (state.activeTabId || '').toString();

      if (!tabs.length) {
        const empty = document.createElement('div');
        empty.textContent = 'No tabs';
        empty.style.opacity = '0.7';
        tabsList.appendChild(empty);
      } else {
        let tabIdx = 0;
        for (const tab of tabs) {
          const tabId = (tab && tab.id != null ? String(tab.id) : '').trim();
          if (!tabId) continue;
          tabIdx += 1;

          const row = document.createElement('div');
          row.style.display = 'grid';
          row.style.gridTemplateColumns = '1fr auto';
          row.style.gap = '6px';
          row.style.alignItems = 'center';

          const activate = document.createElement('button');
          activate.type = 'button';
          activate.textContent = (tab.title || tab.url || 'tab').toString().slice(0, 42);
          activate.style.padding = '4px 6px';
          activate.style.textAlign = 'left';
          activate.style.borderRadius = '6px';
          activate.style.border = '1px solid rgba(148,163,184,0.25)';
          const isActive = tabId === activeTabId;
          activate.style.background = isActive ? 'rgba(29,78,216,0.35)' : 'rgba(2,6,23,0.45)';
          activate.style.color = '#e2e8f0';
          activate.style.cursor = 'pointer';
          activate.style.fontSize = '11px';
          activate.title = (tab.url || '').toString();

          const content = document.createElement('span');
          content.style.display = 'inline-flex';
          content.style.alignItems = 'center';
          content.style.gap = '6px';

          const indexBadge = document.createElement('span');
          indexBadge.textContent = String(tabIdx);
          indexBadge.style.opacity = '0.75';
          indexBadge.style.minWidth = '12px';
          indexBadge.style.fontVariantNumeric = 'tabular-nums';

          const faviconUrl = (tab.favicon || '').toString().trim();
          let iconEl = null;
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
              try {
                img.remove();
              } catch {}
            };
            iconEl = img;
          }

          const label = document.createElement('span');
          label.textContent = (tab.title || tab.url || 'tab').toString().slice(0, 42);

          content.appendChild(indexBadge);
          if (iconEl) content.appendChild(iconEl);
          content.appendChild(label);
          activate.textContent = '';
          activate.appendChild(content);

          activate.onclick = () => {
            try {
              sendControl(JSON.stringify({ action: 'tab.activate', tabId }));
            } catch {}
          };

          const close = document.createElement('button');
          close.type = 'button';
          close.textContent = '×';
          close.style.padding = '4px 8px';
          close.style.borderRadius = '6px';
          close.style.border = '1px solid rgba(148,163,184,0.25)';
          close.style.background = 'rgba(127,29,29,0.7)';
          close.style.color = '#fff';
          close.style.cursor = 'pointer';
          close.style.fontSize = '11px';
          close.onclick = () => {
            try {
              sendControl(JSON.stringify({ action: 'tab.close', tabId }));
            } catch {}
          };

          row.appendChild(activate);
          row.appendChild(close);
          tabsList.appendChild(row);
        }
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
    p.add_argument(
        "--no-overlay",
        action="store_true",
        help="Disable in-browser recorder overlay UI (recording stays active)",
    )
    return p.parse_args()


async def main_async() -> int:
    args = _parse_args()
    overlay_enabled = not bool(args.no_overlay)

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

        await ensure_recorder_installed(ctx)
        await attach_console_listeners(ctx)
        await update_tabs_overlay(ctx)

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
            if overlay_enabled:
                await page.add_init_script(RECORDER_OVERLAY_SCRIPT)
        except Exception:
            pass

        # Install into the currently loaded document so recording works immediately.
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

    launcher: Any | None = None
    page: Any | None = None
    ctx: Any | None = None

    async def start_recording_session(url: str, proxy_url: str | None) -> tuple[Any, Any, Any]:
        nonlocal \
            context_bindings_installed, \
            context_scripts_installed, \
            active_page_id, \
            active_proxy_library_id
        local_launcher = ProfileLauncher(
            profile_id=args.alias,
            headless=bool(args.headless),
            proxy=proxy_url or None,
            config=config,
        )
        local_page = await local_launcher.open(url, wait_until="domcontentloaded")
        local_ctx = local_page.context

        context_bindings_installed = False
        context_scripts_installed = False
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
                await ensure_recorder_installed(ctx)
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
                await ensure_recorder_installed(ctx)
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
    except Exception as e:
        await close_recording_session()
        _result(False, error={"code": "record_failed", "message": str(e)})
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
