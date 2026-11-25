"""Tests for host-level runtime controls: restart/enable state coherence.

Regression target: ``restart_service_plugin`` used to restart a DISABLED
plugin (host.restart() never consulted the persisted disabled flag) while
the flag stayed set — the plugin came back up but every surface reported
it as disabled.  The restart command now honors the flag and returns the
same ``{id, enabled, status}`` shape as ``set_service_plugin_enabled``.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

import stitch_backend.domains.plugin_runtime.bridge as bridge


class FakeHost:
    """Minimal host double: tracks lifecycle calls and liveness."""

    def __init__(self, plugin_id: str, alive: bool = False) -> None:
        self.plugin_id = plugin_id
        self.rpc = SimpleNamespace(is_alive=alive)
        self.started = 0
        self.stopped = 0
        self.restarted = 0

    async def start(self) -> dict[str, Any]:
        self.started += 1
        self.rpc.is_alive = True
        return self.status()

    async def stop(self) -> dict[str, Any]:
        self.stopped += 1
        self.rpc.is_alive = False
        return self.status()

    async def restart(self) -> dict[str, Any]:
        self.restarted += 1
        self.rpc.is_alive = True
        return self.status()

    def status(self) -> dict[str, Any]:
        return {
            "status": "running" if self.rpc.is_alive else "stopped",
            "pid": 1234 if self.rpc.is_alive else None,
            "plugin_id": self.plugin_id,
            "restarts": self.restarted,
            "stopping": False,
        }


@pytest.fixture()
def runtime_env(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Wire the bridge to fake hosts + an in-memory disabled set."""
    hosts: dict[str, FakeHost] = {}
    disabled: set[str] = set()

    monkeypatch.setattr(bridge, "get_host", lambda pid: hosts.get(pid))
    monkeypatch.setattr(bridge, "is_plugin_disabled", lambda pid: pid in disabled)
    monkeypatch.setattr(
        bridge,
        "set_plugin_disabled",
        lambda pid, flag: disabled.add(pid) if flag else disabled.discard(pid),
    )
    return {"hosts": hosts, "disabled": disabled}


async def test_restart_of_disabled_plugin_does_not_start(runtime_env) -> None:
    host = FakeHost("echo", alive=False)
    runtime_env["hosts"]["echo"] = host
    runtime_env["disabled"].add("echo")

    result = await bridge._restart_service_plugin({"plugin_id": "echo"})

    assert result["id"] == "echo"
    assert result["enabled"] is False
    assert result["status"]["status"] == "stopped"
    # Never restarted, never started.
    assert host.restarted == 0
    assert host.started == 0
    # Persisted flag untouched.
    assert "echo" in runtime_env["disabled"]


async def test_restart_of_disabled_stops_stray_live_host(runtime_env) -> None:
    host = FakeHost("echo", alive=True)  # somehow alive despite the flag
    runtime_env["hosts"]["echo"] = host
    runtime_env["disabled"].add("echo")

    result = await bridge._restart_service_plugin({"plugin_id": "echo"})

    assert result["enabled"] is False
    assert host.restarted == 0
    assert host.stopped == 1  # defensive stop
    assert host.rpc.is_alive is False
    assert result["status"]["status"] == "stopped"


async def test_restart_of_enabled_plugin_restarts_and_reports(runtime_env) -> None:
    host = FakeHost("echo", alive=True)
    runtime_env["hosts"]["echo"] = host

    result = await bridge._restart_service_plugin({"plugin_id": "echo"})

    assert result["id"] == "echo"
    assert result["enabled"] is True
    assert result["status"]["status"] == "running"
    assert host.restarted == 1


async def test_enable_then_restart_round_trip_keeps_flag_clear(runtime_env) -> None:
    host = FakeHost("echo", alive=False)
    runtime_env["hosts"]["echo"] = host
    runtime_env["disabled"].add("echo")

    enabled_result = await bridge._set_service_plugin_enabled(
        {"plugin_id": "echo", "enabled": True}
    )
    assert enabled_result["enabled"] is True
    assert enabled_result["status"]["status"] == "running"
    assert "echo" not in runtime_env["disabled"]

    restart_result = await bridge._restart_service_plugin({"plugin_id": "echo"})
    assert restart_result["enabled"] is True
    assert host.restarted == 1
    assert "echo" not in runtime_env["disabled"]


async def test_restart_result_shape_matches_enable_shape(runtime_env) -> None:
    host = FakeHost("echo", alive=True)
    runtime_env["hosts"]["echo"] = host

    restart_result = await bridge._restart_service_plugin({"plugin_id": "echo"})
    assert set(restart_result.keys()) == {"id", "enabled", "status"}
