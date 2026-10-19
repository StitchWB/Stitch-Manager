"""Dry-run replay path: validate scenario + manual pause control flow without a browser."""

from __future__ import annotations

import time
from typing import Any

from .._common import _event, _log, _now_iso, _result
from .control import ReplayAbort, _manual_pause
from .report import _write_safe_report
from .session import ReplaySession
from .steps import _best_selector, _looks_like_captcha, _step_kind


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
                    command_tail=session.cmd_tail,
                    command_file_path=str(command_file),
                    timeout_s=max(1, args.pause_timeout_s),
                )

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

    except ReplayAbort as e:
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
            "stepsPassed": session.passed,
            "stepsFailed": session.failed,
            "failedSteps": session.failed_steps,
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

    report: dict[str, Any] = {
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
            "stepsPassed": session.passed,
            "stepsFailed": session.failed,
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
            "stepsPassed": session.passed,
            "stepsFailed": session.failed,
            "reportPath": str(report_path),
            "tracePath": None,
            "artifactsDir": str(artifacts_dir),
            "commandFilePath": str(command_file),
        },
    )
    return 0
