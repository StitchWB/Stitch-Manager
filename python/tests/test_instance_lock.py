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
import time
from typing import TYPE_CHECKING

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
