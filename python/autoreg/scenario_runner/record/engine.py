"""Recording orchestration: session lifecycle, control loop, autosave, final save."""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path
from typing import TYPE_CHECKING

from .._common import (
    _event,
    _log,
    _result,
    pin_playwright_browsers_path,
    resolve_out_dir,
)
from .bridge import setup_capture_bridge
from .capture import attach_console_listeners, export_snapshot, read_control_file
from .install import ensure_recorder_installed
from .overlay import build_active_proxy_payload, update_overlay_all
from .session import (
    close_recording_session,
    recover_recording_context,
    resolve_runtime_proxy_from_payload,
    start_recording_session,
)
from .setup import apply_config, ensure_recorder_tab_ui_prefs
from .state import CaptureUnavailableError, RecorderSession
from .tabs import _page_id, apply_pending_tab_controls, update_tabs_overlay

if TYPE_CHECKING:
    import argparse


async def main_async(args: argparse.Namespace) -> int:
    overlay_enabled = not bool(args.no_overlay)

    try:

        from autoreg.browser.profile_launcher import _normalize_engine
        from autoreg.core.paths import get_paths
    except Exception as e:
        import traceback

        _log("error", f"Import error: {e}", step="init")
        sys.stderr.write(f"IMPORT ERROR: {e}\n")
        sys.stderr.write(traceback.format_exc())
        sys.stderr.flush()
        _result(
            False,
            error={"code": "import_error", "message": str(e), "details": traceback.format_exc()},
        )
        return 1

    engine_norm = _normalize_engine(args.engine)
    if engine_norm != "cloakbrowser":
        # Non-Cloak engines expose no Playwright context; capture there is extension-only.
        overlay_enabled = False

    run_id = f"rec_{int(time.time())}"
    paths = get_paths()

    pin_playwright_browsers_path(paths)

    out_dir = resolve_out_dir(args, paths)
    session_dir = out_dir / f"{args.scenario_name}_{run_id}"
    session_dir.mkdir(parents=True, exist_ok=True)

    scenario_path = session_dir / "scenario.json"
    command_file = (
        Path(args.command_file).expanduser().resolve()
        if args.command_file
        else (session_dir / "control.ndjson")
    )
    command_file.parent.mkdir(parents=True, exist_ok=True)

    session = RecorderSession(
        args=args,
        run_id=run_id,
        out_dir=out_dir,
        session_dir=session_dir,
        scenario_path=scenario_path,
        command_file=command_file,
        overlay_enabled=overlay_enabled,
        engine_norm=engine_norm,
    )
    _event(
        "scenario.record.location",
        {
            "runId": run_id,
            "sessionDir": str(session_dir),
            "scenarioPath": str(scenario_path),
            "commandFilePath": str(command_file),
        },
    )

    apply_config(session)
    ensure_recorder_tab_ui_prefs(session)

    bridge_code = await setup_capture_bridge(session)
    if bridge_code is not None:
        return bridge_code

    _log("info", f"Starting recorder: {args.scenario_name}", step="init")
    import platform

    _log("info", f"Python {platform.python_version()} on {platform.system()}", step="init")
    try:
        import playwright

        _log("info", f"Playwright {playwright.__version__}", step="init")
        try:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as p:
                browser_path = p.chromium.executable_path
                _log("info", f"Chromium browser path: {browser_path}", step="init")
                if not browser_path or not Path(browser_path).exists():
                    _log(
                        "error",
                        "Chromium browser not found! Run: playwright install chromium",
                        step="init",
                    )
                    sys.stderr.write(
                        "ERROR: Chromium browser not found! Run: playwright install chromium\n"
                    )
                    _result(
                        False,
                        error={
                            "code": "browser_not_installed",
                            "message": "Chromium not found. Run: playwright install chromium",
                        },
                    )
                    return 1
        except Exception as browser_err:
            _log("warn", f"Could not check browser path: {browser_err}", step="init")
    except Exception:
        pass
    _log(
        "info",
        f"Starting recording: alias={args.alias}, url={args.url}, headless={args.headless}",
        step="init",
    )

    _event("scenario.record.started", {"runId": run_id, "alias": args.alias})

    try:
        session.launcher, session.page, session.ctx = await start_recording_session(
            session, args.url, session.active_proxy_url
        )

        _event(
            "scenario.record.ready",
            {
                "runId": run_id,
                "alias": args.alias,
                "url": args.url,
            },
        )

        export_snapshot(session)

        _log(
            "info",
            "Recording... cancel the job to stop (autosaves) or wait for timeout",
            step="record",
        )

        deadline = time.time() + float(args.timeout_s)
        while time.time() < deadline:
            await asyncio.sleep(0.5)
            read_control_file(session)
            if (
                session.capture_via_extension
                and session.bridge is not None
                and session.pending_bridge_controls
            ):
                for ctrl in session.pending_bridge_controls:
                    await session.bridge.send({"type": "control", "payload": {"command": ctrl}})
                session.pending_bridge_controls.clear()
            export_snapshot(session)
            if session.pending_proxy_restart is not None:
                restart_payload = session.pending_proxy_restart
                session.pending_proxy_restart = None

                next_proxy = await resolve_runtime_proxy_from_payload(session, restart_payload)
                if not next_proxy:
                    await update_overlay_all(
                        session,
                        session.ctx,
                        status="Recording",
                        reason="Invalid proxy for restart",
                        paused_flag=False,
                        count=len(session.steps),
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
                    current_url = (
                        str(session.page.url or args.url) if session.page is not None else args.url
                    )
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
                await close_recording_session(session)
                session.active_proxy_library_id = (
                    str(restart_payload.get("proxyLibraryId") or "").strip() or None
                )
                session.active_proxy_url = next_proxy
                session.launcher, session.page, session.ctx = await start_recording_session(
                    session, current_url, session.active_proxy_url
                )
                session.active_page_id = (
                    _page_id(session.page) if session.page is not None else session.active_page_id
                )
                await update_overlay_all(
                    session,
                    session.ctx,
                    status="Recording",
                    reason="Proxy switched (restart)",
                    paused_flag=False,
                    count=len(session.steps),
                    proxy_payload=build_active_proxy_payload(
                        session, session.active_proxy_library_id, session.active_proxy_url
                    ),
                )
                await update_tabs_overlay(session, session.ctx)
                _event(
                    "scenario.record.proxy_restart.done",
                    {
                        "runId": run_id,
                        "proxyLibraryId": restart_payload.get("proxyLibraryId"),
                    },
                )

            if session.pending_browser_close:
                session.pending_browser_close = False
                await close_recording_session(session)
                _event(
                    "scenario.record.browser.closed",
                    {
                        "runId": run_id,
                    },
                )
                break

            if session.ctx is not None:
                await apply_pending_tab_controls(session, session.ctx)

            if session.ctx is not None:
                try:
                    await ensure_recorder_installed(
                        session, session.ctx, include_recorder=not session.capture_via_extension
                    )
                    # Ensure console listeners attached to any new pages
                    await attach_console_listeners(session, session.ctx)
                except Exception:
                    recovered = await recover_recording_context(session, "context_unavailable")
                    if not recovered:
                        _log(
                            "warn",
                            "Recorder context unavailable and recovery failed - stopping record",
                            step="record",
                        )
                        break
                    continue

            await update_tabs_overlay(session, session.ctx)

            if session.paused:
                await update_overlay_all(
                    session,
                    session.ctx,
                    status="Paused",
                    reason="Operator pause",
                    paused_flag=True,
                    count=len(session.steps),
                )
            else:
                await update_overlay_all(
                    session,
                    session.ctx,
                    status="Recording",
                    reason="",
                    paused_flag=False,
                    count=len(session.steps),
                )
            if session.stop_requested:
                _log("info", "Stop requested from browser overlay", step="record")
                break
            if session.ctx is not None:
                try:
                    live_pages = [
                        p for p in getattr(session.ctx, "pages", []) if p and not p.is_closed()
                    ]
                except Exception:
                    live_pages = []
                if not live_pages:
                    recovered = await recover_recording_context(session, "all_pages_closed")
                    if not recovered:
                        _log(
                            "warn",
                            "All pages closed and recovery failed - stopping record",
                            step="record",
                        )
                        break
                    continue
            elif session.page is None or session.page.is_closed():
                _log("warn", "Recorder page closed - stopping record", step="record")
                break

        await update_overlay_all(
            session,
            session.ctx,
            status="Saving",
            reason="",
            paused_flag=False,
            count=len(session.steps),
        )
        if session.capture_via_extension and session.bridge is not None:
            await session.bridge.send({"type": "stop_record", "payload": {"runId": run_id}})
    except CaptureUnavailableError as e:
        _log("error", str(e), step="init")
        await close_recording_session(session)
        if session.bridge is not None:
            await session.bridge.close()
        _result(False, error={"code": "extension_capture_unavailable", "message": str(e)})
        return 1
    except Exception as e:
        import traceback

        error_msg = str(e)
        error_traceback = traceback.format_exc()
        _log("error", f"Recording failed: {error_msg}", step="record")
        sys.stderr.write(f"RECORDING ERROR: {error_msg}\n")
        sys.stderr.write(error_traceback)
        sys.stderr.flush()
        await close_recording_session(session)
        if session.bridge is not None:
            await session.bridge.close()
        _result(
            False,
            error={"code": "record_failed", "message": error_msg, "traceback": error_traceback},
        )
        return 1

    if not session.keep_browser_open_after_save:
        await close_recording_session(session)

    export_snapshot(session)

    try:
        if session.ctx is not None:
            await update_overlay_all(
                session,
                session.ctx,
                status="Saved",
                reason="Scenario saved",
                paused_flag=True,
                count=len(session.steps),
                saved_path=str(scenario_path),
            )
    except Exception:
        pass

    _event("scenario.record.saved", {"path": str(scenario_path), "steps": len(session.steps)})
    if session.bridge is not None:
        await session.bridge.close()
    _result(
        True,
        data={"scenarioPath": str(scenario_path), "steps": len(session.steps), "runId": run_id},
    )
    return 0
