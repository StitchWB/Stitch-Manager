"""Playwright replay loop (CloakBrowser path), including the proxy.switch session boundary."""

from __future__ import annotations

import asyncio
import time

from .._common import _event, _now_iso, _result
from .control import ReplayAbort, _manual_pause, _save_step_artifacts
from .report import _write_safe_report
from .session import (
    ReplaySession,
    close_active_session,
    latest_trace_path,
    start_session,
)
from .steps import (
    _best_selector,
    _looks_like_captcha,
    _run_step,
    _step_kind,
    _timeout_ms,
)


async def run(session: ReplaySession) -> int:
    args = session.args
    run_id = session.run_id
    scenario_path = session.scenario_path
    total_steps = session.total_steps
    from_step = session.from_step
    replay_steps = session.replay_steps
    started_at = session.started_at
    report_path = session.report_path
    artifacts_dir = session.artifacts_dir
    command_file = session.command_file

    try:
        await start_session(session, session.active_proxy, session.start_url)

        deadline = time.time() + float(max(1, args.timeout_s))
        for run_idx, step in enumerate(replay_steps, start=1):
            idx = from_step + run_idx - 1
            page = session.page
            if page is None:
                raise RuntimeError("Replay session is not active")

            if session.abort_requested:
                raise ReplayAbort("Stop requested from browser overlay")

            while session.paused_by_overlay and not session.abort_requested:
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

            if session.abort_requested:
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
                        command_tail=session.cmd_tail,
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

                    await close_active_session(session)
                    session.active_proxy = new_proxy
                    await start_session(session, session.active_proxy, current_url)
                    page = session.page

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

                session.passed += 1
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
                session.failed += 1
                artifacts = (
                    await _save_step_artifacts(page, artifacts_dir, idx)
                    if page is not None
                    else {}
                )
                failed_entry = {
                    "index": idx,
                    "kind": kind,
                    "selector": selector,
                    "url": url,
                    "error": str(e),
                    "artifacts": artifacts,
                }
                session.failed_steps.append(failed_entry)
                _event(
                    "scenario.replay.step.fail",
                    {
                        "runId": run_id,
                        **failed_entry,
                    },
                )
                if not args.continue_on_error:
                    raise

        if session.page is not None:
            try:
                await session.page.evaluate(
                    "(arg) => window.__stitchReplayOverlaySetSaved && window.__stitchReplayOverlaySetSaved(arg.path)",
                    {"path": str(report_path)},
                )
            except Exception:
                pass

    except ReplayAbort as e:
        await close_active_session(session)
        report = {
            "version": 1,
            "runId": run_id,
            "status": "aborted",
            "startedAt": started_at,
            "finishedAt": _now_iso(),
            "scenarioPath": str(scenario_path),
            "stepsTotal": total_steps,
            "stepsPassed": session.passed,
            "stepsFailed": session.failed,
            "failedSteps": session.failed_steps,
            "artifactsDir": str(artifacts_dir),
            "tracePath": latest_trace_path(session),
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
        await close_active_session(session)
        report = {
            "version": 1,
            "runId": run_id,
            "status": "failed",
            "startedAt": started_at,
            "finishedAt": _now_iso(),
            "scenarioPath": str(scenario_path),
            "stepsTotal": total_steps,
            "stepsPassed": session.passed,
            "stepsFailed": session.failed,
            "failedSteps": session.failed_steps,
            "artifactsDir": str(artifacts_dir),
            "tracePath": latest_trace_path(session),
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

    await close_active_session(session)

    report = {
        "version": 1,
        "runId": run_id,
        "status": "succeeded",
        "startedAt": started_at,
        "finishedAt": _now_iso(),
        "scenarioPath": str(scenario_path),
        "stepsTotal": total_steps,
        "stepsPassed": session.passed,
        "stepsFailed": session.failed,
        "failedSteps": session.failed_steps,
        "artifactsDir": str(artifacts_dir),
        "tracePath": latest_trace_path(session),
        "commandFilePath": str(command_file),
    }
    _write_safe_report(report_path, report)

    _event(
        "scenario.replay.finished",
        {
            "runId": run_id,
            "stepsTotal": total_steps,
            "stepsPassed": session.passed,
            "stepsFailed": session.failed,
            "reportPath": str(report_path),
            "tracePath": latest_trace_path(session),
        },
    )
    _event("scenario.replay.saved", {"reportPath": str(report_path), "status": "succeeded"})
    _result(
        True,
        data={
            "runId": run_id,
            "stepsTotal": total_steps,
            "stepsPassed": session.passed,
            "stepsFailed": session.failed,
            "reportPath": str(report_path),
            "tracePath": latest_trace_path(session),
            "artifactsDir": str(artifacts_dir),
            "commandFilePath": str(command_file),
        },
    )
    return 0
