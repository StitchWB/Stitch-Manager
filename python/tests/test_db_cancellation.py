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

The fix under test has two halves: session commit/rollback/close run in
tracked, never-cancelled tasks (``close_session_shielded`` and its lifecycle
chain), and SQLAlchemy >=2.0.58 carries upstream pool fix #13772 so a
cancellation that still lands inside invalidation/terminate force-closes and
discards the connection without losing the pool slot.  Engine disposal drains
those tasks before pooled connections are torn down.
"""

from __future__ import annotations

import asyncio
import gc
import logging
import time
from types import SimpleNamespace

import aiosqlite
import anyio
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


# ── Regression: cancellation in the transaction-close/checkin tail ───────────


class _CommitTailSession:
    """Fake session whose commit has reached the post-SQL checkin tail.

    The blocking wait stands in for SQLAlchemy's connection return/reset after
    the SQL COMMIT has already been issued.  Cancellation must not be delivered
    to that tail, and session close must not begin until the tail is complete.
    """

    def __init__(self) -> None:
        self.checkin_started = asyncio.Event()
        self.release_checkin = asyncio.Event()
        self.close_started = asyncio.Event()
        self.commit_completed = False
        self.commit_complete_when_close_started: bool | None = None

    async def commit(self) -> None:
        self.checkin_started.set()
        await self.release_checkin.wait()
        self.commit_completed = True

    async def close(self) -> None:
        self.commit_complete_when_close_started = self.commit_completed
        self.close_started.set()


async def test_cancellation_during_commit_tail_cannot_interrupt_checkin(monkeypatch):
    session = _CommitTailSession()
    monkeypatch.setattr(database, "get_session_factory", lambda: lambda: session)

    async def noop(_session):
        return None

    task = asyncio.create_task(run_in_session(noop))
    await asyncio.wait_for(session.checkin_started.wait(), timeout=1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    session.release_checkin.set()
    await asyncio.wait_for(session.close_started.wait(), timeout=1)
    for _ in range(100):
        await asyncio.sleep(0.01)
        if not pending_close_tasks():
            break

    assert session.commit_completed, "commit tail/checkin was interrupted by cancellation"
    assert session.commit_complete_when_close_started is True, (
        "session close raced the still-running commit tail"
    )
    assert not pending_close_tasks()


class _RollbackTailSession:
    """Fake session whose rollback is interrupted in its connection-return tail."""

    def __init__(self) -> None:
        self.rollback_tail_started = asyncio.Event()
        self.release_rollback_tail = asyncio.Event()
        self.close_started = asyncio.Event()
        self.rollback_completed = False
        self.rollback_complete_when_close_started: bool | None = None

    async def commit(self) -> None:
        raise AssertionError("test body fails before commit, so commit must not run")

    async def rollback(self) -> None:
        self.rollback_tail_started.set()
        await self.release_rollback_tail.wait()
        self.rollback_completed = True

    async def close(self) -> None:
        self.rollback_complete_when_close_started = self.rollback_completed
        self.close_started.set()


async def test_cancellation_during_rollback_tail_cannot_interrupt_checkin(monkeypatch):
    session = _RollbackTailSession()
    monkeypatch.setattr(database, "get_session_factory", lambda: lambda: session)

    async def use_db():
        async with database.get_db():
            raise RuntimeError("force dependency rollback")

    task = asyncio.create_task(use_db())
    await asyncio.wait_for(session.rollback_tail_started.wait(), timeout=1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    session.release_rollback_tail.set()
    await asyncio.wait_for(session.close_started.wait(), timeout=1)
    for _ in range(100):
        await asyncio.sleep(0.01)
        if not pending_close_tasks():
            break

    assert session.rollback_completed, "rollback tail/checkin was interrupted by cancellation"
    assert session.rollback_complete_when_close_started is True, (
        "session close raced the still-running rollback tail"
    )
    assert not pending_close_tasks()


# ── Regression: close failures and shutdown draining ─────────────────────────


class _FailingCloseSession:
    async def close(self) -> None:
        raise RuntimeError("checkin failed")


async def test_close_exception_propagates_to_uncancelled_caller():
    with pytest.raises(RuntimeError, match="checkin failed"):
        await close_session_shielded(_FailingCloseSession())


class _ControlledFailingCloseSession:
    def __init__(self) -> None:
        self.close_started = asyncio.Event()
        self.release_close = asyncio.Event()

    async def close(self) -> None:
        self.close_started.set()
        await self.release_close.wait()
        raise RuntimeError("detached checkin failed")


async def test_detached_close_exception_is_logged_and_consumed(caplog):
    session = _ControlledFailingCloseSession()
    task = asyncio.create_task(close_session_shielded(session))
    await session.close_started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    with caplog.at_level(logging.WARNING, logger="stitch_backend.database"):
        session.release_close.set()
        for _ in range(100):
            await asyncio.sleep(0.01)
            if not pending_close_tasks():
                break

    assert not pending_close_tasks()
    assert any(
        "detached" in record.getMessage() and "checkin failed" in record.getMessage()
        for record in caplog.records
    ), "detached close failure must be logged because no caller can observe it"


class _RecordingEngine:
    def __init__(self) -> None:
        self.dispose_started = asyncio.Event()
        self.dispose_completed = False

    async def dispose(self) -> None:
        self.dispose_started.set()
        self.dispose_completed = True


async def test_dispose_engine_drains_pending_close_before_disposal(monkeypatch):
    session = _FakeSession()
    close_caller = asyncio.create_task(close_session_shielded(session))
    await session.close_started.wait()
    close_caller.cancel()
    with pytest.raises(asyncio.CancelledError):
        await close_caller

    engine = _RecordingEngine()
    monkeypatch.setattr(database, "_write_engine", engine)
    monkeypatch.setattr(database, "_write_session_factory", object())
    monkeypatch.setattr(database, "_read_engine", None)
    monkeypatch.setattr(database, "_read_session_factory", None)

    dispose_task = asyncio.create_task(database.dispose_engine())
    try:
        await asyncio.sleep(0.05)
        assert not engine.dispose_started.is_set(), (
            "engine disposal began while a checked-out connection close was pending"
        )
    finally:
        session.close_release.set()

    await asyncio.wait_for(dispose_task, timeout=1)
    assert engine.dispose_completed
    assert not pending_close_tasks()


async def test_dispose_engine_drains_close_that_arrives_during_drain(monkeypatch):
    first = _FakeSession()
    first_caller = asyncio.create_task(close_session_shielded(first))
    await first.close_started.wait()
    first_caller.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first_caller

    engine = _RecordingEngine()
    monkeypatch.setattr(database, "_write_engine", engine)
    monkeypatch.setattr(database, "_write_session_factory", object())
    monkeypatch.setattr(database, "_read_engine", None)
    monkeypatch.setattr(database, "_read_session_factory", None)

    dispose_task = asyncio.create_task(database.dispose_engine())
    await asyncio.sleep(0.05)  # first drain wave is now waiting only on ``first``

    # Shutdown cancellation can spawn another shielded close after that first
    # wave has already gathered its snapshot.  Disposal must loop back for it.
    second = _FakeSession()
    second_caller = asyncio.create_task(close_session_shielded(second))
    await second.close_started.wait()
    second_caller.cancel()
    with pytest.raises(asyncio.CancelledError):
        await second_caller

    try:
        first.close_release.set()
        await asyncio.sleep(0.05)
        assert not engine.dispose_started.is_set(), (
            "engine disposal skipped a close that arrived during the drain"
        )
    finally:
        second.close_release.set()

    await asyncio.wait_for(dispose_task, timeout=1)
    assert engine.dispose_completed
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

# -- Regression: cancellation before the shielded lifecycle boundary ----------


async def test_anyio_cancel_during_write_does_not_exhaust_pool(
    tmp_path, monkeypatch, caplog
):
    """The live cascade shape, compressed from 30s pool timeouts to 0.2s.

    Starlette/uvicorn run streaming responses inside AnyIO cancel scopes. AnyIO
    re-delivers cancellation at every checkpoint until the cancelled task leaves
    the scope. When that cancellation lands inside the write itself (before
    ``run_in_session`` reaches its shielded commit/close boundary), SQLAlchemy
    invalidates the connection immediately and pool termination still happens
    on the repeatedly-cancelled task. SQLAlchemy 2.0.52 loses the pool slot in
    exactly that window; the fixed 2.0.x pool (upstream #13772) force-closes and
    discards the connection but returns the slot, so subsequent writes do not serialize into
    pool timeouts.
    """
    db_path = tmp_path / "cancel-cascade.db"
    loop = asyncio.get_running_loop()
    execute_started = asyncio.Event()

    def stitch_sleep(seconds: float) -> float:
        # SQLite UDFs run on aiosqlite's worker thread. Blocking there keeps
        # the driver's graceful close queued long enough for AnyIO's repeated
        # cancellation to hit pool termination deterministically.
        loop.call_soon_threadsafe(execute_started.set)
        time.sleep(seconds)
        return seconds

    async def connect() -> aiosqlite.Connection:
        connection = aiosqlite.connect(str(db_path), check_same_thread=False)
        # SQLAlchemy daemonizes the worker thread only for its own default
        # creator; with async_creator that ownership remains with the creator.
        worker_thread = getattr(connection, "_thread", connection)
        worker_thread.daemon = True
        await connection
        await connection.create_function("stitch_sleep", 1, stitch_sleep)
        return connection

    engine = create_async_engine(
        f"sqlite+aiosqlite:///{db_path.as_posix()}",
        async_creator=connect,
        pool_size=1,
        max_overflow=0,
        pool_timeout=0.2,
        pool_pre_ping=True,
    )
    factory = async_sessionmaker(
        bind=engine, class_=AsyncSession, expire_on_commit=False
    )
    monkeypatch.setattr(database, "get_session_factory", lambda: factory)

    async with engine.begin() as conn:
        await conn.exec_driver_sql("CREATE TABLE items (id INTEGER PRIMARY KEY, v TEXT)")

    async def victim_write(session):
        await session.execute(
            text("INSERT INTO items (v) SELECT CAST(stitch_sleep(0.25) AS TEXT)")
        )

    with caplog.at_level(logging.DEBUG):
        async with anyio.create_task_group() as task_group:
            task_group.start_soon(run_in_session, victim_write)
            await asyncio.wait_for(execute_started.wait(), timeout=1)
            task_group.cancel_scope.cancel()

        await database.drain_session_lifecycle_tasks()
        await asyncio.sleep(0.05)

        errors: list[Exception] = []
        for index in range(6):
            async def probe_write(session, index=index):
                await session.execute(
                    text("INSERT INTO items (v) VALUES (:v)"), {"v": str(index)}
                )

            try:
                await run_in_session(probe_write)
            except Exception as exc:
                errors.append(exc)

    try:
        assert engine.pool.checkedout() == 0, (
            "cancelled connection termination must not remain counted as checked out"
        )
        assert not errors, (
            "six post-cancellation writes serialized into pool timeouts: "
            + "; ".join(f"{type(exc).__name__}: {exc}" for exc in errors)
        )
        assert not _db_noise(caplog), f"cancellation noise in logs: {_db_noise(caplog)}"
    finally:
        await engine.dispose()


# -- Regression: streaming web handlers must not bypass the shield ------------


@pytest.mark.parametrize(
    ("handler_name", "builder_name"),
    [
        ("_handle_web_gemini_chat", "_build_web_gemini_adapter"),
        ("_handle_web_deepseek_chat", "_build_web_deepseek_adapter"),
        ("_handle_web_qwen_chat", "_build_web_qwen_adapter"),
    ],
)
async def test_web_streaming_session_close_survives_cancellation(
    monkeypatch, handler_name, builder_name
):
    """Direct ``await session.close()`` in these handlers used to expose pool
    checkin/termination to request cancellation. The handler may die, but the
    close it started must still finish in the tracked shielded task.
    """
    from stitch_backend.domains.ai_proxy import chat_router

    class _Adapter:
        async def stream_chat_completion(self, _request):
            yield "data: unused\n\n"

    async def _builder(_session):
        return _Adapter()

    monkeypatch.setattr(chat_router, builder_name, _builder)
    session = _FakeSession()
    handler = getattr(chat_router, handler_name)
    chat_request = SimpleNamespace(model="test-model", raw_messages=[], tools=None)

    task = asyncio.create_task(handler(session, chat_request))
    await session.close_started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert not session.closed, "caller cancellation must not tear down the close itself"
    session.close_release.set()
    await database.drain_session_lifecycle_tasks()
    assert session.closed


class _CommitThenCloseSession:
    def __init__(self) -> None:
        self.commit_started = asyncio.Event()
        self.release_commit = asyncio.Event()
        self.commit_completed = False
        self.closed = False

    async def commit(self) -> None:
        self.commit_started.set()
        await self.release_commit.wait()
        self.commit_completed = True

    async def close(self) -> None:
        self.closed = True


async def test_kiro_gateway_service_shutdown_uses_shielded_lifecycle():
    from stitch_backend.domains.kiro_gateway.service import KiroGatewayService

    session = _CommitThenCloseSession()
    service = KiroGatewayService(session, object())
    task = asyncio.create_task(service.shutdown(commit=True))
    await session.commit_started.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert not session.commit_completed, (
        "caller cancellation must not interrupt the commit/checkin tail"
    )
    session.release_commit.set()
    await database.drain_session_lifecycle_tasks()
    assert session.commit_completed
    assert session.closed



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
