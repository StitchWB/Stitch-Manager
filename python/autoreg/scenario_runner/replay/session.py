"""Replay session state and Playwright session lifecycle (start/stop/tracing/overlay)."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from .._common import _event, _log
from .overlay_script import REPLAY_OVERLAY_SCRIPT

if TYPE_CHECKING:
    import argparse

    from .control import CommandTail


class ReplaySession:
    def __init__(
        self,
        *,
        args: argparse.Namespace,
        run_id: str,
        session_dir: Path,
        artifacts_dir: Path,
        command_file: Path,
        cmd_tail: CommandTail,
        report_path: Path,
        trace_path: Path,
        config: dict[str, Any],
        start_url: str,
        total_steps: int,
        from_step: int,
        replay_steps: list[dict[str, Any]],
        scenario_path: Path,
        started_at: str,
    ) -> None:
        self.args = args
        self.run_id = run_id
        self.session_dir = session_dir
        self.artifacts_dir = artifacts_dir
        self.command_file = command_file
        self.cmd_tail = cmd_tail
        self.report_path = report_path
        self.trace_path = trace_path
        self.config = config
        self.start_url = start_url
        self.total_steps = total_steps
        self.from_step = from_step
        self.replay_steps = replay_steps
        self.scenario_path = scenario_path
        self.started_at = started_at
        self.passed = 0
        self.failed = 0
        self.failed_steps: list[dict[str, Any]] = []
        self.trace_saved = False
        self.trace_saved_paths: list[str] = []
        self.paused_by_overlay = False
        self.abort_requested = False
        self.active_proxy: str | None = args.proxy or None
        self.launcher: Any | None = None
        self.page: Any | None = None
        self.tracing_started = False
        self.current_trace_path: Path | None = None
        self.session_seq = 0


def on_overlay_control(session: ReplaySession, command: str) -> None:
    cmd = str(command or "").strip().lower()
    if cmd == "pause":
        session.paused_by_overlay = True
        _event("scenario.replay.control.pause", {"runId": session.run_id})
        return
    if cmd == "resume":
        session.paused_by_overlay = False
        _event("scenario.replay.control.resume", {"runId": session.run_id})
        return
    if cmd in ("stop", "abort", "cancel"):
        session.abort_requested = True
        _event("scenario.replay.control.stop", {"runId": session.run_id})
        return


async def attach_overlay(session: ReplaySession, target_page: Any) -> None:
    try:
        await target_page.expose_function(
            "__stitchReplayControl", lambda command: on_overlay_control(session, command)
        )
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


async def stop_tracing_if_started(session: ReplaySession) -> None:
    if not session.tracing_started or session.page is None:
        return
    try:
        target_path = session.current_trace_path or session.trace_path
        await session.page.context.tracing.stop(path=str(target_path))
        if target_path.exists():
            session.trace_saved_paths.append(str(target_path))
            session.trace_saved = True
    except Exception:
        _log("warn", "Failed to save trace", step="trace")
    finally:
        session.tracing_started = False
        session.current_trace_path = None


async def close_active_session(session: ReplaySession) -> None:
    try:
        await stop_tracing_if_started(session)
    finally:
        if session.launcher is not None:
            try:
                await session.launcher.close()
            except Exception:
                pass
        session.launcher = None
        session.page = None


async def start_session(session: ReplaySession, proxy_url: str | None, open_url: str) -> None:
    args = session.args
    session.session_seq += 1
    from autoreg.browser.profile_launcher import ProfileLauncher

    session.launcher = ProfileLauncher(
        profile_id=args.alias,
        headless=bool(args.headless),
        proxy=proxy_url or None,
        config=session.config,
        engine=args.engine,
    )
    session.page = await session.launcher.open(open_url, wait_until="domcontentloaded")
    session_page = session.page
    if session_page is None:
        raise RuntimeError("Failed to open replay page")
    await attach_overlay(session, session_page)

    session.tracing_started = False
    session.current_trace_path = session.session_dir / f"trace_{session.session_seq:02d}.zip"
    try:
        await session_page.context.tracing.start(screenshots=True, snapshots=True)
        session.tracing_started = True
    except Exception:
        _log("warn", "Failed to start Playwright tracing", step="trace")


def latest_trace_path(session: ReplaySession) -> str | None:
    if session.trace_saved_paths:
        return session.trace_saved_paths[-1]
    return None
