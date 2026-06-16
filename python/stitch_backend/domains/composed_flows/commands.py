"""Composed flows command handlers."""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command
from stitch_backend.database import run_in_session


@register_command("upsert_composed_flow")
async def cmd_upsert_composed_flow(params: dict) -> dict:
    """Create or update a composed flow."""
    from stitch_backend.domains.composed_flows.service import ComposedFlowService

    alias = params.get("alias", "")
    name = params.get("name", "")
    flow_json = params.get("flowJson", params.get("flow_json", ""))
    flow_id = params.get("id")

    async def _op(session):
        svc = ComposedFlowService(session)
        return await svc.upsert(alias, name, flow_json, flow_id)

    return await run_in_session(_op)


@register_command("list_composed_flows")
async def cmd_list_composed_flows(params: dict) -> list:
    """List composed flows for an alias."""
    from stitch_backend.domains.composed_flows.service import ComposedFlowService

    alias = params.get("alias", "")
    limit = int(params.get("limit", 50))

    async def _op(session):
        svc = ComposedFlowService(session)
        return await svc.list_by_alias(alias, limit)

    return await run_in_session(_op)


@register_command("delete_composed_flow")
async def cmd_delete_composed_flow(params: dict) -> dict:
    """Delete a composed flow by ID."""
    from stitch_backend.domains.composed_flows.service import ComposedFlowService

    flow_id = params.get("flowId", params.get("flow_id", ""))

    async def _op(session):
        svc = ComposedFlowService(session)
        await svc.delete_by_id(flow_id)
        return {"success": True}

    return await run_in_session(_op)


@register_command("mark_composed_flow_ran")
async def cmd_mark_composed_flow_ran(params: dict) -> dict:
    """Mark a composed flow as having been run."""
    from stitch_backend.domains.composed_flows.service import ComposedFlowService

    flow_id = params.get("flowId", params.get("flow_id", ""))

    async def _op(session):
        svc = ComposedFlowService(session)
        await svc.mark_ran(flow_id)
        return {"success": True}

    return await run_in_session(_op)
