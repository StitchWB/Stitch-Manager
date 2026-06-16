"""Composed flows service — CRUD for saved composed flows.

Ported from Rust ``composed_flows.rs`` and ``python_jobs.rs``.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from stitch_backend.domains.composed_flows.models import ComposedFlow

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


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

        fid = (flow_id or "").strip() or str(uuid.uuid4())
        now = _now()

        stmt = sqlite_insert(ComposedFlow).values(
            id=fid, alias=alias, name=name, flow_json=flow_json,
            created_at=now, updated_at=now,
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
    ) -> list[dict[str, Any]]:
        """List composed flows for an alias, newest first."""
        alias = alias.strip()
        if not alias:
            raise ValueError("alias is required")
        limit = max(1, min(limit, 500))

        result = await self._db.execute(
            select(ComposedFlow)
            .where(ComposedFlow.alias == alias)
            .order_by(ComposedFlow.updated_at.desc())
            .limit(limit)
        )
        return [_row_to_dict(r) for r in result.scalars().all()]

    async def delete_by_id(self, flow_id: str) -> None:
        """Delete a composed flow by ID."""
        flow_id = flow_id.strip()
        if not flow_id:
            raise ValueError("flowId is required")
        await self._db.execute(
            text("DELETE FROM composed_flows WHERE id = :id"),
            {"id": flow_id},
        )
        await self._db.flush()

    async def mark_ran(self, flow_id: str) -> None:
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
                "WHERE id = :id"
            ),
            {"ts": now_ts, "id": flow_id},
        )
        await self._db.flush()
