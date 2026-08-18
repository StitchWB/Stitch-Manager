"""Python Jobs command handlers — 5 commands.

Generic subprocess job management: start, cancel, status, control, run.
"""

from __future__ import annotations

import asyncio

from stitch_backend.core.command_registry import register_command


@register_command("start_python_job")
async def cmd_start_python_job(params: dict) -> dict:
    """Start a Python subprocess job."""
    from stitch_backend.config import REPO_ROOT
    from stitch_backend.domains.python_jobs.service import get_job_manager

    req = params.get("request", params)
    script = req.get("scriptPath", "")
    if not script:
        return {"error": "scriptPath is required"}

    # Resolve relative paths against REPO_ROOT so 'python/foo.py' works
    # regardless of the backend process cwd.
    from pathlib import Path
    script_path = Path(script)
    if not script_path.is_absolute():
        script = str(REPO_ROOT / script)

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
async def cmd_run_python_script(params: dict) -> str:
    """Run a Python script and return stdout as str."""
    import os as _os

    script = params.get("scriptPath", params.get("script", ""))
    if not script:
        return "error: scriptPath is required"

    python_binary = params.get("pythonBinary", "python")
    args = params.get("args") or []
    timeout_secs = params.get("timeoutMs", 120_000) / 1000.0

    env = dict(_os.environ)
    if params.get("env"):
        env.update(params["env"])

    cmd = [python_binary, script] + args
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=params.get("cwd"),
            env=env,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=timeout_secs
        )
        if proc.returncode != 0:
            return stderr.decode("utf-8", errors="replace")[:2000]
        return stdout.decode("utf-8", errors="replace")
    except TimeoutError:
        return f"error: script timed out after {timeout_secs:.0f}s"
    except FileNotFoundError:
        return f"error: Python binary not found: {python_binary}"
    except Exception as e:
        return f"error: {e}"


@register_command("start_composed_flow_job")
async def cmd_start_composed_flow_job(params: dict) -> dict:
    """Start a composed flow execution as a Python job."""
    from stitch_backend.config import REPO_ROOT
    from stitch_backend.domains.python_jobs.service import get_job_manager

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

    script_path = str(REPO_ROOT / "python" / "run_composed_flow.py")
    job = await get_job_manager().start(
        script_path=script_path,
        args=args,
        timeout_ms=req.get("timeoutMs", 300_000),
        correlation_id=req.get("correlationId"),
    )
    return {"jobId": job.id}
