"""SQLAlchemy async engine, session factory, and declarative base."""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

from sqlalchemy import event
from sqlalchemy import inspect as _sa_inspect
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from stitch_backend.config import get_settings

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine


logger = logging.getLogger(__name__)


# ── Declarative base ──────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    """Base class for all ORM models in the project."""
    pass


# ── Engine / session factory ──────────────────────────────────────────────────

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def _get_engine() -> AsyncEngine:
    """Build (or return cached) async engine."""
    global _engine  # noqa: PLW0603
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(
            settings.database_url,
            echo=settings.db_echo,
            # SQLite-specific: use WAL mode for concurrent reads
            connect_args={"check_same_thread": False},
            pool_pre_ping=True,
        )

        # Enable WAL journal mode for better concurrency
        @event.listens_for(_engine.sync_engine, "connect")
        def _set_sqlite_pragma(dbapi_conn, _connection_record):  # type: ignore[no-untyped-def]
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.close()

    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return (and lazily create) the global session factory."""
    global _session_factory  # noqa: PLW0603
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            bind=_get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
        )
    return _session_factory


# ── FastAPI dependency ────────────────────────────────────────────────────────

@asynccontextmanager
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield a scoped session; auto-commit on success, rollback on error.

    Usage as a FastAPI dependency:
        async def my_endpoint(db: AsyncSession = Depends(get_db)):
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


# ── Standalone command helper ──────────────────────────────────────────────────

from collections.abc import Callable, Coroutine

async def run_in_session(
    fn: Callable[[AsyncSession], Coroutine[Any, Any, Any]],
) -> Any:
    """Execute *fn(session)* inside a managed session with auto-commit/rollback.

    This is the preferred pattern for command handlers::

        result = await run_in_session(lambda s: MyService(s).do_thing())
    """
    factory = get_session_factory()
    async with factory() as session:
        try:
            result = await fn(session)
            await session.commit()
            return result
        except Exception:
            await session.rollback()
            raise


# ── Table creation (dev / first run) ──────────────────────────────────────────

async def create_all_tables() -> None:
    """Create missing tables and add missing columns to existing ones.

    ``Base.metadata.create_all`` only creates tables that don't exist — it
    never alters an existing table.  Because the SQLite database may have been
    created by the legacy Rust backend (different/older schema), we follow up
    with a lightweight, non-destructive column migration that ``ALTER TABLE
    ADD COLUMN`` for any column the ORM expects but the DB lacks.  Use Alembic
    for anything more involved.
    """
    engine = _get_engine()
    async with engine.begin() as conn:
        # Import all model modules so Base.metadata is populated
        import stitch_backend.domains.accounts.models  # noqa: F401
        import stitch_backend.domains.settings.models  # noqa: F401
        import stitch_backend.domains.profiles.models  # noqa: F401
        import stitch_backend.domains.email_counter.models  # noqa: F401
        import stitch_backend.domains.composed_flows.models  # noqa: F401
        import stitch_backend.domains.email_inbox.models      # noqa: F401
        import stitch_backend.domains.logging.models           # noqa: F401
        import stitch_backend.domains.totp.models              # noqa: F401
        import stitch_backend.domains.icloud_email_pool.models  # noqa: F401
        import stitch_backend.domains.key_health.models  # noqa: F401
        import stitch_backend.domains.ai_gateway.models  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns)


def _add_missing_columns(sync_conn: Any) -> None:
    """Add ORM-declared columns missing from existing SQLite tables.

    Runs inside ``conn.run_sync`` so it operates on a synchronous connection.
    Only adds columns — never drops or alters existing ones — so it is safe to
    run on every startup.
    """
    from sqlalchemy.schema import CreateColumn

    inspector = _sa_inspect(sync_conn)
    existing_tables = set(inspector.get_table_names())
    dialect = sync_conn.dialect

    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue  # create_all already handled brand-new tables

        db_columns = {col["name"] for col in inspector.get_columns(table.name)}

        for column in table.columns:
            if column.name in db_columns:
                continue
            # SQLite ALTER TABLE ADD COLUMN cannot add a PRIMARY KEY column.
            if column.primary_key:
                continue

            col_spec = CreateColumn(column).compile(dialect=dialect).string

            # SQLite refuses "ADD COLUMN ... NOT NULL" without a constant
            # DEFAULT.  Supply one derived from the column's Python/server
            # default, otherwise relax to a nullable column.
            if not column.nullable and "DEFAULT" not in col_spec.upper():
                default_literal = _constant_default_sql(column)
                if default_literal is not None:
                    col_spec += f" DEFAULT {default_literal}"
                else:
                    # No safe constant default — add as nullable so the
                    # ALTER succeeds; ORM defaults still apply on insert.
                    col_spec = col_spec.replace(" NOT NULL", "")

            ddl = f'ALTER TABLE "{table.name}" ADD COLUMN {col_spec}'
            try:
                sync_conn.exec_driver_sql(ddl)
                logger.info("Migrated: added column %s.%s", table.name, column.name)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Could not add column %s.%s automatically (%s). "
                    "Manual migration may be required.",
                    table.name, column.name, exc,
                )


def _constant_default_sql(column: Any) -> str | None:
    """Return a constant SQL literal for a column's default, or ``None``.

    Only handles plain scalar defaults (bool/int/float/str).  Callable or
    SQL-expression defaults are not safe as ALTER-time constants.

    JSON columns are treated specially: their ``python_type`` raises
    ``NotImplementedError``, so we check for them explicitly and return
    ``NULL`` — SQLite accepts NULL as a default for any type affinity and
    the ORM supplies the real Python value on every INSERT.
    """
    from sqlalchemy import JSON

    default = getattr(column, "default", None)
    if default is None:
        # JSON columns have no reliable python_type — return NULL so
        # ALTER TABLE succeeds and the column is added as nullable.
        if isinstance(column.type, JSON):
            return "NULL"

        # Fall back to a type-appropriate zero value for NOT NULL columns.
        try:
            py_type = column.type.python_type
        except NotImplementedError:
            return None

        if py_type is bool:
            return "0"
        if py_type in (int, float):
            return "0"
        if py_type is str:
            return "''"
        return None

    if not getattr(default, "is_scalar", False):
        return None  # callable / sequence — not a constant

    value = default.arg
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        escaped = value.replace("'", "''")
        return f"'{escaped}'"
    return None


# ── Teardown ──────────────────────────────────────────────────────────────────

async def dispose_engine() -> None:
    """Dispose the engine and close all pooled connections."""
    global _engine, _session_factory  # noqa: PLW0603
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None
