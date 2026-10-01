"""OpenCode provider import (opencode.json + auth.json → gateway catalog)."""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command
from stitch_backend.core.exceptions import StitchError
from stitch_backend.database import run_in_read_session, run_in_session
from stitch_backend.domains.ai_gateway.commands._common import _caller_uid


@register_command("import_opencode_providers")
async def cmd_import_opencode_providers(params: dict) -> dict:
    """Import providers from the OpenCode config into the AI Gateway.

    Reads ``~/.config/opencode/opencode.json`` (+ ``auth.json``), creates
    endpoints/credentials/upstream models, and auto-wires one PublicModel
    per distinct declared model with route targets to every imported
    instance — N accounts serving the same model appear as ONE public
    model.  Optional ``groupId`` shares every imported credential into
    that group; optional ``providers`` (list of names) limits the import.
    """
    from stitch_backend.domains.ai_gateway.opencode_import import (
        import_opencode_providers,
        parse_opencode_providers,
        read_opencode_auth,
    )
    from stitch_backend.domains.plugin_runtime.bridge import call_plugin_command

    uid = _caller_uid(params)
    group_id = params.get("groupId")
    only = params.get("providers")
    if only is not None and not (
        isinstance(only, list) and all(isinstance(n, str) for n in only)
    ):
        raise StitchError("providers must be a list of provider names")

    if group_id is not None:
        # Fail fast before any DB writes; lazy import keeps the ai_gateway → groups edge cut.
        from stitch_backend.domains.groups.service import get_group, is_member

        async def _check(session):
            group = await get_group(session, group_id)
            if group is None:
                raise StitchError("Group not found")
            if not await is_member(session, group_id, uid):
                raise StitchError("Not a member of this group")

        await run_in_read_session(_check)

    # The bridge raises HTTPException (404/403/504/400) — a clean structured error, no fallback.
    config = await call_plugin_command(
        "plugin.stitch-opencode.get_opencode_config", params
    )
    if not isinstance(config, dict):
        raise StitchError("stitch-opencode returned an invalid opencode config")
    auth = await read_opencode_auth()
    providers, skipped = parse_opencode_providers(config, auth)
    if only:
        wanted = set(only)
        providers = [p for p in providers if p.name in wanted]

    if not providers:
        return {
            "imported": [],
            "skipped": skipped,
            "models": [],
            "public_models": [],
            "shared_to_group": group_id,
        }

    async def _op(session):
        return await import_opencode_providers(
            session, providers, owner_id=uid, share_group_id=group_id,
        )

    report: dict = await run_in_session(_op)
    report["skipped"] = skipped
    return report
