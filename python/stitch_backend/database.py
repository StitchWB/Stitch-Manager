"""SQLAlchemy async engine, session factory, and declarative base."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any, TypeVar

from sqlalchemy import event
from sqlalchemy import inspect as _sa_inspect
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from stitch_backend.config import get_settings

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator, Callable, Coroutine

    from sqlalchemy.ext.asyncio import AsyncEngine


logger = logging.getLogger(__name__)

T = TypeVar("T")


# ── Declarative base ──────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    """Base class for all ORM models in the project."""
    pass


# ── Engine / session factory ──────────────────────────────────────────────────

_write_engine: AsyncEngine | None = None
_read_engine: AsyncEngine | None = None
_write_session_factory: async_sessionmaker[AsyncSession] | None = None
_read_session_factory: async_sessionmaker[AsyncSession] | None = None


def _get_write_engine() -> AsyncEngine:
    """Build (or return cached) write engine with single connection."""
    global _write_engine  # noqa: PLW0603
    if _write_engine is None:
        settings = get_settings()
        _write_engine = create_async_engine(
            settings.database_url,
            echo=settings.db_echo,
            pool_size=1,  # Single write connection — no contention by design
            max_overflow=0,
            pool_pre_ping=True,
            connect_args={"check_same_thread": False},
        )

        # Enable WAL journal mode and optimize for writes
        @event.listens_for(_write_engine.sync_engine, "connect")
        def _set_write_pragma(dbapi_conn, _connection_record):
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")  # Faster than FULL, safe with WAL
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return _write_engine


def _get_read_engine() -> AsyncEngine:
    """Build (or return cached) read engine with connection pool."""
    global _read_engine  # noqa: PLW0603
    if _read_engine is None:
        settings = get_settings()
        _read_engine = create_async_engine(
            settings.database_url,
            echo=settings.db_echo,
            pool_size=5,  # Multiple read connections
            max_overflow=10,
            pool_pre_ping=True,
            connect_args={"check_same_thread": False},
        )

    return _read_engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return (and lazily create) the write session factory (backward compatibility)."""
    global _write_session_factory  # noqa: PLW0603
    if _write_session_factory is None:
        _write_session_factory = async_sessionmaker(
            bind=_get_write_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
        )
    return _write_session_factory


def get_read_session_factory() -> async_sessionmaker[AsyncSession]:
    """Return (and lazily create) the read session factory."""
    global _read_session_factory  # noqa: PLW0603
    if _read_session_factory is None:
        _read_session_factory = async_sessionmaker(
            bind=_get_read_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
        )
    return _read_session_factory


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

import time as _time


async def run_in_session(
    fn: Callable[[AsyncSession], Coroutine[Any, Any, T]],
    *,
    max_retries: int = 3,
) -> T:
    """Execute *fn(session)* inside a managed WRITE session with auto-commit/rollback.

    Uses the single write connection (pool_size=1) to eliminate contention.
    Retries on transient "database is locked" errors with exponential backoff.

    This is the preferred pattern for command handlers::

        result = await run_in_session(lambda s: MyService(s).do_thing())
    """
    factory = get_session_factory()
    last_error: Exception | None = None
    start = _time.monotonic()

    for attempt in range(max_retries):
        try:
            async with factory() as session:
                result = await fn(session)
                await session.commit()

                # Monitoring: log slow operations
                elapsed = _time.monotonic() - start
                if elapsed > 1.0:
                    logger.warning("Slow DB write: %.2fs", elapsed)
                if attempt > 0:
                    logger.info("DB write succeeded after %d retries (%.2fs)", attempt, elapsed)

                return result
        except OperationalError as exc:
            if "database is locked" in str(exc).lower() and attempt < max_retries - 1:
                last_error = exc
                # Exponential backoff: 0.1s, 0.2s, 0.4s
                delay = 0.1 * (2 ** attempt)
                logger.warning(
                    "Database locked (attempt %d/%d), retrying in %.1fs",
                    attempt + 1, max_retries, delay,
                )
                await asyncio.sleep(delay)
            else:
                raise
        except Exception:
            # Non-retryable error
            raise

    # All retries exhausted
    raise last_error or OperationalError("Max retries exceeded", None, None)  # type: ignore[arg-type]  # SQLAlchemy stubs require BaseException for orig


async def run_in_read_session(
    fn: Callable[[AsyncSession], Coroutine[Any, Any, T]],
) -> T:
    """Execute *fn(session)* inside a managed READ session (no commit).

    Uses the read connection pool (pool_size=5) for concurrent reads.
    No retry logic needed — reads don't contend.

    Example::

        result = await run_in_read_session(lambda s: MyService(s).get_thing())
    """
    factory = get_read_session_factory()
    async with factory() as session:
        return await fn(session)


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
    engine = _get_write_engine()
    async with engine.begin() as conn:
        # Import all model modules so Base.metadata is populated
        import stitch_backend.domains.accounts.models  # noqa: F401
        import stitch_backend.domains.ai_gateway.models  # noqa: F401
        import stitch_backend.domains.auth.models  # noqa: F401
        import stitch_backend.domains.composed_flows.models  # noqa: F401
        import stitch_backend.domains.email_counter.models  # noqa: F401
        import stitch_backend.domains.email_inbox.models  # noqa: F401
        import stitch_backend.domains.icloud_email_pool.models  # noqa: F401
        import stitch_backend.domains.key_health.models  # noqa: F401
        import stitch_backend.domains.logging.models  # noqa: F401
        import stitch_backend.domains.profiles.models  # noqa: F401
        import stitch_backend.domains.proxy_library.models  # noqa: F401
        import stitch_backend.domains.settings.models  # noqa: F401
        import stitch_backend.domains.totp.models  # noqa: F401
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

        newly_added: set[str] = set()
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
                newly_added.add(column.name)
                logger.info("Migrated: added column %s.%s", table.name, column.name)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Could not add column %s.%s automatically (%s). "
                    "Manual migration may be required.",
                    table.name, column.name, exc,
                )

        # create_all skips existing tables entirely, so indexes declared on
        # newly added columns (e.g. partial UNIQUE indexes — SQLite cannot
        # ADD COLUMN with a UNIQUE constraint) never land on migrated DBs.
        # Create any missing index that references a just-added column.
        if newly_added:
            existing_indexes = {i["name"] for i in inspector.get_indexes(table.name)}
            for index in table.indexes:
                if index.name in existing_indexes:
                    continue
                if not any(c.name in newly_added for c in index.columns):
                    continue
                cols = ", ".join(f'"{c.name}"' for c in index.columns)
                unique = "UNIQUE " if index.unique else ""
                where = ""
                sqlite_where = index.dialect_options["sqlite"]["where"]
                if sqlite_where is not None:
                    where = f" WHERE {getattr(sqlite_where, 'text', str(sqlite_where))}"
                sync_conn.exec_driver_sql(
                    f'CREATE {unique}INDEX IF NOT EXISTS "{index.name}" '
                    f'ON "{table.name}" ({cols}){where}'
                )
                logger.info("Migrated: added index %s on %s", index.name, table.name)


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
    """Dispose the write/read engines and close all pooled connections."""
    global _write_engine, _read_engine  # noqa: PLW0603
    global _write_session_factory, _read_session_factory  # noqa: PLW0603
    if _write_engine is not None:
        await _write_engine.dispose()
        _write_engine = None
        _write_session_factory = None
    if _read_engine is not None:
        await _read_engine.dispose()
        _read_engine = None
        _read_session_factory = None
