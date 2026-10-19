"""Step capture: record events, console fallback parsing, control channel, autosave."""

from __future__ import annotations

import json
import time
from typing import Any

from scenario_io import build_scenario_container, write_scenario

from .._common import _event, _now_iso
from .proxy import _mask_proxy_for_display, _parse_proxy_switch_raw
from .state import RecordedStep, RecorderSession


def on_record(session: RecorderSession, payload: dict[str, Any]) -> None:
    if session.paused:
        return

    if not payload or not isinstance(payload, dict):
        return

    kind = str(payload.get("kind") or "").strip().lower()

    # Normalize proxy.switch payload and avoid leaking credentials in step.value.
    if kind == "proxy.switch":
        switch_meta = dict(payload.get("meta") or {})
        proxy_id = str(switch_meta.get("proxyLibraryId") or "").strip() or None

        resolved_raw = session.runtime_proxy_map.get(proxy_id) if proxy_id else None

        parsed = _parse_proxy_switch_raw(resolved_raw)
        if not parsed:
            _event(
                "scenario.record.proxy_switch.invalid",
                {
                    "runId": session.run_id,
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
        session.steps.append(step)
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


def _maybe_parse_console_step(session: RecorderSession, text: str) -> None:
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
            on_record(session, payload)
    except Exception:
        return
    return


def _maybe_parse_console_control(session: RecorderSession, text: str) -> None:
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
        on_control(session, raw)
    except Exception:
        return
    return


def on_control(session: RecorderSession, command: str) -> None:
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
                session.pending_proxy_restart = payload
                _event(
                    "scenario.record.control.proxy_restart",
                    {
                        "runId": session.run_id,
                        "proxyLibraryId": payload.get("proxyLibraryId"),
                        "url": payload.get("url"),
                    },
                )
                return

            if action in ("tab.new", "tab.activate", "tab.close"):
                session.pending_tab_controls.append(payload)
                _event(
                    "scenario.record.control.tab",
                    {
                        "runId": session.run_id,
                        "action": action,
                        "tabId": payload.get("tabId"),
                    },
                )
                return

            if action == "browser.close":
                session.pending_browser_close = True
                _event(
                    "scenario.record.control.browser_close",
                    {
                        "runId": session.run_id,
                    },
                )
                return

    cmd = raw_cmd.lower()
    if cmd in ("pause", "resume", "continue", "stop", "abort", "cancel"):
        # Transport controls are forwarded to the extension capture engine from the record loop.
        session.pending_bridge_controls.append(cmd)
    if cmd == "pause":
        session.paused = True
        _event("scenario.record.control.pause", {"runId": session.run_id})
        return
    if cmd == "resume":
        session.paused = False
        _event("scenario.record.control.resume", {"runId": session.run_id})
        return
    if cmd == "stop":
        session.keep_browser_open_after_save = True
        _event("scenario.record.control.stop", {"runId": session.run_id, "mode": "save_only"})
        session.stop_requested = True
        return
    if cmd in ("abort", "cancel"):
        session.keep_browser_open_after_save = False
        _event("scenario.record.control.stop", {"runId": session.run_id})
        session.stop_requested = True
        return


async def attach_console_listeners(session: RecorderSession, ctx: Any) -> None:
    try:
        pages = [p for p in getattr(ctx, "pages", []) if p and not p.is_closed()]
    except Exception:
        pages = []
    for p in pages:
        try:
            page_key = id(p)
            if page_key in session.console_hooks_page_ids:
                continue
            p.on(
                "console",
                lambda msg: _maybe_parse_console_step(session, msg.text),
            )
            p.on(
                "console",
                lambda msg: _maybe_parse_console_control(session, msg.text),
            )
            session.console_hooks_page_ids.add(page_key)
        except Exception:
            continue


def read_control_file(session: RecorderSession) -> None:
    try:
        if not session.command_file.exists():
            return
        with session.command_file.open("r", encoding="utf-8") as fh:
            fh.seek(session.command_pos)
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
                    on_control(session, cmd)
            session.command_pos = fh.tell()
    except Exception:
        return


def export_snapshot(session: RecorderSession) -> None:
    # Best-effort autosave snapshot (safe on kill/cancel)
    try:
        # avoid excessive disk writes
        if len(session.steps) == session.last_len and (time.time() - session.last_save_ts) < 2.0:
            return
        scenario = build_scenario_container(
            name=session.args.scenario_name,
            run_id=session.run_id,
            alias=session.args.alias,
            started_url=session.args.url,
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
                for s in session.steps
            ],
        )
        write_scenario(session.scenario_path, scenario)
        session.last_len = len(session.steps)
        session.last_save_ts = time.time()
    except Exception:
        return
