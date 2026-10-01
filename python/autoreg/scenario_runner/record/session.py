"""Browser session lifecycle for the recorder (start, recover, close, proxy resolution)."""

from __future__ import annotations

import sys
from typing import Any

from .._common import _event, _log
from .capture import attach_console_listeners
from .install import ensure_recorder_installed
from .overlay import build_active_proxy_payload, update_overlay_all
from .state import CaptureUnavailableError, RecorderSession
from .tabs import _page_id, update_tabs_overlay


async def resolve_runtime_proxy_from_payload(
    session: RecorderSession, payload: dict[str, Any]
) -> str | None:
    proxy_id = str(payload.get("proxyLibraryId") or "").strip()

    if proxy_id and proxy_id in session.runtime_proxy_map:
        return session.runtime_proxy_map.get(proxy_id)
    return None


async def start_recording_session(
    session: RecorderSession, url: str, proxy_url: str | None
) -> tuple[Any, Any, Any]:
    args = session.args
    bridge = session.bridge
    if bridge is not None and bridge.started:
        # The extension says hello during browser launch; hold start_record until the page is ready.
        bridge.disarm()
    try:
        _log(
            "info",
            f"Creating ProfileLauncher with profile_id={args.alias}, headless={args.headless}, proxy={'yes' if proxy_url else 'no'}",
            step="init",
        )
        from autoreg.browser.profile_launcher import ProfileLauncher

        local_launcher = ProfileLauncher(
            profile_id=args.alias,
            headless=bool(args.headless),
            proxy=proxy_url or None,
            config=session.config,
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
        # ShardBrowser pages have no Playwright context; everything ctx-based is guarded on this.
        local_ctx = getattr(local_page, "context", None)
    except Exception as e:
        import traceback

        _log("error", f"Failed to open browser page: {e}", step="init")
        sys.stderr.write(f"BROWSER OPEN ERROR: {e}\n")
        sys.stderr.write(traceback.format_exc())
        sys.stderr.flush()
        raise

    session.context_bindings_installed = False
    session.context_scripts_installed = False
    if session.use_bridge:
        if not session.bridge_started and not session.injected_fallback_allowed:
            raise CaptureUnavailableError(
                "Record bridge is unavailable and there is no injected-script "
                "fallback, so recording cannot start."
            )
        if session.bridge_started and not session.bridge_decided:
            # Give the extension service worker a short grace window before falling back.
            session.bridge_decided = True
            session.capture_via_extension = await bridge.wait_client(timeout_s=5.0)
            if not session.capture_via_extension:
                if bridge is not None:
                    # Refuse late extension clients so no rogue HUD starts next to the injected recorder.
                    bridge.stop_accepting()
                if not session.injected_fallback_allowed:
                    raise CaptureUnavailableError(
                        "Stitch extension did not connect to the record bridge "
                        "and there is no injected-script fallback, so recording "
                        "cannot start."
                    )
            _event(
                "scenario.record.capture_mode",
                {
                    "runId": session.run_id,
                    "mode": "extension" if session.capture_via_extension else "injected",
                },
            )
    if session.capture_via_extension:
        # Extension captures; the native overlay keeps orchestration only — no injected recorder.
        if local_ctx is not None:
            await ensure_recorder_installed(session, local_ctx, include_recorder=False)
            await attach_console_listeners(session, local_ctx)
    else:
        await ensure_recorder_installed(session, local_ctx)
        await attach_console_listeners(session, local_ctx)
    if session.capture_via_extension and bridge is not None:
        # Page is loaded: release queued hellos → start_record (also on proxy.switch restarts).
        await bridge.arm()
    await update_overlay_all(
        session,
        local_ctx,
        status="Recording",
        reason="",
        paused_flag=False,
        count=len(session.steps),
        proxy_payload=build_active_proxy_payload(
            session, session.active_proxy_library_id, proxy_url
        ),
    )
    session.active_page_id = _page_id(local_page) or session.active_page_id
    await update_tabs_overlay(session, local_ctx)
    return local_launcher, local_page, local_ctx


def _safe_current_url(session: RecorderSession, default_url: str) -> str:
    try:
        if session.page is not None and not session.page.is_closed():
            candidate = str(session.page.url or "").strip()
            if candidate:
                return candidate
    except Exception:
        pass
    return default_url


async def recover_recording_context(session: RecorderSession, reason: str) -> bool:
    """Best-effort recovery when pages/context disappear during recording."""

    _event(
        "scenario.record.recover.started",
        {
            "runId": session.run_id,
            "reason": reason,
        },
    )

    # Fast path: if context still exists, create a replacement page.
    try:
        if session.ctx is not None:
            replacement = await session.ctx.new_page()
            try:
                await replacement.goto("about:blank", wait_until="domcontentloaded")
            except Exception:
                pass
            session.page = replacement
            session.active_page_id = _page_id(replacement) or session.active_page_id
            await ensure_recorder_installed(
                session, session.ctx, include_recorder=not session.capture_via_extension
            )
            await attach_console_listeners(session, session.ctx)
            await update_overlay_all(
                session,
                session.ctx,
                status="Recording",
                reason="Recovered after tab close",
                paused_flag=False,
                count=len(session.steps),
            )
            await update_tabs_overlay(session, session.ctx)
            _event(
                "scenario.record.recover.done",
                {
                    "runId": session.run_id,
                    "reason": reason,
                    "mode": "new_page",
                },
            )
            return True
    except Exception:
        pass

    # Fallback: restart browser session and continue recording with current steps.
    restart_url = _safe_current_url(session, session.args.url)
    try:
        await close_recording_session(session)
        session.launcher, session.page, session.ctx = await start_recording_session(
            session, restart_url, session.active_proxy_url
        )
        session.active_page_id = (
            _page_id(session.page) if session.page is not None else session.active_page_id
        )
        await update_overlay_all(
            session,
            session.ctx,
            status="Recording",
            reason="Recovered after browser close",
            paused_flag=False,
            count=len(session.steps),
        )
        await update_tabs_overlay(session, session.ctx)
        _event(
            "scenario.record.recover.done",
            {
                "runId": session.run_id,
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
                "runId": session.run_id,
                "reason": reason,
                "error": str(e),
            },
        )
        return False


async def close_recording_session(session: RecorderSession) -> None:
    if session.launcher is not None:
        try:
            await session.launcher.close()
        except Exception:
            pass
    session.launcher = None
    session.page = None
    session.ctx = None
