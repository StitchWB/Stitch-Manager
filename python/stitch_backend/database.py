"""SQLAlchemy async engine, session factory, and declarative base."""

from __future__ import annotations

import asyncio
import atexit
import logging
import os
import shutil
import tempfile
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, TypeVar

from sqlalchemy import DateTime, event
from sqlalchemy import inspect as _sa_inspect
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.types import TypeDecorator

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


class UtcDateTime(TypeDecorator):
    """Re-attach UTC on load: SQLite drops tzinfo, so naive values would break comparisons against aware now()."""

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:
        if value is not None and value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value


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
        pool_size = settings.db_write_pool_size
        _write_engine = create_async_engine(
            settings.database_url,
            echo=settings.db_echo,
            pool_size=pool_size,  # Single write connection by default — no contention
            max_overflow=0,
            pool_pre_ping=True,
            connect_args={"check_same_thread": False},
        )

        # Enable WAL journal mode and optimize for writes.
        # busy_timeout scales with pool_size to handle the increased contention
        # when multiple writers share the DB (multi-worker deployments).
        busy_timeout = 5000 * max(1, pool_size)

        @event.listens_for(_write_engine.sync_engine, "connect")
        def _set_write_pragma(dbapi_conn, _connection_record):
            cursor = dbapi_conn.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")  # Faster than FULL, safe with WAL
            cursor.execute(f"PRAGMA busy_timeout={busy_timeout}")
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


# ── Cancellation-safe session lifecycle ──────────────────────────────────────
#
# Root cause this guards against: starlette's BaseHTTPMiddleware tears down
# streaming requests by cancelling the endpoint task when the client
# disconnects mid-stream.  Cancellation that lands inside SQLAlchemy's
# greenlet bridge while a connection is returned to the pool (rollback on
# reset) or terminated (overflow checkin / invalidate) abandons the driver
# awaitable mid-flight: the pool logs "Exception terminating connection" /
# "Exception during reset or similar", the connection is left half-closed
# ("no active connection") and the shielded ``_terminate_graceful_close``
# coroutine is orphaned — later GC'd as "Task was destroyed but it is
# pending".  SQLAlchemy cannot fix this internally (the greenlet bridge has
# no cancellation-safe teardown path), so the application must never let
# request cancellation reach connection checkin/termination.
#
# Commit and rollback are part of the same hazard: SQLAlchemy's transaction
# close returns/autoclose the connection before the ``await`` resolves.  They
# therefore use the same uncancellable-task pattern as close.  A per-session
# chain additionally guarantees that close cannot overlap an earlier commit
# or rollback whose SQL phase finished but whose pool checkin is still in
# flight when the request task is cancelled.
#
# Each lifecycle step runs in a fresh asyncio task that nothing cancels.
# Callers that are NOT being cancelled await it inline (identical ordering
# to the previous ``async with`` semantics); callers that ARE cancelled stop
# waiting immediately, while the step itself — including pool reset and any
# connection termination — always runs to completion.

_close_tasks: set[asyncio.Task[None]] = set()
_lifecycle_tasks: set[asyncio.Task[None]] = set()
_session_tails: dict[object, asyncio.Task[None]] = {}


async def _run_lifecycle_step(
    previous: asyncio.Task[None] | None,
    step: Callable[[], Coroutine[Any, Any, None]],
) -> None:
    """Run *step* after the previous lifecycle step for the same session.

    A failed commit/rollback must not prevent the following close from
    releasing whatever state the session still owns, hence ``gather`` with
    ``return_exceptions`` rather than a plain ``await`` of the predecessor.
    The predecessor's own awaiter (or detached-task logging below) remains
    responsible for observing that original failure.
    """
    if previous is not None:
        await asyncio.gather(previous, return_exceptions=True)
    await step()


def _log_detached_failure(task: asyncio.Task[None]) -> None:
    """Log a failure no caller can observe, exactly once."""
    if task.cancelled() or not getattr(task, "_stitch_detached", False):
        return
    if getattr(task, "_stitch_failure_logged", False):
        return
    exc = task.exception()
    if exc is None:
        return
    task._stitch_failure_logged = True  # type: ignore[attr-defined]
    operation = getattr(task, "_stitch_operation", "lifecycle step")
    logger.warning(
        "Detached database session %s failed: %s",
        operation,
        exc,
        exc_info=(type(exc), exc, exc.__traceback__),
    )


def _lifecycle_task_done(session: AsyncSession, task: asyncio.Task[None]) -> None:
    """Untrack a finished lifecycle task and consume otherwise-hidden failures."""
    _lifecycle_tasks.discard(task)
    _close_tasks.discard(task)
    if _session_tails.get(session) is task:
        del _session_tails[session]

    if task.cancelled():
        return
    # Retrieve in every case — even when an inline caller is about to raise the
    # same exception — so the loop never emits "exception was never retrieved".
    task.exception()
    _log_detached_failure(task)


def _schedule_lifecycle_step(
    session: AsyncSession,
    step: Callable[[], Coroutine[Any, Any, None]],
    operation: str,
) -> asyncio.Task[None]:
    """Schedule *step* as the next uncancellable lifecycle step for *session*."""
    previous = _session_tails.get(session)
    task = asyncio.create_task(
        _run_lifecycle_step(previous, step),
        name=f"stitch-db-session-{operation}",
    )
    task._stitch_detached = False  # type: ignore[attr-defined]
    task._stitch_failure_logged = False  # type: ignore[attr-defined]
    task._stitch_operation = operation  # type: ignore[attr-defined]
    _session_tails[session] = task
    _lifecycle_tasks.add(task)
    if operation == "close":
        _close_tasks.add(task)

    def _on_done(done: asyncio.Task[None]) -> None:
        _lifecycle_task_done(session, done)

    task.add_done_callback(_on_done)
    return task


async def _await_lifecycle_task(task: asyncio.Task[None]) -> None:
    """Await a lifecycle task without letting caller cancellation reach it."""
    current = asyncio.current_task()
    if current is not None and current.cancelling() > 0:
        # Cancellation was already delivered earlier in this task (for example
        # inside commit) and cleanup is now running from ``finally``.  Do not
        # make the dying caller wait a second time: detach immediately while
        # the just-scheduled lifecycle step finishes in the background.
        task._stitch_detached = True  # type: ignore[attr-defined]
        if task.done():
            _log_detached_failure(task)
        raise asyncio.CancelledError
    try:
        await asyncio.shield(task)
    except asyncio.CancelledError:
        # The caller is going away.  Mark the still-running task so its
        # otherwise-unobserved failure is logged (and retrieved) when it ends.
        task._stitch_detached = True  # type: ignore[attr-defined]
        if task.done():
            _log_detached_failure(task)
        raise


async def _close_session_impl(session: AsyncSession) -> None:
    # No broad catch here: callers that are still alive must learn that pool
    # checkin/reset failed.  Detached callers get done-callback logging in
    # ``_lifecycle_task_done`` instead.
    await session.close()


async def close_session_shielded(session: AsyncSession) -> None:
    """Close *session* in a tracked task immune to caller cancellation.

    The close is spawned onto the loop first (so it survives even when the
    caller is already inside a cancelled scope) and then awaited through
    ``asyncio.shield``.  If cancellation arrives while waiting, it is
    re-raised — the close continues in the tracked background task instead
    of being torn down mid-flight inside SQLAlchemy's greenlet bridge.  The
    close is also chained behind any shielded commit/rollback already running
    for this session, so connection checkin cannot overlap itself.
    """
    task = _schedule_lifecycle_step(
        session, lambda: _close_session_impl(session), "close"
    )
    await _await_lifecycle_task(task)


async def commit_session_shielded(session: AsyncSession) -> None:
    """Commit through the same uncancellable, per-session lifecycle chain.

    Public for service-owned sessions whose lifecycle cannot use
    ``run_in_session``/``get_db`` directly.
    """
    task = _schedule_lifecycle_step(session, session.commit, "commit")
    await _await_lifecycle_task(task)


async def _rollback_session_shielded(session: AsyncSession) -> None:
    """Rollback through the same uncancellable, per-session lifecycle chain."""
    task = _schedule_lifecycle_step(session, session.rollback, "rollback")
    await _await_lifecycle_task(task)


def pending_close_tasks() -> frozenset[asyncio.Task[None]]:
    """Snapshot of in-flight shielded closes (tests/diagnostics)."""
    return frozenset(_close_tasks)


async def drain_session_lifecycle_tasks() -> None:
    """Wait for all tracked session lifecycle tasks, including late arrivals.

    Shutdown can itself cancel request/owner tasks; those cancellations spawn
    shielded closes while an earlier drain iteration is already waiting.  Loop
    until the tracking set is empty instead of draining only one snapshot.
    """
    while _lifecycle_tasks:
        tasks = tuple(_lifecycle_tasks)
        await asyncio.gather(*tasks, return_exceptions=True)
        # Done callbacks are scheduled separately; give them one loop turn to
        # untrack completed tasks before deciding whether another wave exists.
        await asyncio.sleep(0)


# ── FastAPI dependency ────────────────────────────────────────────────────────

@asynccontextmanager
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield a scoped session; auto-commit on success, rollback on error.

    Usage as a FastAPI dependency:
        async def my_endpoint(db: AsyncSession = Depends(get_db)):
            ...
    """
    factory = get_session_factory()
    session = factory()
    try:
        try:
            yield session
            await commit_session_shielded(session)
        except Exception:
            await _rollback_session_shielded(session)
            raise
    finally:
        await close_session_shielded(session)


# ── Standalone command helper ──────────────────────────────────────────────────

import time as _time

# Throttle for slow-write warning log — emit at most once per 60s.
_last_slow_write_log: float = 0.0
_SLOW_WRITE_LOG_INTERVAL: float = 60.0


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
        session = factory()
        try:
            try:
                result = await fn(session)
                await commit_session_shielded(session)

                # Monitoring: log slow operations (throttled to once per 60s)
                elapsed = _time.monotonic() - start
                if elapsed > 1.0:
                    global _last_slow_write_log
                    now_mono = _time.monotonic()
                    if now_mono - _last_slow_write_log >= _SLOW_WRITE_LOG_INTERVAL:
                        logger.warning("Slow DB write: %.2fs", elapsed)
                        _last_slow_write_log = now_mono
                if attempt > 0:
                    logger.info("DB write succeeded after %d retries (%.2fs)", attempt, elapsed)

                return result
            finally:
                # Inner finally: the connection must be released BEFORE the
                # retry backoff below — pool_size=1 means holding it across
                # the sleep would deadlock the retry against itself.
                await close_session_shielded(session)
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
    session = factory()
    try:
        return await fn(session)
    finally:
        await close_session_shielded(session)


# ── Table creation (dev / first run) ──────────────────────────────────────────

# Fresh-DB template: Base.metadata snapshot, built once per process (mkstemp + atexit unlink).
_DB_TEMPLATE: Path | None = None


def _sqlite_db_path(url: str) -> Path | None:
    """File path of a file-backed SQLite URL; None for :memory:/non-sqlite."""
    database = make_url(url).database if url.startswith("sqlite") else None
    if not database or database.startswith((":memory:", "file:memorydb")):
        return None
    return Path(database)


def _import_all_models() -> None:
    """Import every model module so Base.metadata is fully populated."""
    import stitch_backend.domains.accounts.models  # noqa: F401
    import stitch_backend.domains.ai_gateway.models  # noqa: F401
    import stitch_backend.domains.ai_proxy.models  # noqa: F401
    import stitch_backend.domains.auth.models  # noqa: F401
    import stitch_backend.domains.community.models  # noqa: F401
    import stitch_backend.domains.community.partner_models  # noqa: F401
    import stitch_backend.domains.composed_flows.models  # noqa: F401
    import stitch_backend.domains.email_inbox.models  # noqa: F401
    import stitch_backend.domains.groups.models  # noqa: F401
    import stitch_backend.domains.icloud_email_pool.models  # noqa: F401
    import stitch_backend.domains.key_health.models  # noqa: F401
    import stitch_backend.domains.logging.models  # noqa: F401
    import stitch_backend.domains.plugin_distribution.models  # noqa: F401
    import stitch_backend.domains.profiles.models  # noqa: F401
    import stitch_backend.domains.proxy_library.models  # noqa: F401
    import stitch_backend.domains.settings.models  # noqa: F401
    import stitch_backend.domains.totp.models  # noqa: F401


def _build_db_template(template_path: Path) -> None:
    """Build the fresh-DB template from Base.metadata (sync, once per process)."""
    from sqlalchemy import create_engine

    _import_all_models()
    engine = create_engine(f"sqlite:///{template_path}")
    try:
        with engine.begin() as conn:
            Base.metadata.create_all(conn)
    finally:
        engine.dispose()


def _remove_db_template(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


async def create_all_tables() -> None:
    """Create missing tables and add missing columns to existing ones.

    ``Base.metadata.create_all`` only creates tables that don't exist — it
    never alters an existing table.  Because the SQLite database may have been
    created by the legacy Rust backend (different/older schema), we follow up
    with a lightweight, non-destructive column migration that ``ALTER TABLE
    ADD COLUMN`` for any column the ORM expects but the DB lacks.  Use Alembic
    for anything more involved.

    A never-touched SQLite file gets the once-per-process template snapshot
    instead of DDL: same metadata, same create_all, one file copy instead of
    hundreds of DDL runs (test suites boot a fresh DB per fixture).
    """
    global _DB_TEMPLATE  # noqa: PLW0603
    db_path = _sqlite_db_path(get_settings().database_url)
    if db_path is not None and not db_path.exists():
        if _DB_TEMPLATE is None:
            fd, template_name = tempfile.mkstemp(
                prefix="stitch-db-template-", suffix=".db"
            )
            os.close(fd)
            _DB_TEMPLATE = Path(template_name)
            _build_db_template(_DB_TEMPLATE)
            atexit.register(_remove_db_template, _DB_TEMPLATE)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(_DB_TEMPLATE, db_path)
        return
    engine = _get_write_engine()
    async with engine.begin() as conn:
        _import_all_models()
        existing_tables = await conn.run_sync(
            lambda sync_conn: set(_sa_inspect(sync_conn).get_table_names())
        )
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns, existing_tables)


def _add_missing_columns(sync_conn: Any, existing_tables: set[str] | None = None) -> None:
    """Add ORM-declared columns missing from tables that predate this call.

    Runs inside ``conn.run_sync`` so it operates on a synchronous connection.
    Only adds columns — never drops or alters existing ones — so it is safe to
    run on every startup.  ``existing_tables`` skips the inspector pass for
    tables this call just created.
    """
    from sqlalchemy.schema import CreateColumn

    inspector = _sa_inspect(sync_conn)
    if existing_tables is None:
        existing_tables = set(inspector.get_table_names())
    dialect = sync_conn.dialect

    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue

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

        # create_all skips existing tables entirely, so indexes declared in
        # the ORM (e.g. partial UNIQUE indexes — SQLite cannot ADD COLUMN
        # with a UNIQUE constraint) never land on migrated DBs.  Create any
        # missing index whose columns all exist now; this also retries
        # indexes whose creation failed on a PREVIOUS startup (the old
        # ``if newly_added`` guard silently skipped them forever).
        # IF NOT EXISTS keeps this idempotent.
        db_columns_now = db_columns | newly_added
        existing_indexes = {i["name"] for i in inspector.get_indexes(table.name)}
        for index in table.indexes:
            if index.name in existing_indexes:
                continue
            if not all(c.name in db_columns_now for c in index.columns):
                continue
            cols = ", ".join(f'"{c.name}"' for c in index.columns)
            unique = "UNIQUE " if index.unique else ""
            where = ""
            sqlite_where = index.dialect_options["sqlite"].get("where")
            if sqlite_where is not None:
                where = f" WHERE {getattr(sqlite_where, 'text', str(sqlite_where))}"
            try:
                sync_conn.exec_driver_sql(
                    f'CREATE {unique}INDEX IF NOT EXISTS "{index.name}" '
                    f'ON "{table.name}" ({cols}){where}'
                )
                logger.info("Migrated: added index %s on %s", index.name, table.name)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Could not create index %s on %s (%s). "
                    "Manual migration may be required.",
                    index.name, table.name, exc,
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
    """Drain checked-out session cleanup, then dispose the write/read engines.

    ``AsyncEngine.dispose()`` closes only idle pooled connections; it does not
    own connections still checked out by shielded lifecycle tasks.  Those
    tasks must finish first, or a background checkin can race disposal and be
    cancelled/GC'd when the loop tears down.
    """
    global _write_engine, _read_engine  # noqa: PLW0603
    global _write_session_factory, _read_session_factory  # noqa: PLW0603
    await drain_session_lifecycle_tasks()
    if _write_engine is not None:
        await _write_engine.dispose()
        _write_engine = None
        _write_session_factory = None
        # Disposal awaits pool work and can yield; cancellation of an owner in
        # that window may have spawned another shielded close.  Never let the
        # next engine (or the return from lifespan teardown) race it.
        await drain_session_lifecycle_tasks()
    if _read_engine is not None:
        await _read_engine.dispose()
        _read_engine = None
        _read_session_factory = None
        await drain_session_lifecycle_tasks()
