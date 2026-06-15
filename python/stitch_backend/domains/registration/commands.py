"""Registration domain command handlers."""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command


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
