"""Regression tests: background worker write sessions must survive shutdown
cancellation without cancellation ever reaching connection checkin/termination.

Workers in ``stitch_backend.workers`` are documented as "cancelled on
shutdown" — ``stop_task()`` cancels them mid-iteration.  Before the shielded
session migration their loop bodies used raw ``async with factory()`` sessions,
so a cancellation landing inside the commit tail tore down SQLAlchemy's
greenlet bridge mid-checkin (production evidence: ``Exception terminating
connection`` / ``Task was destroyed but it is pending`` — see
``test_db_cancellation.py``).  These tests pin the migrated shape.
"""

from __future__ import annotations

import asyncio
import gc
import logging

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from stitch_backend import database, workers
from stitch_backend.database import pending_close_tasks

pytestmark = pytest.mark.asyncio


class _CommitTailSession:
    """Fake session whose commit blocks in the post-SQL checkin tail.

    Supports both the raw ``async with factory()`` shape (pre-migration) and
    the managed-helper shape (post-migration) so the test demonstrates the red
    state on the old code and the green state on the new.
    """

    def __init__(self) -> None:
        self.checkin_started = asyncio.Event()
        self.release_checkin = asyncio.Event()
        self.commit_completed = False
        self.close_started = asyncio.Event()
        self.commit_complete_when_close_started: bool | None = None

    async def __aenter__(self) -> _CommitTailSession:
        return self

    async def __aexit__(self, *exc) -> None:
        await self.close()

    async def commit(self) -> None:
        self.checkin_started.set()
        await self.release_checkin.wait()
        self.commit_completed = True

    async def rollback(self) -> None:
        pass

    async def close(self) -> None:
        self.commit_complete_when_close_started = self.commit_completed
        self.close_started.set()


def _db_noise(caplog) -> list[str]:
    noisy = []
    for record in caplog.records:
        if record.levelno >= logging.ERROR and (
            record.name.startswith("sqlalchemy")
            or record.name == "asyncio"
            or "Task was destroyed" in record.getMessage()
        ):
            noisy.append(f"{record.name}: {record.getMessage()}")
    return noisy


async def _drain_close_tasks() -> None:
    for _ in range(200):
        await asyncio.sleep(0.01)
        if not pending_close_tasks():
            return


async def test_worker_flush_loop_cancellation_during_commit_tail(monkeypatch, caplog):
    """Cancellation of the flush loop mid-commit must not interrupt checkin."""
    session = _CommitTailSession()
    monkeypatch.setattr(database, "get_session_factory", lambda: lambda: session)

    async def _noop_flush(_db) -> None:
        return None

    import stitch_backend.domains.ai_gateway.install_key_service as install_key_service
    import stitch_backend.domains.ai_gateway.service as gw_service

    monkeypatch.setattr(gw_service, "flush_last_used_at", _noop_flush)
    monkeypatch.setattr(install_key_service, "flush_install_key_last_used_at", _noop_flush)

    # Skip the 10s poll interval; every sleep becomes a single loop turn.
    real_sleep = asyncio.sleep

    async def _fast_sleep(_delay) -> None:
        await real_sleep(0)

    monkeypatch.setattr(asyncio, "sleep", _fast_sleep)

    with caplog.at_level(logging.DEBUG):
        task = asyncio.create_task(workers.proxy_key_flush_loop())
        await asyncio.wait_for(session.checkin_started.wait(), timeout=2)

        # Shutdown shape: stop_task() cancels the worker mid-commit.
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        session.release_checkin.set()
        monkeypatch.undo()  # restore real sleep for the drain loop
        await asyncio.wait_for(session.close_started.wait(), timeout=2)
        await _drain_close_tasks()
        gc.collect()
        await real_sleep(0.05)

    assert session.commit_completed, "commit tail/checkin was interrupted by cancellation"
    assert session.commit_complete_when_close_started is True, (
        "session close raced the still-running commit tail"
    )
    assert not pending_close_tasks()
    assert not _db_noise(caplog), f"cancellation noise in logs: {_db_noise(caplog)}"


@pytest.fixture
async def real_db_factory(tmp_path, monkeypatch):
    """Point the central helpers at a throwaway file-backed sqlite engine."""
    engine = create_async_engine(
        f"sqlite+aiosqlite:///{tmp_path / 'cancel.db'}",
        connect_args={"check_same_thread": False},
    )
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(database, "get_session_factory", lambda: factory)
    monkeypatch.setattr(database, "get_read_session_factory", lambda: factory)
    async with engine.begin() as conn:
        await conn.exec_driver_sql("CREATE TABLE items (id INTEGER PRIMARY KEY, v TEXT)")
    yield factory
    await engine.dispose()


async def test_get_db_context_manager_cancelled_mid_work(real_db_factory, caplog):
    """The ``async with get_db()`` shape (used by the migrated raw-session
    sites) must close quietly when the owning task is cancelled mid-work."""
    from sqlalchemy import text

    from stitch_backend.database import get_db

    started = asyncio.Event()

    async def use_db():
        async with get_db() as session:
            await session.execute(text("SELECT 1"))
            started.set()
            await asyncio.sleep(60)  # never finishes — in-flight work

    with caplog.at_level(logging.DEBUG):
        task = asyncio.create_task(use_db())
        await started.wait()
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        await _drain_close_tasks()
        gc.collect()
        await asyncio.sleep(0.05)

    assert not pending_close_tasks(), "shielded close tasks must drain"
    assert not _db_noise(caplog), f"cancellation noise in logs: {_db_noise(caplog)}"
