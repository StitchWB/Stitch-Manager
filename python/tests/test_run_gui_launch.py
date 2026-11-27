"""Regression tests for the desktop launcher port-conflict handling.

Context: the launcher used to kill *whatever* held the API port
unconditionally.  On machines where a dev backend and the release app
coexisted, each side force-killed the other in a loop; on user machines a
healthy already-running instance was murdered instead of reused.  The fix
classifies the port owner first and only kills unresponsive zombies.
"""

from __future__ import annotations

import sys
from typing import TYPE_CHECKING
from unittest.mock import MagicMock, patch

import pytest
import requests

if TYPE_CHECKING:
    from pathlib import Path

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.dirname(__import__("os").path.abspath(__file__))))

import run_gui  # noqa: E402


def _response(status: int = 200, payload: object = None, bad_json: bool = False):
    resp = MagicMock()
    resp.status_code = status
    if bad_json:
        resp.json.side_effect = ValueError("not json")
    else:
        resp.json.return_value = payload if payload is not None else {}
    return resp


class TestProbePortOwner:
    def test_healthy_stitch_backend(self) -> None:
        with patch.object(run_gui.requests, "get", return_value=_response(200, {"status": "ok"})):
            assert run_gui._probe_port_owner() == "stitch"

    def test_foreign_http_service_wrong_shape(self) -> None:
        with patch.object(run_gui.requests, "get", return_value=_response(200, {"health": "green"})):
            assert run_gui._probe_port_owner() == "foreign"

    def test_foreign_http_service_non_200(self) -> None:
        with patch.object(run_gui.requests, "get", return_value=_response(404, {"status": "ok"})):
            assert run_gui._probe_port_owner() == "foreign"

    def test_foreign_http_service_non_json(self) -> None:
        with patch.object(run_gui.requests, "get", return_value=_response(200, bad_json=True)):
            assert run_gui._probe_port_owner() == "foreign"

    def test_unresponsive_when_connection_refused(self) -> None:
        with patch.object(run_gui.requests, "get", side_effect=requests.ConnectionError()):
            assert run_gui._probe_port_owner() == "unresponsive"

    def test_unresponsive_when_timeout(self) -> None:
        with patch.object(run_gui.requests, "get", side_effect=requests.Timeout()):
            assert run_gui._probe_port_owner() == "unresponsive"


class TestResolvePortConflict:
    """The core safety invariant: healthy instances are reused, foreign
    processes are never killed, only zombies are terminated."""

    def test_attach_when_healthy_stitch(self) -> None:
        assert run_gui._resolve_port_conflict(25584, probe=lambda: "stitch") == "attach"

    def test_abort_when_foreign(self) -> None:
        assert run_gui._resolve_port_conflict(25584, probe=lambda: "foreign") == "abort"

    def test_kill_only_when_zombie(self) -> None:
        assert run_gui._resolve_port_conflict(25584, probe=lambda: "unresponsive") == "kill"

    def test_probe_actually_called(self) -> None:
        probe = MagicMock(return_value="stitch")
        run_gui._resolve_port_conflict(25584, probe=probe)
        probe.assert_called_once_with()


class TestInstanceLockRefusalSurfacing:
    """The backend process swallows lifespan exceptions inside uvicorn; the
    launcher must read the intentionally readable lock payload and turn a DB
    instance refusal into a user-visible actionable error."""

    @staticmethod
    def _db_url(path: Path) -> str:
        return "sqlite+aiosqlite:///" + str(path).replace("\\", "/")

    def test_lock_refusal_message_includes_holder_details(self, tmp_path: Path) -> None:
        from stitch_backend.instance_lock import acquire_instance_lock

        db_path = tmp_path / "stitch.db"
        first = acquire_instance_lock(self._db_url(db_path), port=25599)
        try:
            message = run_gui._instance_lock_refusal_message(self._db_url(db_path))
        finally:
            first.release()

        assert message is not None
        assert "Another Stitch backend instance" in message
        assert "25599" in message
        assert "STITCH_ALLOW_MULTI_INSTANCE" in message

    def test_lock_refusal_message_none_when_lock_is_free(self, tmp_path: Path) -> None:
        assert run_gui._instance_lock_refusal_message(self._db_url(tmp_path / "stitch.db")) is None

    def test_lock_refusal_can_ignore_embedded_backend_own_pid(self, tmp_path: Path) -> None:
        from stitch_backend.instance_lock import acquire_instance_lock

        db_path = tmp_path / "stitch.db"
        first = acquire_instance_lock(self._db_url(db_path), port=25599)
        try:
            assert run_gui._instance_lock_refusal_message(self._db_url(db_path)) is not None
            assert (
                run_gui._instance_lock_refusal_message(
                    self._db_url(db_path), ignore_own_pid=True
                )
                is None
            )
        finally:
            first.release()

    def test_main_carries_preflight_lock_refusal_into_startup_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A pre-start probe captures the holder details.  Even if that other
        instance exits before the post-failure probe, the user still gets the
        original actionable refusal rather than a bare timeout."""
        message = "Another Stitch backend instance already owns database X (pid 123)"
        monkeypatch.setattr(sys, "argv", ["run_gui.py"])
        monkeypatch.setattr(run_gui, "_port_in_use", lambda _port: False)
        # Let the spawned thread finish immediately; startup is then forced to
        # fail through the mocked wait below, before any webview import.
        monkeypatch.setattr(run_gui, "_start_uvicorn", lambda: None)
        monkeypatch.setattr(run_gui, "_wait_for_server", lambda **_kwargs: False)
        probes: list[dict] = []

        def fake_lock_message(*_args, **kwargs):
            probes.append(kwargs)
            # First call is the pre-start capture.  The post-failure re-probe
            # finds the other instance already gone, so the fallback must be used.
            return message if len(probes) == 1 else None

        monkeypatch.setattr(run_gui, "_instance_lock_refusal_message", fake_lock_message)
        surfaced: list[str] = []
        monkeypatch.setattr(run_gui, "_surface_fatal_error", surfaced.append)

        with pytest.raises(SystemExit) as excinfo:
            run_gui.main()

        assert excinfo.value.code == 1
        assert surfaced == [message]
        assert probes[0] == {}
        assert probes[1] == {"ignore_own_pid": True}

    def test_startup_failure_surfaces_refusal_to_console_and_messagebox(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        message = "Another Stitch backend instance already owns database X (pid 123)"
        monkeypatch.setattr(
            run_gui, "_instance_lock_refusal_message", lambda **_kwargs: message
        )
        boxes: list[str] = []
        monkeypatch.setattr(run_gui, "_show_error_messagebox", boxes.append)

        with pytest.raises(SystemExit) as excinfo:
            run_gui._exit_backend_startup_failed()

        assert excinfo.value.code == 1
        assert boxes == [message]
        assert message in capsys.readouterr().err

    def test_startup_failure_falls_back_to_generic_timeout(
        self, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
    ) -> None:
        monkeypatch.setattr(run_gui, "_instance_lock_refusal_message", lambda **_kwargs: None)
        monkeypatch.setattr(run_gui, "_show_error_messagebox", lambda _message: None)

        with pytest.raises(SystemExit):
            run_gui._exit_backend_startup_failed()

        assert "Backend did not start in time" in capsys.readouterr().err


class TestWaitForServer:
    def test_returns_immediately_when_owned_backend_thread_died(self) -> None:
        class DeadThread:
            def is_alive(self) -> bool:
                return False

        with patch.object(
            run_gui.requests,
            "get",
            side_effect=AssertionError("must not probe HTTP after thread death"),
        ):
            assert run_gui._wait_for_server(timeout=10, server_thread=DeadThread()) is False


class TestHealthTimeout:
    def test_default_raised_above_20s(self) -> None:
        # 20s was measured borderline (in-python boot ~4-5s warm, much worse
        # with sqlite lock contention or cold AV-scanned extraction).
        assert run_gui.HEALTH_TIMEOUT >= 60

    def test_env_override(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import importlib

        monkeypatch.setenv("STITCH_HEALTH_TIMEOUT", "120")
        reloaded = importlib.reload(run_gui)
        try:
            assert reloaded.HEALTH_TIMEOUT == 120.0
        finally:
            monkeypatch.delenv("STITCH_HEALTH_TIMEOUT")
            importlib.reload(run_gui)
