"""Shared helpers for service plugins (SQLite connect, caller id, row visibility)."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any


def connect_plugin_db(db_path: str) -> sqlite3.Connection:
    """Open a SQLite connection with WAL mode for concurrent reads."""
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def resolve_owner_id(params: dict[str, Any]) -> int | None:
    """Caller user id from ``caller_user_id``, falling back to ``owner_id``."""
    uid = params.get("caller_user_id")
    if uid is None:
        uid = params.get("owner_id")
    return int(uid) if uid is not None else None


def visible_where(uid: int | None) -> tuple[str, list]:
    """SQL fragment + params for rows visible to ``uid`` (None = legacy rows only)."""
    if uid is None:
        return "owner_id IS NULL", []
    return "owner_id IS NULL OR owner_id = ?", [uid]
