"""SidecarSpec construction for a plugin host's child process."""

from __future__ import annotations

from typing import TYPE_CHECKING

from stitch_backend.domains.sidecar import LaunchPlan, SidecarSpec

if TYPE_CHECKING:
    from stitch_backend.domains.plugin_runtime.host import ServicePluginHost


def make_spec(host: ServicePluginHost) -> SidecarSpec:
    def prepare(_settings: dict | None) -> LaunchPlan:
        return LaunchPlan(
            command=list(host._command),
            cwd=host._cwd,
            env=dict(host._env),
            stdio="pipes",
            config={"plugin_id": host.plugin_id},
        )

    def on_stop() -> None:
        host._stopping = True
        if host._monitor_task and not host._monitor_task.done():
            host._monitor_task.cancel()
        try:
            host.rpc._finalize()
        except Exception:  # noqa: BLE001
            pass

    return SidecarSpec(
        name=host.sidecar_name,
        display_name=f"Plugin: {host.plugin_id}",
        prepare=prepare,
        on_stop=on_stop,
    )
