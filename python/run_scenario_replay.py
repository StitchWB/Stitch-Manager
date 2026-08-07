#!/usr/bin/env python3
"""Scenario Replay Runner (MVP)

Replays a previously recorded scenario JSON against a CloakBrowser persistent profile.

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
import os
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

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


class ReplayAbort(Exception):  # noqa: N818 — established control-flow name
    pass


_SHARED_OVERLAY_RUNTIME_PATH = (
    PYTHON_ROOT.parent / "extension" / "stitch-scenario-runner" / "overlay_runtime.js"
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
      if (!host.shadowRoot) {
        host.attachShadow({ mode: 'open' });
      }
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


_REPLAY_OVERLAY_BOOTSTRAP = r"""
(() => {
  try {
    if (window.top !== window.self) return;
  } catch {
    return;
  }

  if (window.__stitchReplayOverlayInstalled) return;
  window.__stitchReplayOverlayInstalled = true;

  if (!window.__stitchReplayOverlayState) {
    window.__stitchReplayOverlayState = {
      collapsed: false,
      paused: false,
      pausedSince: null,
      stepCurrent: 0,
      stepTotal: 0,
      status: 'Running',
      reason: '-',
    };
  }
  const state = window.__stitchReplayOverlayState;
  const runtime = window.StitchOverlayRuntime;
  if (!runtime || typeof runtime.createOverlayShell !== 'function') return;

  const shell = runtime.createOverlayShell({
    hostId: '__stitch-replay-overlay-host',
    position: 'bottom-right',
    offsetX: 16,
    offsetY: 16,
    markerAttr: 'data-stitch-replay-overlay',
    title: 'Replay',
    status: 'Running',
    mainText: 'Step: -/-',
    reasonText: 'Reason: -',
    pausedText: '',
    visible: true,
    collapsible: true,
    collapsed: Boolean(state.collapsed),
    onToggleCollapse: (collapsed) => {
      state.collapsed = Boolean(collapsed);
      render();
    },
  });
  if (!shell) return;

  const sendControl = (cmd) => {
    if (typeof window.__stitchReplayControl === 'function') {
      window.__stitchReplayControl(cmd);
    }
  };

  runtime.renderControls(
    shell,
    [
      { command: 'pause', label: state.paused ? 'Resume' : 'Pause' },
      { command: 'stop', label: 'Stop', variant: 'stop' },
    ],
    (command) => {
      if (command === 'pause') {
        state.paused = !state.paused;
        if (state.paused) {
          if (!state.pausedSince) state.pausedSince = Date.now();
          state.status = 'Paused';
          state.reason = 'Operator pause';
          sendControl('pause');
        } else {
          state.pausedSince = null;
          state.status = 'Running';
          state.reason = '-';
          sendControl('resume');
        }
        render();
        return;
      }
      if (command === 'stop') {
        state.status = 'Stopping...';
        state.paused = false;
        state.pausedSince = null;
        sendControl('stop');
        render();
      }
    }
  );

  const render = () => {
    if (shell.titleEl) shell.titleEl.textContent = 'Replay';
    if (shell.statusEl) shell.statusEl.textContent = `Status: ${state.status || 'Running'}`;

    const current = Number(state.stepCurrent || 0);
    const total = Number(state.stepTotal || 0);
    const progress = current && total ? `${current}/${total}` : '-/-';

    if (shell.mainEl) shell.mainEl.textContent = `Step: ${progress}`;
    if (shell.reasonEl) {
      shell.reasonEl.textContent = `Reason: ${String(state.reason || '-').trim() || '-'}`;
      shell.reasonEl.style.display = 'block';
    }

    if (shell.pausedEl) {
      if (state.paused && state.pausedSince) {
        const sec = Math.max(0, Math.floor((Date.now() - state.pausedSince) / 1000));
        shell.pausedEl.textContent = `Paused: ${sec}s`;
        shell.pausedEl.style.display = 'block';
      } else {
        shell.pausedEl.textContent = 'Paused: -';
        shell.pausedEl.style.display = 'none';
      }
    }

    if (shell.compactEl) {
      shell.compactEl.textContent = `${state.paused ? 'PAUSED' : 'RUN'} • ${progress}`;
    }

    runtime.setControlState(shell, 'pause', {
      label: state.paused ? 'Resume' : 'Pause',
    });
    shell.setCollapsed(Boolean(state.collapsed));
    shell.setVisible(true);
  };

  window.__stitchReplayOverlaySetStatus = (text) => {
    state.status = (text || 'Running').toString();
    render();
  };

  window.__stitchReplayOverlaySetStep = (current, total) => {
    state.stepCurrent = Number(current || 0);
    state.stepTotal = Number(total || 0);
    render();
  };

  window.__stitchReplayOverlaySetReason = (text) => {
    const v = (text || '').toString().trim();
    state.reason = v || '-';
    render();
  };

  window.__stitchReplayOverlaySetPaused = (flag) => {
    state.paused = Boolean(flag);
    if (state.paused) {
      if (!state.pausedSince) state.pausedSince = Date.now();
      if (!state.reason || state.reason === '-') state.reason = 'Operator pause';
    } else {
      state.pausedSince = null;
      if (state.reason === 'Operator pause') state.reason = '-';
    }
    render();
  };

  window.__stitchReplayOverlaySetSaved = (path) => {
    state.status = 'Saved';
    state.reason = path ? `Saved report ${path}` : 'Saved';
    state.paused = false;
    state.pausedSince = null;
    render();
  };

  setInterval(() => {
    if (!state.paused || !state.pausedSince) return;
    render();
  }, 1000);

  render();
})();
"""


REPLAY_OVERLAY_SCRIPT = _load_shared_overlay_runtime_script() + "\n" + _REPLAY_OVERLAY_BOOTSTRAP


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Replay a scenario in persistent browser profile")
    p.add_argument("--alias", required=True, help="Profile alias")
    p.add_argument("--scenario-path", required=True, help="Path to scenario.json")
    p.add_argument(
        "--from-step",
        type=int,
        default=1,
        help="Optional 1-based step index to start replay from",
    )
    p.add_argument("--start-url", default="", help="Optional start URL override")
    p.add_argument("--timeout-s", type=int, default=3600, help="Max replay duration")
    p.add_argument("--pause-timeout-s", type=int, default=1800, help="Timeout for manual pause")
    p.add_argument("--proxy", default="", help="Optional proxy URL")
    p.add_argument(
        "--engine",
        choices=["cloackbrowser"],
        default="cloackbrowser",
        help="Browser engine (default: cloackbrowser)",
    )
    p.add_argument(
        "--config-json",
        default="",
        help="Optional JSON object for ProfileLauncher config (locale/timezone/geo/launch_kwargs/etc)",
    )
    p.add_argument("--continue-on-error", action="store_true", help="Continue after step errors")
    p.add_argument("--headless", action="store_true", help="Run browser in headless mode")
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not launch a browser; only validate scenario + manual pause control flow",
    )
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


def _timeout_ms(step: dict[str, Any], default_ms: int) -> int:
    raw = step.get("timeoutMs")
    if isinstance(raw, int) and raw > 0:
        return raw
    if isinstance(raw, float) and raw > 0:
        return int(raw)
    return default_ms


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


def _sanitize_step(
    step: dict[str, Any], runtime_proxy_map: dict[str, str] | None = None
) -> tuple[dict[str, Any] | None, str | None]:
    """Sanitize one replay step for backward compatibility.

    Returns (sanitized_step_or_none, skip_reason_or_none).
    """
    kind = _step_kind(step)

    # Drop malformed navigation steps (legacy recorder bug: nav with null url).
    if kind in ("nav", "goto", "navigate"):
        url = step.get("url")
        if not isinstance(url, str) or not url.strip():
            return None, "nav step has no url"
        fixed = dict(step)
        fixed["kind"] = "goto"
        fixed["url"] = url.strip()
        return fixed, None

    # Normalize common aliases.
    if kind == "change":
        fixed = dict(step)
        fixed["kind"] = "fill"
        return fixed, None
    if kind == "submit":
        fixed = dict(step)
        fixed["kind"] = "press"
        if not isinstance(fixed.get("value"), str) or not str(fixed.get("value") or "").strip():
            fixed["value"] = "Enter"
        return fixed, None

    if kind in ("proxy.switch",):
        # Will be validated and normalized with runtime proxy map later.
        return dict(step), None

    if kind == "proxy.switch":
        fixed = dict(step)
        meta = fixed.get("meta") if isinstance(fixed.get("meta"), dict) else {}
        proxy_id = str(meta.get("proxyLibraryId") or "").strip() if isinstance(meta, dict) else ""

        resolved = None
        if proxy_id and runtime_proxy_map and proxy_id in runtime_proxy_map:
            resolved = runtime_proxy_map.get(proxy_id)
        if not resolved:
            # Direct per-step fallback: kept for compatibility.
            resolved = str(fixed.get("value") or "").strip() or None

        runtime_proxy = _parse_runtime_proxy_any(resolved)
        if not runtime_proxy:
            return None, "proxy.switch has no resolvable proxy"

        fixed["kind"] = "proxy.switch"
        fixed["value"] = None
        fixed_meta = dict(meta) if isinstance(meta, dict) else {}
        fixed_meta["runtimeProxy"] = runtime_proxy
        fixed_meta["runtimeProxyMasked"] = _mask_proxy_url(runtime_proxy)
        fixed["meta"] = fixed_meta
        return fixed, None

    return step, None


def _sanitize_steps(
    steps: list[dict[str, Any]],
    runtime_proxy_map: dict[str, str] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    sanitized: list[dict[str, Any]] = []
    dropped: list[dict[str, Any]] = []

    for idx, step in enumerate(steps, start=1):
        fixed, reason = _sanitize_step(step, runtime_proxy_map=runtime_proxy_map)
        if fixed is None:
            dropped.append({"index": idx, "reason": reason or "invalid step"})
            continue
        sanitized.append(fixed)

    return sanitized, dropped


_SENSITIVE_KEY_RE = re.compile(
    r'("(?:token|refresh_token|password|secret|cookie|authorization|session_data?)"\s*:\s*)"[^"]*"',
    flags=re.IGNORECASE,
)

_SENSITIVE_VALUE_RE = re.compile(
    r"\b(Bearer)\s+([A-Za-z0-9\-._~+/]+=*)",
    flags=re.IGNORECASE,
)


def _parse_runtime_proxy_any(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None

    if "://" in raw:
        try:
            parsed = urlsplit(raw)
            if parsed.hostname and parsed.port:
                scheme = (parsed.scheme or "http").strip().lower()
                host = parsed.hostname
                port = int(parsed.port)
                if parsed.username:
                    return f"{scheme}://{parsed.username}:{parsed.password or ''}@{host}:{port}"
                return f"{scheme}://{host}:{port}"
        except Exception:
            return None

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

    if len(parts) == 4 and parts[2]:
        username = parts[2]
        password = parts[3]
        return f"{scheme}://{username}:{password}@{host}:{port}"
    return f"{scheme}://{host}:{port}"


def _mask_proxy_url(value: str) -> str:
    try:
        if "@" in value and "://" in value:
            head, tail = value.split("://", 1)
            auth, host = tail.split("@", 1)
            if ":" in auth:
                user, _ = auth.split(":", 1)
                return f"{head}://{user}:***@{host}"
        return value
    except Exception:
        return "proxy://***"


def _redact_text(value: str) -> str:
    if not value:
        return value
    out = _SENSITIVE_KEY_RE.sub(r'\1"***"', value)
    out = _SENSITIVE_VALUE_RE.sub(r"\\1 ***", out)
    return out


def _sanitize_report(report: dict[str, Any]) -> dict[str, Any]:
    out = dict(report)
    if out.get("error"):
        out["error"] = _redact_text(str(out.get("error") or ""))

    failed_steps = out.get("failedSteps")
    if isinstance(failed_steps, list):
        sanitized: list[dict[str, Any]] = []
        for entry in failed_steps:
            if not isinstance(entry, dict):
                continue
            row = dict(entry)
            if row.get("error"):
                row["error"] = _redact_text(str(row.get("error") or ""))
            sanitized.append(row)
        out["failedSteps"] = sanitized
    return out


def _write_safe_report(path: Path, report: dict[str, Any]) -> None:
    safe = _sanitize_report(report)
    path.write_text(json.dumps(safe, ensure_ascii=False, indent=2), encoding="utf-8")


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
    page: Any | None,
    reason: str,
    step_index: int,
    total_steps: int,
    command_tail: CommandTail,
    command_file_path: str,
    timeout_s: int,
) -> None:
    if page is not None:
        try:
            await page.evaluate(
                "window.__stitchReplayOverlaySetStatus && window.__stitchReplayOverlaySetStatus('Manual pause')"
            )
        except Exception:
            pass

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
                if page is not None:
                    try:
                        await page.evaluate(
                            "window.__stitchReplayOverlaySetStatus && window.__stitchReplayOverlaySetStatus('Running')"
                        )
                    except Exception:
                        pass
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
                if page is not None:
                    try:
                        await page.evaluate(
                            "window.__stitchReplayOverlaySetStatus && window.__stitchReplayOverlaySetStatus('Stopping')"
                        )
                    except Exception:
                        pass
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
        html.write_text(_redact_text(content), encoding="utf-8")
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
        try:
            await page.locator(selector).first.click(timeout=timeout_ms)
        except Exception:
            # Auto-heal fallback: try text selector from meta.text when available.
            meta = step.get("meta") if isinstance(step.get("meta"), dict) else {}
            text = meta.get("text") if isinstance(meta, dict) else None
            if isinstance(text, str) and text.strip():
                candidate = text.strip()[:80]
                _event(
                    "scenario.replay.selector.heal",
                    {
                        "kind": "click",
                        "from": selector,
                        "to": f"text={candidate}",
                    },
                )
                await page.get_by_text(candidate, exact=False).first.click(timeout=timeout_ms)
            else:
                raise
        return

    if kind in ("change", "fill", "input"):
        if not selector:
            raise ValueError("change step has no selector")
        # Password-like values are redacted during record; skip writing them.
        if value == "***":
            return
        try:
            await page.locator(selector).first.fill(value or "", timeout=timeout_ms)
        except Exception:
            meta = step.get("meta") if isinstance(step.get("meta"), dict) else {}
            placeholder = meta.get("placeholder") if isinstance(meta, dict) else None
            if isinstance(placeholder, str) and placeholder.strip():
                candidate = placeholder.strip()[:80]
                _event(
                    "scenario.replay.selector.heal",
                    {
                        "kind": "fill",
                        "from": selector,
                        "to": f"placeholder={candidate}",
                    },
                )
                await page.get_by_placeholder(candidate).first.fill(value or "", timeout=timeout_ms)
            else:
                raise
        return

    if kind in ("submit", "press"):
        key = value if (value and value.strip()) else "Enter"
        # Playwright expects key names like "Enter", "Tab", "ArrowDown".
        # In case recorder saved lowercase, normalize a bit.
        if len(key) == 1:
            # single character keys are fine
            pass
        else:
            key = key[:1].upper() + key[1:]

        if selector:
            await page.locator(selector).first.press(key, timeout=timeout_ms)
        else:
            await page.keyboard.press(key)
        return

    if kind in ("manual.pause", "manual", "manual.captcha", "captcha"):
        # handled by outer loop
        return

    if kind == "proxy.switch":
        # Applying runtime proxy on an already running Playwright context is not supported.
        # We surface an explicit event and continue safely.
        meta = step.get("meta") if isinstance(step.get("meta"), dict) else {}
        _event(
            "scenario.replay.proxy.switch",
            {
                "applied": False,
                "reason": "runtime_context_proxy_not_switchable",
                "proxyLibraryId": meta.get("proxyLibraryId") if isinstance(meta, dict) else None,
                "proxy": meta.get("runtimeProxyMasked") if isinstance(meta, dict) else None,
            },
        )
        return

    # unknown step kinds are no-op (do not fail whole run)
    return


async def main_async() -> int:
    args = _parse_args()

    try:
        from autoreg.browser.profile_launcher import ProfileLauncher
        from autoreg.core.paths import get_paths
    except Exception as e:
        _result(False, error={"code": "import_error", "message": str(e)})
        return 1

    paths = get_paths()

    # Pin Playwright browsers cache to Stitch-managed directory so first-run downloads
    # go to a predictable location (used by install_browser_runtime.py).
    try:
        pw_cache = paths.cache_dir / "playwright-browsers"
        pw_cache.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", str(pw_cache))
    except Exception:
        pass

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
        Path(args.out).expanduser().resolve() if args.out else (paths.user_data_dir / "scenarios")
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

    runtime_proxy_map: dict[str, str] = {
        str(k): str(v)
        for k, v in dict(config.get("runtime_proxy_map") or {}).items()
        if isinstance(k, str) and isinstance(v, str) and k.strip() and v.strip()
    }

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
    sanitized_steps, dropped_steps = _sanitize_steps(steps, runtime_proxy_map=runtime_proxy_map)
    if dropped_steps:
        _event(
            "scenario.replay.sanitize",
            {
                "dropped": dropped_steps,
                "droppedCount": len(dropped_steps),
                "before": len(steps),
                "after": len(sanitized_steps),
            },
        )
    steps = sanitized_steps
    total_steps = len(steps)
    from_step = max(1, int(getattr(args, "from_step", 1) or 1))
    if total_steps > 0 and from_step > total_steps:
        from_step = total_steps
    replay_steps = steps[from_step - 1 :] if total_steps > 0 else []

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
            "fromStep": from_step,
            "startUrl": start_url,
        },
    )

    if total_steps > 0 and from_step > 1:
        _event(
            "scenario.replay.resume.from_step",
            {
                "runId": run_id,
                "fromStep": from_step,
                "totalSteps": total_steps,
            },
        )

    passed = 0
    failed = 0
    started_at = _now_iso()
    failed_steps: list[dict[str, Any]] = []
    trace_saved = False
    trace_saved_paths: list[str] = []
    paused_by_overlay = False
    abort_requested = False
    active_proxy = args.proxy or None

    launcher: Any | None = None
    page: Any | None = None
    tracing_started = False
    current_trace_path: Path | None = None
    session_seq = 0

    def on_overlay_control(command: str) -> None:
        nonlocal paused_by_overlay, abort_requested
        cmd = str(command or "").strip().lower()
        if cmd == "pause":
            paused_by_overlay = True
            _event("scenario.replay.control.pause", {"runId": run_id})
            return
        if cmd == "resume":
            paused_by_overlay = False
            _event("scenario.replay.control.resume", {"runId": run_id})
            return
        if cmd in ("stop", "abort", "cancel"):
            abort_requested = True
            _event("scenario.replay.control.stop", {"runId": run_id})
            return

    async def _attach_overlay(target_page: Any) -> None:
        try:
            await target_page.expose_function("__stitchReplayControl", on_overlay_control)
        except Exception:
            pass
        try:
            await target_page.add_init_script(REPLAY_OVERLAY_SCRIPT)
            await target_page.evaluate(REPLAY_OVERLAY_SCRIPT)
        except Exception:
            pass
        try:
            await target_page.evaluate(
                "window.__stitchReplayOverlaySetStep && window.__stitchReplayOverlaySetStep(0, 0)"
            )
            await target_page.evaluate(
                "window.__stitchReplayOverlaySetReason && window.__stitchReplayOverlaySetReason('')"
            )
            await target_page.evaluate(
                "window.__stitchReplayOverlaySetPaused && window.__stitchReplayOverlaySetPaused(false)"
            )
        except Exception:
            pass

    async def _stop_tracing_if_started() -> None:
        nonlocal tracing_started, current_trace_path, trace_saved
        if not tracing_started or page is None:
            return
        try:
            target_path = current_trace_path or trace_path
            await page.context.tracing.stop(path=str(target_path))
            if target_path.exists():
                trace_saved_paths.append(str(target_path))
                trace_saved = True
        except Exception:
            _log("warn", "Failed to save trace", step="trace")
        finally:
            tracing_started = False
            current_trace_path = None

    async def _close_active_session() -> None:
        nonlocal launcher, page
        try:
            await _stop_tracing_if_started()
        finally:
            if launcher is not None:
                try:
                    await launcher.close()
                except Exception:
                    pass
            launcher = None
            page = None

    async def _start_session(proxy_url: str | None, open_url: str) -> None:
        nonlocal launcher, page, tracing_started, current_trace_path, session_seq
        session_seq += 1
        launcher = ProfileLauncher(
            profile_id=args.alias,
            headless=bool(args.headless),
            proxy=proxy_url or None,
            config=config,
            engine=args.engine,
        )
        page = await launcher.open(open_url, wait_until="domcontentloaded")
        session_page = page
        if session_page is None:
            raise RuntimeError("Failed to open replay page")
        await _attach_overlay(session_page)

        tracing_started = False
        current_trace_path = session_dir / f"trace_{session_seq:02d}.zip"
        try:
            await session_page.context.tracing.start(screenshots=True, snapshots=True)
            tracing_started = True
        except Exception:
            _log("warn", "Failed to start Playwright tracing", step="trace")

    def _latest_trace_path() -> str | None:
        if trace_saved_paths:
            return trace_saved_paths[-1]
        return None

    if args.dry_run:
        _log("warn", "Dry-run mode: browser will NOT be launched", step="init")
        try:
            deadline = time.time() + float(max(1, args.timeout_s))
            for run_idx, step in enumerate(replay_steps, start=1):
                idx = from_step + run_idx - 1
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
                        "display": (
                            (step.get("meta") or {}).get("display")
                            if isinstance(step.get("meta"), dict)
                            else None
                        ),
                    },
                )

                if kind in (
                    "manual.pause",
                    "manual",
                    "manual.captcha",
                    "captcha",
                ) or _looks_like_captcha(step):
                    reason = "captcha" if _looks_like_captcha(step) else kind
                    await _manual_pause(
                        page=None,
                        reason=reason,
                        step_index=idx,
                        total_steps=total_steps,
                        command_tail=cmd_tail,
                        command_file_path=str(command_file),
                        timeout_s=max(1, args.pause_timeout_s),
                    )

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
                "tracePath": None,
                "commandFilePath": str(command_file),
                "error": str(e),
                "dryRun": True,
            }
            _write_safe_report(report_path, report)
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
                "tracePath": None,
                "commandFilePath": str(command_file),
                "error": str(e),
                "dryRun": True,
            }
            _write_safe_report(report_path, report)
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
            "tracePath": None,
            "commandFilePath": str(command_file),
            "dryRun": True,
        }
        _write_safe_report(report_path, report)
        _event(
            "scenario.replay.finished",
            {
                "runId": run_id,
                "stepsTotal": total_steps,
                "stepsPassed": passed,
                "stepsFailed": failed,
                "reportPath": str(report_path),
                "tracePath": None,
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
                "tracePath": None,
                "artifactsDir": str(artifacts_dir),
                "commandFilePath": str(command_file),
            },
        )
        return 0

    try:
        await _start_session(active_proxy, start_url)

        deadline = time.time() + float(max(1, args.timeout_s))
        for run_idx, step in enumerate(replay_steps, start=1):
            idx = from_step + run_idx - 1
            if page is None:
                raise RuntimeError("Replay session is not active")

            if abort_requested:
                raise ReplayAbort("Stop requested from browser overlay")

            while paused_by_overlay and not abort_requested:
                try:
                    await page.evaluate(
                        "window.__stitchReplayOverlaySetPaused && window.__stitchReplayOverlaySetPaused(true)"
                    )
                except Exception:
                    pass
                await asyncio.sleep(0.25)

            try:
                await page.evaluate(
                    "window.__stitchReplayOverlaySetPaused && window.__stitchReplayOverlaySetPaused(false)"
                )
            except Exception:
                pass

            if abort_requested:
                raise ReplayAbort("Stop requested from browser overlay")

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
                    "display": (
                        (step.get("meta") or {}).get("display")
                        if isinstance(step.get("meta"), dict)
                        else None
                    ),
                },
            )

            try:
                await page.evaluate(
                    "(arg) => window.__stitchReplayOverlaySetStep && window.__stitchReplayOverlaySetStep(arg.current, arg.total)",
                    {"current": idx, "total": total_steps},
                )
            except Exception:
                pass

            try:
                if kind in (
                    "manual.pause",
                    "manual",
                    "manual.captcha",
                    "captcha",
                ) or _looks_like_captcha(step):
                    reason = "captcha" if _looks_like_captcha(step) else kind
                    try:
                        await page.evaluate(
                            "window.__stitchReplayOverlaySetStatus && window.__stitchReplayOverlaySetStatus('Manual pause')"
                        )
                        await page.evaluate(
                            "(arg) => window.__stitchReplayOverlaySetReason && window.__stitchReplayOverlaySetReason(arg.reason)",
                            {"reason": reason},
                        )
                        await page.evaluate(
                            "window.__stitchReplayOverlaySetPaused && window.__stitchReplayOverlaySetPaused(true)"
                        )
                    except Exception:
                        pass
                    await _manual_pause(
                        page=page,
                        reason=reason,
                        step_index=idx,
                        total_steps=total_steps,
                        command_tail=cmd_tail,
                        command_file_path=str(command_file),
                        timeout_s=max(1, args.pause_timeout_s),
                    )
                    try:
                        await page.evaluate(
                            "window.__stitchReplayOverlaySetReason && window.__stitchReplayOverlaySetReason('')"
                        )
                        await page.evaluate(
                            "window.__stitchReplayOverlaySetPaused && window.__stitchReplayOverlaySetPaused(false)"
                        )
                    except Exception:
                        pass

                if kind == "proxy.switch":
                    meta = step.get("meta") if isinstance(step.get("meta"), dict) else {}
                    new_proxy = (
                        str(meta.get("runtimeProxy") or "").strip()
                        if isinstance(meta, dict)
                        else ""
                    )
                    if not new_proxy:
                        raise ValueError("proxy.switch has no resolved runtime proxy")

                    current_url = "about:blank"
                    try:
                        current_url = str(page.url or "about:blank")
                    except Exception:
                        pass

                    await _close_active_session()
                    active_proxy = new_proxy
                    await _start_session(active_proxy, current_url)

                    _event(
                        "scenario.replay.proxy.switch",
                        {
                            "applied": True,
                            "reason": "session_restart_with_new_proxy",
                            "proxyLibraryId": meta.get("proxyLibraryId")
                            if isinstance(meta, dict)
                            else None,
                            "proxy": meta.get("runtimeProxyMasked")
                            if isinstance(meta, dict)
                            else None,
                        },
                    )
                else:
                    await _run_step(page, step, timeout_ms=_timeout_ms(step, 15_000))

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
                artifacts = (
                    await _save_step_artifacts(page, artifacts_dir, idx) if page is not None else {}
                )
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

        if page is not None:
            try:
                await page.evaluate(
                    "(arg) => window.__stitchReplayOverlaySetSaved && window.__stitchReplayOverlaySetSaved(arg.path)",
                    {"path": str(report_path)},
                )
            except Exception:
                pass

    except ReplayAbort as e:
        await _close_active_session()
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
            "tracePath": _latest_trace_path(),
            "commandFilePath": str(command_file),
            "error": str(e),
        }
        _write_safe_report(report_path, report)
        _event("scenario.replay.saved", {"reportPath": str(report_path), "status": "aborted"})
        _result(
            False,
            data={"reportPath": str(report_path), "runId": run_id},
            error={"code": "aborted", "message": str(e)},
        )
        return 2
    except Exception as e:
        await _close_active_session()
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
            "tracePath": _latest_trace_path(),
            "commandFilePath": str(command_file),
            "error": str(e),
        }
        _write_safe_report(report_path, report)
        _event("scenario.replay.saved", {"reportPath": str(report_path), "status": "failed"})
        _result(
            False,
            data={"reportPath": str(report_path), "runId": run_id},
            error={"code": "replay_failed", "message": str(e)},
        )
        return 1

    await _close_active_session()

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
        "tracePath": _latest_trace_path(),
        "commandFilePath": str(command_file),
    }
    _write_safe_report(report_path, report)

    _event(
        "scenario.replay.finished",
        {
            "runId": run_id,
            "stepsTotal": total_steps,
            "stepsPassed": passed,
            "stepsFailed": failed,
            "reportPath": str(report_path),
            "tracePath": _latest_trace_path(),
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
            "tracePath": _latest_trace_path(),
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
