"""Regression tests: request cancellation must not corrupt pooled aiosqlite
connections or leak background tasks.

Production evidence (backend-deploy5.err.log): a streaming client request
torn down by starlette's BaseHTTPMiddleware cancel scope produced, inside
SQLAlchemy's greenlet bridge:

* ``Exception terminating connection`` / ``asyncio.CancelledError`` —
  cancellation landed in ``do_terminate`` during overflow checkin;
* ``Exception during reset or similar`` / ``sqlite3.OperationalError: no
  active connection`` — the same connection half-closed, then reset;
* ``Task was destroyed but it is pending`` for the orphaned
  ``_terminate_graceful_close`` coroutine.

The fix under test: session close runs in a tracked, never-cancelled task
(``close_session_shielded``), so connection checkin/termination always runs
to completion even when the request task is cancelled mid-stream.
"""

from __future__ import annotations

import asyncio
import gc
import logging

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from stitch_backend import database
from stitch_backend.database import (
    close_session_shielded,
    pending_close_tasks,
    run_in_read_session,
    run_in_session,
)

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def db_factory(tmp_path, monkeypatch):
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


# ── Shield semantics (deterministic, fake session) ───────────────────────────


class _FakeSession:
    """Duck-typed stand-in exposing only what close_session_shielded uses."""

    def __init__(self) -> None:
        self.close_started = asyncio.Event()
        self.close_release = asyncio.Event()
        self.closed = False

    async def close(self) -> None:
        self.close_started.set()
        await self.close_release.wait()
        self.closed = True


async def test_close_survives_caller_cancellation():
    """Cancellation of the caller must not cancel the close itself."""
    session = _FakeSession()
    task = asyncio.create_task(close_session_shielded(session))
    await session.close_started.wait()
    assert pending_close_tasks(), "close must be tracked while in flight"

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    # Close is still in flight in the background — not torn down mid-flight.
    assert not session.closed
    session.close_release.set()
    for _ in range(100):
        await asyncio.sleep(0.01)
        if session.closed:
            break
    assert session.closed, "shielded close must run to completion"
    assert not pending_close_tasks(), "tracking set must drain after completion"


async def test_close_awaited_inline_when_not_cancelled():
    """Uncancelled callers keep the old ordering: close completes before return."""
    session = _FakeSession()
    session.close_release.set()
    await close_session_shielded(session)
    assert session.closed
    assert not pending_close_tasks()


# ── Integration: real engine, real aiosqlite connections ─────────────────────


async def test_run_in_session_cancelled_mid_work(db_factory, caplog):
    """Client-disconnect shape: cancellation mid-operation, then a quiet close."""
    started = asyncio.Event()

    async def work(session):
        await session.execute(text("SELECT 1"))
        started.set()
        await asyncio.sleep(60)  # never finishes — simulates in-flight work

    with caplog.at_level(logging.DEBUG):
        task = asyncio.create_task(run_in_session(work))
        await started.wait()
        await asyncio.sleep(0.05)  # let the operation sit inside the session
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        # Allow the shielded close to finish, then force GC of any orphans.
        for _ in range(100):
            await asyncio.sleep(0.01)
            if not pending_close_tasks():
                break
        gc.collect()
        await asyncio.sleep(0.05)

    assert not pending_close_tasks(), "shielded close tasks must drain"
    assert not _db_noise(caplog), f"cancellation noise in logs: {_db_noise(caplog)}"


async def test_run_in_read_session_cancelled_mid_work(db_factory, caplog):
    started = asyncio.Event()

    async def work(session):
        await session.execute(text("SELECT 1"))
        started.set()
        await asyncio.sleep(60)

    with caplog.at_level(logging.DEBUG):
        task = asyncio.create_task(run_in_read_session(work))
        await started.wait()
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

        for _ in range(100):
            await asyncio.sleep(0.01)
            if not pending_close_tasks():
                break
        gc.collect()
        await asyncio.sleep(0.05)

    assert not pending_close_tasks()
    assert not _db_noise(caplog), f"cancellation noise in logs: {_db_noise(caplog)}"


async def test_streaming_disconnect_simulation(db_factory, caplog):
    """Simulated client disconnect mid-stream: generator doing per-chunk DB
    writes is torn down by cancellation — no noise, no leaked tasks."""

    async def stream():
        for i in range(1000):
            async def write_chunk(session, i=i):
                await session.execute(text("INSERT INTO items (v) VALUES (:v)"), {"v": str(i)})

            await run_in_session(write_chunk)
            yield f"chunk-{i}"
            await asyncio.sleep(0.02)

    async def consume():
        count = 0
        async for _ in stream():
            count += 1
        return count

    baseline_tasks = len(asyncio.all_tasks())
    with caplog.at_level(logging.DEBUG):
        task = asyncio.create_task(consume())
        await asyncio.sleep(0.2)  # stream a few chunks
        task.cancel()  # client disconnect
        with pytest.raises(asyncio.CancelledError):
            await task

        for _ in range(100):
            await asyncio.sleep(0.01)
            if not pending_close_tasks():
                break
        gc.collect()
        await asyncio.sleep(0.1)

    assert not pending_close_tasks(), "no shielded close may outlive the test"
    assert not _db_noise(caplog), f"cancellation noise in logs: {_db_noise(caplog)}"
    leaked = len(asyncio.all_tasks()) - baseline_tasks
    assert leaked <= 0, f"leaked asyncio tasks after disconnect: {leaked}"


# ── Normal-path behavior unchanged ────────────────────────────────────────────


async def test_run_in_session_commits(db_factory):
    async def write(session):
        await session.execute(text("INSERT INTO items (v) VALUES ('a')"))

    await run_in_session(write)

    async def count(session):
        return (await session.execute(text("SELECT COUNT(*) FROM items"))).scalar()

    assert await run_in_read_session(count) == 1


async def test_run_in_session_rolls_back_on_error(db_factory):
    async def bad_write(session):
        await session.execute(text("INSERT INTO items (v) VALUES ('b')"))
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        await run_in_session(bad_write)

    async def count(session):
        return (await session.execute(text("SELECT COUNT(*) FROM items"))).scalar()

    assert await run_in_read_session(count) == 0
