"""Regression tests for the single-instance lockfile.

Context: backend instances on *different* ports (STITCH_API_PORT override)
silently shared the same stitch.db — a sqlite multi-writer hazard that
corrupted probe lifecycle state twice during testing/smoke runs
(see crashloop-analysis.md follow-up #3).  Port-conflict handling in the
launcher (PR #106) only covers same-port conflicts; the true fix is a lock
scoped to the DB file itself, acquired in the backend lifespan BEFORE any
DB write.

Invariants under test:
  - exactly one live process may hold the lock for a given DB file;
  - a second acquirer is refused with holder details (pid/port) in the error;
  - once the holder releases (clean shutdown or process death — the OS
    releases kernel-level locks either way), takeover succeeds;
  - STITCH_ALLOW_MULTI_INSTANCE=1 bypasses the guard with a loud warning;
  - in-memory / non-file databases are out of scope (no shared file, no lock);
  - the lifespan acquires the lock BEFORE create_all_tables (mechanical
    ordering guard — a silent reorder would reintroduce the hazard).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

if TYPE_CHECKING:
    from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from stitch_backend import instance_lock  # noqa: E402
from stitch_backend.instance_lock import (  # noqa: E402
    ALLOW_MULTI_INSTANCE_ENV,
    InstanceLockHeldError,
    acquire_instance_lock,
    lock_path_for_db,
)


def _db_url(path: Path) -> str:
    return "sqlite+aiosqlite:///" + str(path).replace("\\", "/")


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "stitch.db"


class TestLockPath:
    def test_lock_sits_next_to_db(self, tmp_path: Path) -> None:
        db = tmp_path / "stitch.db"
        assert lock_path_for_db(db) == tmp_path / "stitch.instance.lock"

    def test_lock_name_follows_db_stem(self, tmp_path: Path) -> None:
        db = tmp_path / "dev-2026.db"
        assert lock_path_for_db(db) == tmp_path / "dev-2026.instance.lock"


class TestAcquire:
    def test_acquire_writes_payload(self, db_path: Path) -> None:
        lock = acquire_instance_lock(_db_url(db_path), port=25584)
        try:
            assert lock is not None
            payload = json.loads(lock_path_for_db(db_path).read_text(encoding="utf-8"))
            assert payload["pid"] == os.getpid()
            assert payload["port"] == 25584
            assert payload["started_at"]
        finally:
            lock.release()

    def test_creates_parent_dirs(self, tmp_path: Path) -> None:
        db = tmp_path / "nested" / "deep" / "stitch.db"
        lock = acquire_instance_lock(_db_url(db), port=1)
        try:
            assert lock is not None
        finally:
            lock.release()

    def test_memory_db_not_locked(self) -> None:
        assert acquire_instance_lock("sqlite+aiosqlite:///:memory:", port=1) is None

    def test_non_sqlite_not_locked(self) -> None:
        assert acquire_instance_lock("postgresql+asyncpg://u:p@h/db", port=1) is None


class TestSecondInstanceRefused:
    """The core invariant: a live holder blocks any second writer."""

    def test_second_acquire_refused(self, db_path: Path) -> None:
        first = acquire_instance_lock(_db_url(db_path), port=25584)
        try:
            with pytest.raises(InstanceLockHeldError):
                acquire_instance_lock(_db_url(db_path), port=25599)
        finally:
            first.release()

    def test_error_carries_holder_details(self, db_path: Path) -> None:
        first = acquire_instance_lock(_db_url(db_path), port=25584)
        try:
            with pytest.raises(InstanceLockHeldError) as excinfo:
                acquire_instance_lock(_db_url(db_path), port=25599)
            err = excinfo.value
            assert err.holder is not None
            assert err.holder.pid == os.getpid()
            assert err.holder.port == 25584
            # Message must be actionable: who holds it and how to override.
            assert str(os.getpid()) in str(err)
            assert "25584" in str(err)
            assert ALLOW_MULTI_INSTANCE_ENV in str(err)
        finally:
            first.release()

    def test_different_db_files_do_not_conflict(self, tmp_path: Path) -> None:
        first = acquire_instance_lock(_db_url(tmp_path / "a.db"), port=1)
        try:
            second = acquire_instance_lock(_db_url(tmp_path / "b.db"), port=2)
            try:
                assert second is not None
            finally:
                second.release()
        finally:
            first.release()

    def test_refusal_retries_payload_written_in_acquire_window(self, db_path: Path) -> None:
        """The winner writes its payload after acquiring the OS lock.  A loser
        in that tiny window must poll briefly instead of reporting an empty or
        stale payload as an unreadable/dead holder."""
        lock_path = lock_path_for_db(db_path)
        fd = os.open(str(lock_path), os.O_RDWR | os.O_CREAT, 0o644)
        instance_lock._os_lock(fd)  # holder acquired; payload not written yet

        def delayed_payload() -> None:
            encoded = json.dumps(
                {"pid": 424242, "port": 25584, "started_at": "in-flight"}
            ).encode("utf-8")
            os.lseek(fd, 0, os.SEEK_SET)
            os.write(fd, encoded)
            os.ftruncate(fd, len(encoded))

        writer = threading.Timer(0.03, delayed_payload)
        writer.start()
        try:
            with pytest.raises(InstanceLockHeldError) as excinfo:
                acquire_instance_lock(_db_url(db_path), port=25599)
        finally:
            writer.join(timeout=5)
            instance_lock._os_unlock(fd)
            os.close(fd)

        assert excinfo.value.holder is not None
        assert excinfo.value.holder.pid == 424242
        assert excinfo.value.holder.port == 25584


class TestProbeActiveLock:
    def test_probe_reports_active_holder_without_taking_over(self, db_path: Path) -> None:
        first = acquire_instance_lock(_db_url(db_path), port=25584)
        try:
            refusal = instance_lock.probe_instance_lock(_db_url(db_path))
            assert refusal is not None
            assert refusal.holder is not None
            assert refusal.holder.pid == os.getpid()
            assert refusal.holder.port == 25584
            assert str(os.getpid()) in str(refusal)
        finally:
            first.release()

    def test_probe_is_none_when_lock_is_free_or_not_applicable(self, db_path: Path) -> None:
        assert instance_lock.probe_instance_lock(_db_url(db_path)) is None
        assert instance_lock.probe_instance_lock("sqlite+aiosqlite:///:memory:") is None
        # A free probe must not retain the byte range: acquisition still works.
        lock = acquire_instance_lock(_db_url(db_path), port=1)
        try:
            assert lock is not None
        finally:
            lock.release()

    def test_probe_honours_multi_instance_override(
        self, db_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        first = acquire_instance_lock(_db_url(db_path), port=25584)
        try:
            monkeypatch.setenv(ALLOW_MULTI_INSTANCE_ENV, "1")
            assert instance_lock.probe_instance_lock(_db_url(db_path)) is None
        finally:
            first.release()


class TestTakeover:
    def test_takeover_after_clean_release(self, db_path: Path) -> None:
        first = acquire_instance_lock(_db_url(db_path), port=25584)
        first.release()
        second = acquire_instance_lock(_db_url(db_path), port=25599)
        try:
            assert second is not None
        finally:
            second.release()

    def test_takeover_after_holder_process_death(self, db_path: Path) -> None:
        """A crashed/killed holder must not block startup: the OS releases
        kernel-level locks on process death.  Spawns a real child process so
        the test exercises true cross-process locking semantics."""
        child = subprocess.Popen(
            [
                sys.executable,
                "-c",
                "import sys, time; sys.path.insert(0, sys.argv[1]);"
                "from stitch_backend.instance_lock import acquire_instance_lock;"
                "lock = acquire_instance_lock(sys.argv[2], 25584);"
                "assert lock is not None;"
                "time.sleep(60)",
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                _db_url(db_path),
            ],
        )
        try:
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if lock_path_for_db(db_path).exists() and b'"pid"' in (
                    lock_path_for_db(db_path).read_bytes()
                ):
                    break
                time.sleep(0.1)
            else:
                pytest.fail("child never acquired the lock")
            # Same-process acquire is refused while the child lives.
            with pytest.raises(InstanceLockHeldError):
                acquire_instance_lock(_db_url(db_path), port=25599)
            # Hard-kill the holder mid-lock — the crash scenario.  Kill the
            # pid recorded in the payload rather than the direct child: the
            # venv python.exe is a redirector shim, so killing the Popen
            # handle would orphan the real interpreter (and the lock).
            holder_pid = json.loads(
                lock_path_for_db(db_path).read_text(encoding="utf-8")
            )["pid"]
            import signal

            os.kill(holder_pid, signal.SIGTERM)
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                try:
                    os.kill(holder_pid, 0)
                except OSError:
                    break
                time.sleep(0.1)
            child.wait(timeout=10)
            # Takeover must succeed immediately: no stale lock.
            second = acquire_instance_lock(_db_url(db_path), port=25599)
            try:
                assert second is not None
                payload = json.loads(lock_path_for_db(db_path).read_text(encoding="utf-8"))
                assert payload["pid"] == os.getpid()
                assert payload["port"] == 25599
            finally:
                second.release()
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=10)

    def test_release_is_idempotent(self, db_path: Path) -> None:
        lock = acquire_instance_lock(_db_url(db_path), port=1)
        lock.release()
        lock.release()  # must not raise


class TestOverride:
    def test_allow_multi_instance_env_bypasses(
        self, db_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        first = acquire_instance_lock(_db_url(db_path), port=25584)
        try:
            monkeypatch.setenv(ALLOW_MULTI_INSTANCE_ENV, "1")
            assert acquire_instance_lock(_db_url(db_path), port=25599) is None
        finally:
            first.release()

    def test_override_logs_loud_warning(
        self, db_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        monkeypatch.setenv(ALLOW_MULTI_INSTANCE_ENV, "1")
        with caplog.at_level("WARNING", logger="stitch_backend.instance_lock"):
            acquire_instance_lock(_db_url(db_path), port=1)
        assert any("MULTI-INSTANCE" in rec.message.upper() for rec in caplog.records)

    def test_zero_value_does_not_bypass(
        self, db_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        first = acquire_instance_lock(_db_url(db_path), port=1)
        try:
            monkeypatch.setenv(ALLOW_MULTI_INSTANCE_ENV, "0")
            with pytest.raises(InstanceLockHeldError):
                acquire_instance_lock(_db_url(db_path), port=2)
        finally:
            first.release()


class TestLifespanOrdering:
    """Mechanical guard: the lock must be acquired BEFORE the first DB write
    (create_all_tables) in the lifespan — a silent reorder reintroduces the
    multi-writer hazard this lock exists to prevent."""

    def test_lock_acquired_before_create_all_tables(self) -> None:
        import inspect

        import stitch_backend.main as main_module

        source = inspect.getsource(main_module.lifespan)
        # Match the actual call sites, not mentions in comments.  The lifespan
        # delegates the migration/worker sequence to a helper — the lock must
        # be acquired before that helper runs, and the helper's first step
        # must be create_all_tables (the first DB write).
        acquire_pos = source.find("acquire_instance_lock(")
        helper_pos = source.find("_startup_migrations_and_workers(settings)")
        assert acquire_pos != -1, "lifespan never acquires the instance lock"
        assert helper_pos != -1, "lifespan no longer runs the startup helper"
        assert acquire_pos < helper_pos, (
            "instance lock is acquired AFTER the startup helper — "
            "the first DB write happens unguarded"
        )

        helper_source = inspect.getsource(main_module._startup_migrations_and_workers)
        first_step = helper_source.find("await create_all_tables")
        assert first_step != -1, "startup helper no longer creates tables first"
        for earlier_write in (
            "seed_permission_defaults",
            "bootstrap_initial_admin",
            "migrate_plaintext_secrets",
        ):
            write_pos = helper_source.find(earlier_write)
            assert write_pos == -1 or write_pos > first_step, (
                f"{earlier_write} runs before create_all_tables in the startup helper"
            )

    def test_lock_released_on_shutdown(self) -> None:
        import inspect

        import stitch_backend.main as main_module

        source = inspect.getsource(main_module.lifespan)
        assert ".release()" in source, "lifespan never releases the instance lock"

    @pytest.mark.asyncio()
    async def test_shutdown_step_failure_still_runs_remaining_steps_and_releases(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A broken stop hook must not strand the instance lock in embedded or
        test runners.  Shutdown is best-effort: later steps still run and the
        kernel-lock handle is always released."""
        import stitch_backend.main as main_module
        from stitch_backend.domains.key_health.probe_worker import KeyHealthProbeWorker

        fake_lock = MagicMock()
        monkeypatch.setattr(main_module, "configure_logging", MagicMock())
        monkeypatch.setattr(main_module.startup, "log_startup_banner", AsyncMock())
        monkeypatch.setattr(
            main_module, "acquire_instance_lock", MagicMock(return_value=fake_lock)
        )
        monkeypatch.setattr(
            main_module,
            "_startup_migrations_and_workers",
            AsyncMock(return_value=(MagicMock(), MagicMock(), MagicMock(), MagicMock())),
        )

        monkeypatch.setattr(
            main_module.startup,
            "stop_replenishment_service",
            AsyncMock(side_effect=RuntimeError("stop boom")),
        )
        stop_plugins = AsyncMock()
        stop_scheduler = AsyncMock()
        stop_gateway = AsyncMock()
        emit_stopping = AsyncMock()
        dispose = AsyncMock()
        monkeypatch.setattr(main_module.startup, "stop_plugin_hosts_and_sidecars", stop_plugins)
        monkeypatch.setattr(main_module.startup, "stop_scheduler_worker", stop_scheduler)
        monkeypatch.setattr(main_module.startup, "stop_gateway_workers", stop_gateway)
        monkeypatch.setattr(main_module.startup, "emit_app_stopping", emit_stopping)
        monkeypatch.setattr(main_module, "dispose_engine", dispose)
        monkeypatch.setattr(main_module.workers, "stop_task", AsyncMock())

        # patch.object restores the original classmethod descriptor exactly;
        # monkeypatching the class attribute directly would restore the bound
        # method object instead.
        with patch.object(KeyHealthProbeWorker, "stop", AsyncMock()):
            async with main_module.lifespan(MagicMock()):
                pass

        stop_plugins.assert_awaited_once()
        stop_scheduler.assert_awaited_once()
        stop_gateway.assert_awaited_once()
        emit_stopping.assert_awaited_once()
        dispose.assert_awaited_once()
        fake_lock.release.assert_called_once_with()

    @pytest.mark.asyncio()
    async def test_lock_released_even_when_shutdown_raises_base_exception(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The release is in ``finally``: even an uncaught BaseException from
        shutdown (cancellation/keyboard-interrupt class failures) cannot
        strand the handle in an embedded runner."""

        class ShutdownFatal(BaseException):
            pass

        import stitch_backend.main as main_module

        fake_lock = MagicMock()
        monkeypatch.setattr(main_module, "configure_logging", MagicMock())
        monkeypatch.setattr(main_module.startup, "log_startup_banner", AsyncMock())
        monkeypatch.setattr(
            main_module, "acquire_instance_lock", MagicMock(return_value=fake_lock)
        )
        monkeypatch.setattr(
            main_module,
            "_startup_migrations_and_workers",
            AsyncMock(return_value=(MagicMock(), MagicMock(), MagicMock(), MagicMock())),
        )
        monkeypatch.setattr(
            main_module.startup,
            "stop_replenishment_service",
            AsyncMock(side_effect=ShutdownFatal()),
        )

        with pytest.raises(ShutdownFatal):
            async with main_module.lifespan(MagicMock()):
                pass

        fake_lock.release.assert_called_once_with()
