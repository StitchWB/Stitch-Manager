"""AWS Builder ID accounts service — CRUD on ``aws_accounts`` table.

Mirrors the Rust ``database/aws_accounts.rs`` module.

Table schema (from migration 007)::

    id, email, password, name, status, browser_profile_path,
    cookies, session_data, use_count, last_used_at,
    created_at, updated_at, notes, metadata
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_ROW_COLS = [
    "id", "email", "password", "name", "status", "browserProfilePath",
    "useCount", "lastUsedAt", "createdAt", "updatedAt", "notes",
]


def _row_to_dict(row: Any) -> dict[str, Any]:
    """Map a raw SQLAlchemy row to a camelCase dict matching the frontend AwsAccount type."""
    mapping = {
        "id": row[0],
        "email": row[1],
        "password": row[2],
        "name": row[3],
        "status": row[4],
        "browserProfilePath": row[5],
        "useCount": row[6],
        "lastUsedAt": row[7],
        "createdAt": row[8],
        "updatedAt": row[9],
        "notes": row[10],
    }
    return mapping


class AwsAccountsService:
    """CRUD operations for the ``aws_accounts`` table."""

    def __init__(self, session: AsyncSession) -> None:
        self._db = session

    async def _ensure_table(self) -> None:
        await self._db.execute(text(
            "CREATE TABLE IF NOT EXISTS aws_accounts ("
            "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
            "  email TEXT NOT NULL UNIQUE,"
            "  password TEXT NOT NULL,"
            "  name TEXT,"
            "  status TEXT NOT NULL DEFAULT 'active',"
            "  browser_profile_path TEXT,"
            "  cookies TEXT,"
            "  session_data TEXT,"
            "  use_count INTEGER NOT NULL DEFAULT 0,"
            "  last_used_at TEXT,"
            "  created_at TEXT NOT NULL DEFAULT (datetime('now')),"
            "  updated_at TEXT,"
            "  notes TEXT,"
            "  metadata TEXT"
            ")"
        ))
        await self._db.flush()

    async def get_all(self, status_filter: str | None = None) -> list[dict[str, Any]]:
        await self._ensure_table()
        if status_filter:
            r = await self._db.execute(
                text("SELECT id,email,password,name,status,browser_profile_path,"
                     "use_count,last_used_at,created_at,updated_at,notes "
                     "FROM aws_accounts WHERE status = :s ORDER BY created_at DESC"),
                {"s": status_filter},
            )
        else:
            r = await self._db.execute(text(
                "SELECT id,email,password,name,status,browser_profile_path,"
                "use_count,last_used_at,created_at,updated_at,notes "
                "FROM aws_accounts ORDER BY created_at DESC"
            ))
        return [_row_to_dict(row) for row in r.fetchall()]

    async def get_available(self) -> list[dict[str, Any]]:
        return await self.get_all(status_filter="active")

    async def get_by_id(self, account_id: int) -> dict[str, Any] | None:
        await self._ensure_table()
        r = await self._db.execute(
            text("SELECT id,email,password,name,status,browser_profile_path,"
                 "use_count,last_used_at,created_at,updated_at,notes "
                 "FROM aws_accounts WHERE id = :id"),
            {"id": account_id},
        )
        row = r.first()
        return _row_to_dict(row) if row else None

    async def create(self, data: dict[str, Any]) -> dict[str, Any]:
        await self._ensure_table()
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        r = await self._db.execute(
            text(
                "INSERT INTO aws_accounts (email, password, name, status, browser_profile_path, created_at) "
                "VALUES (:email, :password, :name, :status, :bpp, :now)"
            ),
            {
                "email": data["email"],
                "password": data["password"],
                "name": data.get("name"),
                "status": data.get("status", "active"),
                "bpp": data.get("browserProfilePath", data.get("browser_profile_path")),
                "now": now,
            },
        )
        await self._db.flush()
        new_id = r.lastrowid
        result = await self.get_by_id(new_id)
        return result or {"id": new_id, "email": data["email"]}

    async def update_status(self, account_id: int, status: str) -> None:
        await self._ensure_table()
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        await self._db.execute(
            text("UPDATE aws_accounts SET status = :s, updated_at = :now WHERE id = :id"),
            {"s": status, "now": now, "id": account_id},
        )
        await self._db.flush()

    async def increment_use_count(self, account_id: int) -> None:
        await self._ensure_table()
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        await self._db.execute(
            text("UPDATE aws_accounts SET use_count = use_count + 1, "
                 "last_used_at = :now, updated_at = :now WHERE id = :id"),
            {"now": now, "id": account_id},
        )
        await self._db.flush()

    async def update_browser_profile(self, account_id: int, profile_path: str) -> None:
        await self._ensure_table()
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        await self._db.execute(
            text("UPDATE aws_accounts SET browser_profile_path = :p, updated_at = :now WHERE id = :id"),
            {"p": profile_path, "now": now, "id": account_id},
        )
        await self._db.flush()

    async def delete(self, account_id: int) -> None:
        await self._ensure_table()
        await self._db.execute(
            text("DELETE FROM aws_accounts WHERE id = :id"),
            {"id": account_id},
        )
        await self._db.flush()

    async def count_by_status(self) -> list[dict[str, Any]]:
        await self._ensure_table()
        r = await self._db.execute(text(
            "SELECT status, COUNT(*) as cnt FROM aws_accounts GROUP BY status"
        ))
        return [{"status": row[0], "count": row[1]} for row in r.fetchall()]
