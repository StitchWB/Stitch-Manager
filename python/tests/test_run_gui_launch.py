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

import requests

if TYPE_CHECKING:
    import pytest

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
