"""Python Jobs command handlers — 5 commands.

Generic subprocess job management: start, cancel, status, control, run.
"""

from __future__ import annotations

import asyncio

from stitch_backend.core.command_registry import register_command


@register_command("start_python_job")
async def cmd_start_python_job(params: dict) -> dict:
    """Start a Python subprocess job."""
    from stitch_backend.domains.python_jobs.service import get_job_manager

    req = params.get("request", params)
    script = req.get("scriptPath", "")
    if not script:
        return {"error": "scriptPath is required"}

    job = await get_job_manager().start(
        script_path=script,
        args=req.get("args"),
        env=req.get("env"),
        cwd=req.get("cwd"),
        timeout_ms=req.get("timeoutMs", 300_000),
        correlation_id=req.get("correlationId"),
        python_binary=req.get("pythonBinary", "python"),
    )
    return {"jobId": job.id}


@register_command("cancel_python_job")
async def cmd_cancel_python_job(params: dict) -> bool:
    """Cancel a running Python job."""
    from stitch_backend.domains.python_jobs.service import get_job_manager

    job_id = params.get("jobId", "")
    return await get_job_manager().cancel(job_id)


@register_command("get_python_job_status")
async def cmd_get_python_job_status(params: dict) -> dict | None:
    """Get status of a Python job."""
    from stitch_backend.domains.python_jobs.service import get_job_manager

    job_id = params.get("jobId", "")
    job = get_job_manager().get_status(job_id)
    if not job:
        return None
    return {
        "jobId": job.id,
        "state": job.state,
        "startedAt": job.started_at,
        "finishedAt": job.finished_at,
        "exitCode": job.exit_code,
        "error": job.error,
        "correlationId": job.correlation_id,
        "resultPayload": job.result_payload,
    }


@register_command("send_python_job_control")
async def cmd_send_python_job_control(params: dict) -> bool:
    """Send a control command to a running Python job."""
    from stitch_backend.domains.python_jobs.service import get_job_manager

    req = params.get("request", params)
    job_id = req.get("jobId", "")
    command = req.get("command", "")
    payload = req.get("payload")
    return get_job_manager().send_control(job_id, command, payload)


@register_command("run_python_script")
async def cmd_run_python_script(params: dict) -> dict:
    """Run a Python script and wait for completion."""
    from stitch_backend.domains.python_jobs.service import get_job_manager

    script = params.get("scriptPath", params.get("script", ""))
    if not script:
        return {"error": "scriptPath is required"}

    job = await get_job_manager().start(
        script_path=script,
        args=params.get("args"),
        env=params.get("env"),
        cwd=params.get("cwd"),
        timeout_ms=params.get("timeoutMs", 120_000),
        python_binary=params.get("pythonBinary", "python"),
    )

    # Wait for the subprocess to finish before returning
    proc = job._process
    if proc:
        try:
            timeout_secs = params.get("timeoutMs", 120_000) / 1000.0
            await asyncio.wait_for(proc.wait(), timeout=timeout_secs)
        except asyncio.TimeoutError:
            proc.kill()

    return {
        "jobId": job.id,
        "state": job.state,
        "exitCode": job.exit_code,
        "error": job.error,
        "resultPayload": job.result_payload,
    }


@register_command("start_composed_flow_job")
async def cmd_start_composed_flow_job(params: dict) -> dict:
    """Start a composed flow execution as a Python job."""
    from stitch_backend.domains.python_jobs.service import get_job_manager
    import json as _json

    req = params.get("request", params)
    alias = req.get("alias", "")
    plan_json = req.get("planJson", req.get("plan_json", ""))
    headless = req.get("headless", False)
    persist = req.get("persistAccounts", True)

    args = ["--alias", alias, "--plan", plan_json]
    if headless:
        args.append("--headless")
    if persist:
        args.append("--persist")

    job = await get_job_manager().start(
        script_path="scripts/run_composed_flow.py",
        args=args,
        timeout_ms=req.get("timeoutMs", 300_000),
        correlation_id=req.get("correlationId"),
    )
    return {"jobId": job.id}
