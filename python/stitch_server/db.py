"""SQLAlchemy async engine, session factory, and declarative base.

Mirrors ``stitch_backend/database.py`` patterns: WAL journal mode,
async_sessionmaker, get_db() FastAPI dependency, create_all_tables().
Simplified to a single engine (no read/write split) — the plugin server
is a thin VPS app with low concurrency.

Includes a lightweight idempotent migration step (``_ensure_column``)
run inside ``create_all_tables()`` AFTER ``Base.metadata.create_all`` —
for SQLite, checks existing columns via PRAGMA table_info and ALTER
TABLE ADD COLUMN for each missing column on legacy DBs.  No Alembic.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from stitch_server.config import get_settings

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    from sqlalchemy.engine import Connection


class Base(DeclarativeBase):
    """Base class for all ORM models in the plugin server."""


_engine = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine():
    """Build (or return cached) async engine with WAL pragmas."""
    global _engine  # noqa: PLW0603
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(
            settings.database_url,
            echo=settings.db_echo,
            pool_pre_ping=True,
            connect_args={"check_same_thread": False},
        )

        @event.listens_for(_engine.sync_engine, "connect")
        def _set_pragma(dbapi_conn, _connection_record):
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return (and lazily create) the session factory."""
    global _session_factory  # noqa: PLW0603
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            bind=get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
        )
    return _session_factory


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield a scoped session; auto-commit on success, rollback on error.

    Usage as a FastAPI dependency::

        async def endpoint(db: AsyncSession = Depends(get_db)):
            ...
    """
    factory = get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def create_all_tables() -> None:
    """Create all tables that don't exist yet (dev convenience).

    After ``Base.metadata.create_all`` runs, applies a lightweight
    idempotent migration step that ALTER-TABLEs missing columns onto
    legacy SQLite DBs (see ``_migrate_activation_codes``).  This is a
    no-op on fresh DBs (every column already exists) and safe to run
    every startup.
    """
    import stitch_server.models  # noqa: F401 — populate Base.metadata

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_migrate_activation_codes)


# ── Lightweight idempotent migrations (no Alembic) ─────────────────────────────


def _ensure_column(conn: Connection, table: str, column: str, ddl: str) -> None:
    """Add ``column`` to ``table`` if it does not already exist.

    Uses SQLite's ``PRAGMA table_info`` to list existing columns, then
    ``ALTER TABLE ... ADD COLUMN ...`` for the missing one.  Idempotent:
    a no-op when the column already exists.  Safe to run every startup.

    ``ddl`` is the column DDL fragment, e.g. ``"BOOLEAN NOT NULL DEFAULT 0"``
    or ``"DATETIME"`` or ``"BIGINT"`` — appended verbatim after
    ``ALTER TABLE <table> ADD COLUMN <column> ``.

    SECURITY: ``table``, ``column``, and ``ddl`` are interpolated into raw
    SQL and MUST be hardcoded identifier/DDL literals, never user input —
    there is no quoting/escaping here.  Currently only called from
    :func:`_migrate_activation_codes` with constants.
    """
    col_rows = conn.exec_driver_sql(f"PRAGMA table_info({table})").fetchall()
    # PRAGMA table_info returns (cid, name, type, notnull, dflt_value, pk).
    existing = {row[1] for row in col_rows}
    if column not in existing:
        conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


def _migrate_activation_codes(conn: Connection) -> None:
    """Add hardening columns to ``ss_activation_codes`` on legacy DBs.

    Adds: ``expires_at DATETIME``, ``revoked BOOLEAN NOT NULL DEFAULT 0``,
    ``tg_user_id BIGINT``, ``label VARCHAR``.  No-op on fresh DBs where
    ``Base.metadata.create_all`` already created them.  Existing rows
    pick up the column defaults (``revoked=0``, NULL for the others).
    """
    # Guard: if the table doesn't exist yet, create_all already made it
    # with all columns — nothing to migrate.
    tbl = conn.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='ss_activation_codes'"
    ).fetchone()
    if tbl is None:
        return
    _ensure_column(conn, "ss_activation_codes", "expires_at", "DATETIME")
    _ensure_column(conn, "ss_activation_codes", "revoked", "BOOLEAN NOT NULL DEFAULT 0")
    _ensure_column(conn, "ss_activation_codes", "tg_user_id", "BIGINT")
    _ensure_column(conn, "ss_activation_codes", "label", "VARCHAR")
    _ensure_column(conn, "ss_activation_codes", "tg_admin", "BOOLEAN NOT NULL DEFAULT 0")


async def dispose_engine() -> None:
    """Dispose the engine and close all pooled connections."""
    global _engine, _session_factory  # noqa: PLW0603
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None
