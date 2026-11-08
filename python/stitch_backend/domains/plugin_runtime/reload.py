"""Per-plugin reload primitive for service plugins (dev-loop).

Reload re-reads ``plugin.json`` from disk and swaps the host, unlike
``restart_service_plugin`` which only restarts the existing process.  The
swap is serialized per plugin id so concurrent reloads cannot race.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from autoreg.plugin.loader import PluginLoader
from stitch_backend.domains.plugin_runtime import (
    get_host,
    register_host,
    register_manifest,
)
from stitch_backend.domains.plugin_runtime.discovery import (
    _make_service_host,
    _on_crash_loop,
    _preflight_manifest,
    _resolve_host_driver,
    _try_read_manifest,
)
from stitch_backend.domains.plugin_runtime.spi_bridge import (
    register_plugin_spi,
    unregister_plugin_spi,
)

if TYPE_CHECKING:
    from pathlib import Path

    from autoreg.plugin.manifest import PluginManifest

logger = logging.getLogger(__name__)

_reload_locks: dict[str, asyncio.Lock] = {}


@dataclass(frozen=True)
class ReloadResult:
    """Outcome of a service-plugin reload.

    ``ok`` is True only when a new host started and was registered.  On
    failure ``error_kind`` names the stage (``unknown_plugin``,
    ``no_package_dir``, ``invalid_manifest``, ``guard_failed``,
    ``start_failed``) and the old host is left registered (dead) — never
    silently resurrected.
    """

    ok: bool
    status: dict[str, Any] | None = None
    error: str | None = None
    error_kind: str | None = None


def _reload_lock(plugin_id: str) -> asyncio.Lock:
    lock = _reload_locks.get(plugin_id)
    if lock is None:
        lock = asyncio.Lock()
        _reload_locks[plugin_id] = lock
    return lock


def _static_validate(package_dir: Path) -> tuple[PluginManifest | None, str | None]:
    manifest = _try_read_manifest(package_dir)
    if manifest is None:
        return None, "manifest missing or invalid"
    try:
        from stitch_plugin_tools.ui_manifest import lint_contributions
    except ImportError:
        return manifest, None
    errors, _warnings = lint_contributions(manifest.id, manifest.contributions)
    if errors:
        return None, "; ".join(errors)
    return manifest, None


async def reload_service_plugin(plugin_id: str) -> ReloadResult:
    """Reload a service plugin from disk, swapping its host.

    Static-validates the manifest before any side effect, then stops the
    old host, re-reads the manifest, re-checks the start guards, and starts
    a new host.  The new host is registered only on a successful start; a
    failed start leaves the old host registered (dead).
    """
    host = get_host(plugin_id)
    if host is None:
        return ReloadResult(
            ok=False, error=f"unknown plugin: {plugin_id}", error_kind="unknown_plugin"
        )
    package_dir = host.package_dir
    if package_dir is None:
        return ReloadResult(
            ok=False,
            error=f"plugin {plugin_id} has no package dir",
            error_kind="no_package_dir",
        )

    manifest, error = _static_validate(package_dir)
    if manifest is None:
        return ReloadResult(ok=False, error=error, error_kind="invalid_manifest")

    async with _reload_lock(plugin_id):
        host = get_host(plugin_id)
        if host is None:
            return ReloadResult(
                ok=False,
                error=f"unknown plugin: {plugin_id}",
                error_kind="unknown_plugin",
            )
        unregister_plugin_spi(host)
        await host.stop_forced()

        manifest = _try_read_manifest(package_dir)
        if manifest is None:
            return ReloadResult(
                ok=False,
                error="manifest missing or invalid",
                error_kind="invalid_manifest",
            )
        reason = _preflight_manifest(manifest, PluginLoader())
        if reason is not None:
            return ReloadResult(ok=False, error=reason, error_kind="guard_failed")

        host_driver = await _resolve_host_driver(manifest, host.source)
        new_host = _make_service_host(
            manifest, package_dir, source=host.source, host_driver=host_driver
        )
        new_host.crash_hook = _on_crash_loop
        result = await new_host.start()
        if result.get("status") != "running":
            return ReloadResult(
                ok=False,
                error=result.get("error") or "new host failed to start",
                error_kind="start_failed",
            )
        register_host(new_host)
        register_manifest(plugin_id, manifest)
        register_plugin_spi(new_host, manifest)
        return ReloadResult(ok=True, status=result)


__all__ = ["ReloadResult", "reload_service_plugin"]
