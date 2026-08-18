"""Activation domain command handlers."""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command


@register_command("generate_machine_id")
async def cmd_generate_machine_id(params: dict) -> dict:
    from stitch_backend.domains.activation.machine_id import generate_machine_id
    seed = params.get("seed", "")
    mid = generate_machine_id(seed)
    return {"machineId": mid}


@register_command("patch_machine_id")
async def cmd_patch_machine_id(params: dict) -> dict:
    from stitch_backend.domains.activation.machine_id import patch_machine_id
    return await patch_machine_id(
        account_id=params.get("accountId", ""),
        machine_id=params.get("machineId", ""),
        ide=params.get("ide", "kiro"),
    )


@register_command("write_sso_cache")
async def cmd_write_sso_cache(params: dict) -> dict:
    from stitch_backend.domains.activation.sso_cache import write_sso_cache
    return await write_sso_cache(
        ide=params.get("ide", "kiro"),
        account_id=params.get("accountId", ""),
        session_data=params.get("sessionData", {}),
    )


@register_command("clear_sso_cache")
async def cmd_clear_sso_cache(params: dict) -> dict:
    from stitch_backend.domains.activation.sso_cache import clear_sso_cache
    return await clear_sso_cache(
        ide=params.get("ide", "kiro"),
        account_id=params.get("accountId"),
    )


@register_command("restart_ide")
async def cmd_restart_ide(params: dict) -> dict:
    from stitch_backend.domains.activation.ide_restart import restart_ide
    return await restart_ide(ide=params.get("ide", "kiro"))
