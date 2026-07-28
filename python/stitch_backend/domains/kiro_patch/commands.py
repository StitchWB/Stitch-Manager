"""Kiro Patch command handlers — 6 commands.

Ported from Rust ``commands/kiro_patch.rs``.
"""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command


@register_command("save_kiro_patch_config")
async def cmd_save_config(params: dict) -> None:
    """Save Kiro Patch V3 configuration."""
    from stitch_backend.domains.kiro_patch import service
    config = params.get("config", params)
    service.save_config(config)


@register_command("apply_kiro_patch_with_config")
async def cmd_apply_patch(params: dict) -> str:
    """Apply Kiro Patch with configuration."""
    from stitch_backend.domains.kiro_patch import service
    config = params.get("config", params)
    return service.apply_patch_with_config(config)


@register_command("check_kiro_patch_status")
async def cmd_check_status(params: dict) -> dict[str, bool]:
    """Check if Kiro Patch is installed (marker + proxy injection)."""
    from stitch_backend.domains.kiro_patch import service
    return service.check_patch_status()


@register_command("remove_kiro_patch")
async def cmd_remove_patch(params: dict) -> str:
    """Remove Kiro Patch."""
    from stitch_backend.domains.kiro_patch import service
    return service.remove_patch()


@register_command("bind_machine_id_to_account")
async def cmd_bind_machine_id(params: dict) -> None:
    """Bind a machine ID to an account."""
    from stitch_backend.domains.kiro_patch import service
    account_id = str(params.get("accountId", params.get("account_id", "")))
    machine_id = str(params.get("machineId", params.get("machine_id", "")))
    service.bind_machine_id(account_id, machine_id)


@register_command("unbind_account")
async def cmd_unbind_account(params: dict) -> None:
    """Unbind an account from its machine ID."""
    from stitch_backend.domains.kiro_patch import service
    account_id = str(params.get("accountId", params.get("account_id", "")))
    service.unbind_account(account_id)


@register_command("generate_new_machine_id")
async def cmd_generate_new_machine_id(params: dict) -> str:
    """Generate a new random machine ID."""
    import uuid
    return uuid.uuid4().hex


@register_command("get_kiro_patch_config")
async def cmd_get_kiro_patch_config(params: dict) -> dict:
    """Read Kiro Patch V3 configuration from disk."""
    from stitch_backend.domains.kiro_patch import service
    return service.get_config()
