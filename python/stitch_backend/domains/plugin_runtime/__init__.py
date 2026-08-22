"""Service-plugin runtime — host registry and shutdown wiring.

Each :class:`ServicePluginHost` registers a ``SidecarSpec`` with the
process-wide :class:`SidecarSupervisor`, so the supervisor's
``stop_all()`` (called from the app lifespan shutdown) kills every
plugin process.  The host's ``on_stop`` hook closes the RPC client
pipes and cancels the crash monitor.  This module's own ``stop_all()``
pre-sets the stopping flag on every host so the crash monitor does not
race the shutdown.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from stitch_backend.domains.sidecar import get_supervisor

if TYPE_CHECKING:
    from autoreg.plugin.manifest import PluginManifest

    from .host import ServicePluginHost

logger = logging.getLogger(__name__)

_hosts: dict[str, ServicePluginHost] = {}

#: Manifest metadata for each registered plugin id.  The host itself
#: owns the process lifecycle; the manifest is stored alongside so
#: ``list_service_plugins`` can surface contributions (ui/i18n/commands)
#: without re-reading the package directory on every call.
_manifests: dict[str, PluginManifest] = {}


def register_host(host: "ServicePluginHost") -> None:
    """Add a host to the active registry (idempotent per plugin_id)."""
    _hosts[host.plugin_id] = host


def get_host(plugin_id: str) -> "ServicePluginHost | None":
    return _hosts.get(plugin_id)


def all_hosts() -> list["ServicePluginHost"]:
    return list(_hosts.values())


def status_all() -> list[dict]:
    return [h.status() for h in _hosts.values()]


def register_manifest(plugin_id: str, manifest: "PluginManifest") -> None:
    """Store manifest metadata for a plugin id (idempotent)."""
    _manifests[plugin_id] = manifest


def get_manifest(plugin_id: str) -> "PluginManifest | None":
    return _manifests.get(plugin_id)


def all_manifests() -> list["PluginManifest"]:
    return list(_manifests.values())


async def stop_all() -> None:
    """Stop every active plugin host.

    Pre-sets ``_stopping`` on all hosts so the crash monitor does not
    attempt a restart while the supervisor is killing processes, then
    delegates to ``supervisor.stop_all()`` which kills the trees and
    invokes each host's ``on_stop`` hook (RPC pipe cleanup).

    Also unregisters all plugin-backed SPI proxies so the registry is
    clean for the next startup (tests, CLI re-run).
    """
    for host in list(_hosts.values()):
        host._stopping = True
    # Unregister plugin-backed SPI impls so spi.resolve() falls back to
    # built-in immediately (before the supervisor kills the processes).
    try:
        from stitch_backend.domains.plugin_runtime.spi_bridge import (
            unregister_all_plugin_spi,
        )
        unregister_all_plugin_spi()
    except Exception:  # noqa: BLE001 — best-effort cleanup
        pass
    await get_supervisor().stop_all()


__all__ = [
    "register_host",
    "get_host",
    "all_hosts",
    "status_all",
    "register_manifest",
    "get_manifest",
    "all_manifests",
    "stop_all",
]
