"""Composed flows service — CRUD for saved composed flows.

Ported from Rust ``composed_flows.rs`` and ``python_jobs.rs``.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import or_, select, text
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from stitch_backend.domains.composed_flows.models import ComposedFlow

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")


def _row_to_dict(row: ComposedFlow) -> dict[str, Any]:
    return {
        "id": row.id,
        "alias": row.alias,
        "name": row.name,
        "flowJson": row.flow_json,
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
        "lastRunAt": row.last_run_at,
        "runCount": row.run_count,
    }


class ComposedFlowService:
    """CRUD for saved composed flows."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def upsert(
        self,
        alias: str,
        name: str,
        flow_json: str,
        flow_id: str | None = None,
        owner_id: int | None = None,
    ) -> dict[str, Any]:
        """Insert or update a composed flow. Returns the saved row."""
        alias = alias.strip()
        name = name.strip()
        flow_json = flow_json.strip()
        if not alias:
            raise ValueError("alias is required")
        if not name:
            raise ValueError("name is required")
        if not flow_json:
            raise ValueError("flowJson is required")

        fid = (flow_id or "").strip() or f"flow_{uuid.uuid4()}"
        now = _now()

        # On conflict, preserve the existing owner_id (do not let a different
        # caller hijack a shared/legacy row by re-upserting under their id).
        # New rows get owner_id = caller's uid (None on desktop → NULL).
        stmt = sqlite_insert(ComposedFlow).values(
            id=fid, alias=alias, name=name, flow_json=flow_json,
            owner_id=owner_id, created_at=now, updated_at=now,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["id"],
            set_={
                "alias": alias, "name": name,
                "flow_json": flow_json, "updated_at": now,
            },
        )
        await self._db.execute(stmt)
        await self._db.flush()

        result = await self._db.execute(
            select(ComposedFlow).where(ComposedFlow.id == fid)
        )
        return _row_to_dict(result.scalar_one())

    async def list_by_alias(
        self, alias: str, limit: int = 50,
        owner_id: int | None = None,
    ) -> list[dict[str, Any]]:
        """List composed flows for an alias, newest first."""
        alias = alias.strip()
        if not alias:
            raise ValueError("alias is required")
        limit = max(1, min(limit, 500))

        result = await self._db.execute(
            select(ComposedFlow)
            .where(
                ComposedFlow.alias == alias,
                or_(
                    ComposedFlow.owner_id.is_(None),
                    ComposedFlow.owner_id == owner_id,
                ),
            )
            .order_by(ComposedFlow.updated_at.desc())
            .limit(limit)
        )
        return [_row_to_dict(r) for r in result.scalars().all()]

    async def delete_by_id(
        self, flow_id: str, owner_id: int | None = None,
    ) -> None:
        """Delete a composed flow by ID."""
        flow_id = flow_id.strip()
        if not flow_id:
            raise ValueError("flowId is required")
        await self._db.execute(
            text(
                "DELETE FROM composed_flows "
                "WHERE id = :id AND (owner_id IS NULL OR owner_id = :uid)"
            ),
            {"id": flow_id, "uid": owner_id},
        )
        await self._db.flush()

    async def mark_ran(
        self, flow_id: str, owner_id: int | None = None,
    ) -> None:
        """Mark a flow as having been run (increment run_count)."""
        import time
        flow_id = flow_id.strip()
        if not flow_id:
            raise ValueError("flowId is required")
        now_ts = int(time.time())
        await self._db.execute(
            text(
                "UPDATE composed_flows "
                "SET last_run_at = :ts, "
                "    run_count = COALESCE(run_count, 0) + 1, "
                "    updated_at = datetime('now') "
                "WHERE id = :id AND (owner_id IS NULL OR owner_id = :uid)"
            ),
            {"ts": now_ts, "id": flow_id, "uid": owner_id},
        )
        await self._db.flush()
