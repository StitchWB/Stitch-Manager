"""Registration domain command handlers."""

from __future__ import annotations

import json
import logging
import shutil
import webbrowser

from stitch_backend.core.command_registry import register_command

logger = logging.getLogger(__name__)


@register_command("start_registration")
async def cmd_start_registration(params: dict) -> dict:
    """Start one or more registration jobs for a provider."""
    from stitch_backend.domains.registration.job_manager import job_manager
    from stitch_backend.domains.registration.schemas import StartRegistrationRequest

    req = StartRegistrationRequest.model_validate(params)
    jobs = await job_manager.submit_batch(
        provider_id=req.provider_id,
        count=req.count,
    )
    return {
        "jobs": [j.to_dict() for j in jobs],
        "count": len(jobs),
    }


@register_command("get_registration_progress")
async def cmd_get_registration_progress(params: dict) -> dict:
    """Get progress for a specific job or list all jobs."""
    from stitch_backend.domains.registration.job_manager import job_manager
    from stitch_backend.domains.registration.schemas import GetProgressRequest

    req = GetProgressRequest.model_validate(params)

    if req.job_id:
        job = job_manager.get_job(req.job_id)
        return {"job": job.to_dict()}
    else:
        jobs = job_manager.list_jobs()
        return {"jobs": [j.to_dict() for j in jobs]}


@register_command("cancel_registration")
async def cmd_cancel_registration(params: dict) -> dict:
    """Cancel a running registration job."""
    from stitch_backend.domains.registration.job_manager import job_manager
    from stitch_backend.domains.registration.schemas import CancelRegistrationRequest

    req = CancelRegistrationRequest.model_validate(params)
    await job_manager.cancel(req.job_id)
    return {"success": True, "jobId": req.job_id}


@register_command("get_providers")
async def cmd_get_providers(params: dict) -> dict:
    """List all registered provider plugins."""
    from stitch_backend.core.command_registry import list_providers

    providers = list_providers()
    result = []
    for pid, cls in providers.items():
        result.append({
            "id": pid,
            "displayName": getattr(cls, "display_name", pid),
            "isLlmAccount": getattr(cls, "is_llm_account", False),
            "requiresMachineId": getattr(cls, "requires_machine_id", False),
        })
    return {"providers": result}


# ── AWS Cognito ─────────────────────────────────────────────────────────────

# Allowed provider identifiers for autoreg scripts
_ALLOWED_AUTOREG_PROVIDERS = frozenset({
    "kiro", "kiro_v2", "windsurf", "trae", "github",
    "openai", "fireworks", "qoder", "bitbucket", "python",
})


@register_command("auto_register")
async def cmd_auto_register(params: dict) -> dict:
    """Auto-register via in-process provider call."""
    from stitch_backend.domains.registration.service import registration_service

    email = params.get("email", "")
    password = params.get("password", "")
    provider = params.get("provider", "kiro")
    if provider not in _ALLOWED_AUTOREG_PROVIDERS:
        return {"error": f"Unknown provider: {provider}"}
    config = {"email": email, "password": password, "headless": True}
    job_id = await registration_service.submit(provider, config)
    return {"jobId": job_id, "success": True}


@register_command("confirm_registration")
async def cmd_confirm_registration(params: dict) -> dict:
    """Confirm email registration with verification code."""
    from stitch_backend.domains.registration.service import registration_service

    email = params.get("email", "")
    code = params.get("code", "")
    config = {"email": email, "verification_code": code, "headless": True}
    job_id = await registration_service.submit("kiro", config)
    return {"jobId": job_id, "success": True}


@register_command("auto_login")
async def cmd_auto_login(params: dict) -> dict:
    """Auto-login to existing account via AWS Cognito."""
    from stitch_backend.domains.registration.service import registration_service

    email = params.get("email", "")
    password = params.get("password", "")
    config = {"email": email, "password": password, "headless": True, "launch_mode": "login"}
    job_id = await registration_service.submit("kiro", config)
    return {"jobId": job_id, "success": True}


# ── Device Flow ─────────────────────────────────────────────────────────────

@register_command("start_device_flow")
async def cmd_start_device_flow(params: dict) -> dict:
    """Start OAuth Device Flow — returns verification URL and user code."""
    return {
        "deviceCode": "",
        "userCode": "",
        "verificationUri": "",
        "interval": 5,
        "expiresIn": 600,
        "clientId": "",
        "clientSecret": "",
    }


@register_command("poll_device_flow")
async def cmd_poll_device_flow(params: dict) -> dict:
    """Poll for device flow token after user authorizes."""
    return {
        "accessToken": None,
        "refreshToken": None,
        "tokenType": "Bearer",
        "expiresIn": 0,
        "error": "not_authorized",
    }


@register_command("open_device_flow_url")
async def cmd_open_device_flow_url(params: dict) -> None:
    """Open the device flow verification URL in browser."""
    uri = params.get("verification_uri", params.get("verificationUri", ""))
    if uri:
        webbrowser.open(uri)


# ── Autoreg Jobs (8 providers) ─────────────────────────────────────────────


async def _start_autoreg_job(provider: str, params: dict) -> dict:
    """Common helper for all autoreg job starters.

    Calls the autoreg provider in-process via RegistrationService,
    streaming logs to the frontend via EventBus.
    """
    from stitch_backend.domains.registration.service import registration_service

    config = params.get("config", params)
    if not isinstance(config, dict):
        config = {}

    job_id = await registration_service.submit(provider, config)
    return {"jobId": job_id}


@register_command("start_python_autoreg_job")
async def cmd_start_python_autoreg_job(params: dict) -> dict:
    return await _start_autoreg_job("python", params)


@register_command("start_windsurf_autoreg_job")
async def cmd_start_windsurf_autoreg_job(params: dict) -> dict:
    return await _start_autoreg_job("windsurf", params)


@register_command("start_trae_autoreg_job")
async def cmd_start_trae_autoreg_job(params: dict) -> dict:
    return await _start_autoreg_job("trae", params)


@register_command("start_github_autoreg_job")
async def cmd_start_github_autoreg_job(params: dict) -> dict:
    return await _start_autoreg_job("github", params)


@register_command("start_openai_autoreg_job")
async def cmd_start_openai_autoreg_job(params: dict) -> dict:
    return await _start_autoreg_job("openai", params)


@register_command("start_fireworks_autoreg_job")
async def cmd_start_fireworks_autoreg_job(params: dict) -> dict:
    return await _start_autoreg_job("fireworks", params)


@register_command("start_qoder_autoreg_job")
async def cmd_start_qoder_autoreg_job(params: dict) -> dict:
    return await _start_autoreg_job("qoder", params)


@register_command("start_bitbucket_autoreg_job")
async def cmd_start_bitbucket_autoreg_job(params: dict) -> dict:
    return await _start_autoreg_job("bitbucket", params)


@register_command("start_kiro_v2_autoreg_job")
async def cmd_start_kiro_v2_autoreg_job(params: dict) -> dict:
    return await _start_autoreg_job("kiro_v2", params)


# ── Pipeline Control ────────────────────────────────────────────────────────

@register_command("registration_control")
async def cmd_registration_control(params: dict) -> None:
    """Send pipeline control signal to a running registration job."""
    from stitch_backend.domains.python_jobs.service import get_job_manager

    job_id = params.get("jobId", "")
    command = params.get("command", "")
    data = params.get("data")
    get_job_manager().send_control(job_id, command, data)


@register_command("stop_registration")
async def cmd_stop_registration(params: dict) -> None:
    """Stop a running registration job.

    If ``jobId`` is provided, cancels that specific job.
    If no ``jobId``, cancels ALL currently running registration jobs.
    """
    from stitch_backend.domains.registration.service import registration_service

    job_id = params.get("jobId", "")
    if job_id:
        await registration_service.cancel(job_id)
    else:
        # Cancel all running jobs
        running_ids = [
            jid for jid, job in registration_service._jobs.items()
            if job.get("state") == "running"
        ]
        for jid in running_ids:
            await registration_service.cancel(jid)


# ── Registration Jobs (query/clear) ─────────────────────────────────────

@register_command("get_registration_jobs")
async def cmd_get_registration_jobs(params: dict) -> list:
    """Get all registration jobs.

    Returns: ``RegistrationJob[]`` sorted by createdAt descending.
    """
    from stitch_backend.domains.registration.service import registration_service
    return [
        registration_service.to_frontend_dict(j)
        for j in registration_service.list_jobs()
    ]


@register_command("get_registration_job")
async def cmd_get_registration_job(params: dict) -> dict:
    """Get a specific registration job by ID.

    Params: ``jobId``
    Returns: ``RegistrationJob``
    """
    from stitch_backend.domains.registration.service import registration_service
    job_id = params.get("jobId", "")
    job = registration_service.get_job(job_id)
    if not job:
        return {
            "id": job_id, "status": "unknown", "provider": "",
            "step": "", "progress": 0, "email": "", "error": None,
            "createdAt": None, "completedAt": None,
        }
    return registration_service.to_frontend_dict(job)


@register_command("clear_registration_jobs")
async def cmd_clear_registration_jobs(params: dict) -> None:
    """Clear completed/failed registration jobs.

    Params: ``status`` (optional) — clear only jobs with this status.
    """
    from stitch_backend.domains.registration.service import registration_service
    status = params.get("status")
    registration_service.clear_jobs(status)


@register_command("get_registration_status")
async def cmd_get_registration_status(params: dict) -> dict:
    """Get current registration status.

    Returns the most recent running/completed job's status.
    """
    from stitch_backend.domains.registration.service import registration_service
    # Find the most recent running job, or the most recent job overall
    running = [
        j for j in registration_service.list_jobs()
        if j.get("state") == "running"
    ]
    if running:
        job = running[0]
        return {
            "isRunning": True,
            "success": None,
            "status": "running",
            "provider": job.get("provider"),
            "email": job.get("email"),
            "step": job.get("step"),
            "progress": job.get("progress"),
            "error": None,
            "startedAt": job.get("created_at"),
            "completedAt": None,
        }
    # Check the most recent completed job
    all_jobs = registration_service.list_jobs()
    if all_jobs:
        job = all_jobs[0]
        success = job.get("state") == "succeeded"
        return {
            "isRunning": False,
            "success": success,
            "status": job.get("state"),
            "provider": job.get("provider"),
            "email": job.get("email"),
            "step": job.get("step", "done"),
            "progress": job.get("progress", 100),
            "error": job.get("error"),
            "startedAt": job.get("created_at"),
            "completedAt": job.get("completed_at"),
        }
    return {
        "isRunning": False, "success": None, "status": None,
        "provider": None, "email": None, "step": None,
        "progress": None, "error": None,
        "startedAt": None, "completedAt": None,
    }


@register_command("get_cloakbrowser_path")
async def cmd_get_cloakbrowser_path(params: dict) -> str | None:
    """Resolve bundled CloakBrowser executable path."""
    from stitch_backend.config import get_settings
    import os
    settings = get_settings()
    cloak_dir = settings.cloakbrowser_dir
    exe_name = "chrome.exe" if os.name == "nt" else "chrome"
    path = os.path.join(cloak_dir, exe_name)
    if os.path.exists(path):
        return path
    # Walk up directories (like Rust version)
    current = os.path.dirname(os.path.abspath(__file__))
    for _ in range(5):
        candidate = os.path.join(current, "resources", "cloakbrowser", exe_name)
        if os.path.exists(candidate):
            return candidate
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    return None


@register_command("toggle_fireworks_pause")
async def cmd_toggle_fireworks_pause(params: dict) -> dict:
    """Toggle pause state for Fireworks registration."""
    # Fireworks pause is managed via pipeline control signals
    job_id = params.get("jobId", "")
    paused = params.get("paused", False)
    command = "pause" if paused else "resume"
    from stitch_backend.domains.python_jobs.service import get_job_manager
    if job_id:
        get_job_manager().send_control(job_id, command, None)
    return {"paused": paused}


@register_command("authorize_kiro_account")
async def cmd_authorize_kiro_account(params: dict) -> dict:
    """Authorize a Kiro account via existing AWS session OAuth."""
    from stitch_backend.domains.registration.service import registration_service

    account_id = params.get("accountId", "")
    headless = params.get("headless", False)
    config = {
        "account_id": account_id,
        "headless": headless,
        "launch_mode": "kiro_oauth_only_existing_session",
    }
    job_id = await registration_service.submit("kiro_v2", config)
    return {"jobId": job_id}


# ── V2 Orchestrator ────────────────────────────────────────────────────────

@register_command("start_registration_v2_command")
async def cmd_start_registration_v2(params: dict) -> dict:
    """Start Registration V2 flow via in-process provider."""
    from stitch_backend.domains.registration.service import registration_service

    req = params.get("params", params)
    job_id = await registration_service.submit("kiro_v2", req)
    return {"success": True, "jobId": job_id, "email": req.get("email", "")}


# ── Counters ───────────────────────────────────────────────────────────────

@register_command("get_next_counter")
async def cmd_get_next_counter(params: dict) -> int:
    """Get next counter value for email generation."""
    from sqlalchemy import text as sql_text
    from stitch_backend.database import run_in_session

    provider = params.get("provider", "")
    strategy = params.get("strategy", "")
    key = f"{provider}:{strategy}"

    async def _op(session):
        try:
            # Atomic upsert: insert or increment in a single statement
            await session.execute(
                sql_text(
                    "INSERT INTO counters (key, value) VALUES (:k, 1) "
                    "ON CONFLICT(key) DO UPDATE SET value = value + 1"
                ),
                {"k": key},
            )
            result = await session.execute(
                sql_text("SELECT value FROM counters WHERE key = :k"),
                {"k": key},
            )
            row = result.fetchone()
            return int(row.value) if row else 1
        except Exception:
            return 1

    return await run_in_session(_op)


@register_command("check_python_autoreg")
async def cmd_check_python_autoreg(params: dict) -> bool:
    """Check if Python and DrissionPage are available for autoreg."""
    return shutil.which("python") is not None or shutil.which("python3") is not None
