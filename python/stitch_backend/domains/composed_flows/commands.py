"""Composed flows command handlers."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

from stitch_backend.core.command_decorator import command


def _caller_uid(params: dict) -> int | None:
    """Extract the caller's user ID (None when auth disabled / desktop)."""
    return params.get("_caller_user_id")


@command("upsert_composed_flow")
async def cmd_upsert_composed_flow(db: AsyncSession, params: dict) -> dict:
    """Create or update a composed flow."""
    from stitch_backend.domains.composed_flows.service import ComposedFlowService

    alias = params.get("alias", "")
    name = params.get("name", "")
    flow_json = params.get("flowJson", params.get("flow_json", ""))
    flow_id = params.get("id")
    owner_id = _caller_uid(params)

    svc = ComposedFlowService(db)
    return await svc.upsert(alias, name, flow_json, flow_id, owner_id=owner_id)


@command("list_composed_flows", readonly=True)
async def cmd_list_composed_flows(db: AsyncSession, params: dict) -> list:
    """List composed flows for an alias."""
    from stitch_backend.domains.composed_flows.service import ComposedFlowService

    alias = params.get("alias", "")
    limit = int(params.get("limit", 50))
    owner_id = _caller_uid(params)

    svc = ComposedFlowService(db)
    return await svc.list_by_alias(alias, limit, owner_id=owner_id)


@command("delete_composed_flow")
async def cmd_delete_composed_flow(db: AsyncSession, params: dict) -> dict:
    """Delete a composed flow by ID."""
    from stitch_backend.domains.composed_flows.service import ComposedFlowService

    flow_id = params.get("flowId", params.get("flow_id", ""))
    owner_id = _caller_uid(params)

    svc = ComposedFlowService(db)
    await svc.delete_by_id(flow_id, owner_id=owner_id)
    return {"success": True}


@command("mark_composed_flow_ran")
async def cmd_mark_composed_flow_ran(db: AsyncSession, params: dict) -> dict:
    """Mark a composed flow as having been run."""
    from stitch_backend.domains.composed_flows.service import ComposedFlowService

    flow_id = params.get("flowId", params.get("flow_id", ""))
    owner_id = _caller_uid(params)

    svc = ComposedFlowService(db)
    await svc.mark_ran(flow_id, owner_id=owner_id)
    return {"success": True}
