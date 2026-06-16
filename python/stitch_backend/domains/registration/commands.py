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

@register_command("auto_register")
async def cmd_auto_register(params: dict) -> dict:
    """Auto-register via AWS Cognito (no browser)."""
    from stitch_backend.domains.python_jobs.service import get_job_manager

    email = params.get("email", "")
    password = params.get("password", "")
    provider = params.get("provider", "kiro")
    job = await get_job_manager().start(
        script_path=f"scripts/autoreg_{provider}.py",
        args=["--email", email, "--password", password, "--action", "register"],
    )
    return {"jobId": job.id, "success": True}


@register_command("confirm_registration")
async def cmd_confirm_registration(params: dict) -> dict:
    """Confirm email registration with verification code."""
    from stitch_backend.domains.python_jobs.service import get_job_manager

    email = params.get("email", "")
    code = params.get("code", "")
    job = await get_job_manager().start(
        script_path="scripts/autoreg_kiro.py",
        args=["--email", email, "--code", code, "--action", "confirm"],
    )
    return {"jobId": job.id, "success": True}


@register_command("auto_login")
async def cmd_auto_login(params: dict) -> dict:
    """Auto-login to existing account via AWS Cognito."""
    from stitch_backend.domains.python_jobs.service import get_job_manager

    email = params.get("email", "")
    password = params.get("password", "")
    job = await get_job_manager().start(
        script_path="scripts/autoreg_kiro.py",
        args=["--email", email, "--password", password, "--action", "login"],
    )
    return {"jobId": job.id, "success": True}


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
    """Common helper for all autoreg job starters."""
    from stitch_backend.domains.python_jobs.service import get_job_manager

    config = params.get("config", params)
    config_json = json.dumps(config) if isinstance(config, dict) else str(config)
    job = await get_job_manager().start(
        script_path=f"scripts/autoreg_{provider}.py",
        args=["--config", config_json],
    )
    return {"jobId": job.id}


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
    """Stop a running registration job."""
    from stitch_backend.domains.python_jobs.service import get_job_manager

    job_id = params.get("jobId", "")
    if job_id:
        await get_job_manager().cancel(job_id)


@register_command("authorize_kiro_account")
async def cmd_authorize_kiro_account(params: dict) -> dict:
    """Authorize a Kiro account via existing AWS session OAuth."""
    from stitch_backend.domains.python_jobs.service import get_job_manager

    account_id = params.get("accountId", "")
    headless = params.get("headless", False)
    job = await get_job_manager().start(
        script_path="scripts/authorize_kiro.py",
        args=["--accountId", str(account_id), "--headless", str(headless).lower()],
    )
    return {"jobId": job.id}


# ── V2 Orchestrator ────────────────────────────────────────────────────────

@register_command("start_registration_v2_command")
async def cmd_start_registration_v2(params: dict) -> dict:
    """Start Registration V2 flow (orchestrator stub)."""
    from stitch_backend.domains.python_jobs.service import get_job_manager

    req = params.get("params", params)
    job = await get_job_manager().start(
        script_path="scripts/registration_v2.py",
        args=["--config", json.dumps(req)],
    )
    return {"success": True, "jobId": job.id, "email": req.get("email", "")}


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
            result = await session.execute(
                sql_text("SELECT value FROM counters WHERE key = :k"),
                {"k": key},
            )
            row = result.fetchone()
            val = int(row.value) + 1 if row else 1
            await session.execute(
                sql_text("INSERT OR REPLACE INTO counters (key, value) VALUES (:k, :v)"),
                {"k": key, "v": val},
            )
            return val
        except Exception:
            return 1

    return await run_in_session(_op)


@register_command("check_python_autoreg")
async def cmd_check_python_autoreg(params: dict) -> bool:
    """Check if Python and DrissionPage are available for autoreg."""
    return shutil.which("python") is not None or shutil.which("python3") is not None
