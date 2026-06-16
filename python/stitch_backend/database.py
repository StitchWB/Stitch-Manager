"""SQLAlchemy async engine, session factory, and declarative base."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from stitch_backend.config import get_settings

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine


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
    """Create all tables that don't exist yet.  Use Alembic in production."""
    engine = _get_engine()
    async with engine.begin() as conn:
        # Import all model modules so Base.metadata is populated
        import stitch_backend.domains.accounts.models  # noqa: F401
        import stitch_backend.domains.settings.models  # noqa: F401
        import stitch_backend.domains.profiles.models  # noqa: F401
        import stitch_backend.domains.email_counter.models  # noqa: F401
        import stitch_backend.domains.composed_flows.models  # noqa: F401
        import stitch_backend.domains.email_inbox.models      # noqa: F401
        await conn.run_sync(Base.metadata.create_all)


# ── Teardown ──────────────────────────────────────────────────────────────────

async def dispose_engine() -> None:
    """Dispose the engine and close all pooled connections."""
    global _engine, _session_factory  # noqa: PLW0603
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None
