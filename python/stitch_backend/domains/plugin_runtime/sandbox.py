"""Per-user developer sandbox for service plugins (server-side).

A sandbox plugin is owned by a single authenticated user.  It runs on the
server inside the user's private scope, is visible and callable only by its
owner, and shadows any global plugin with the same id for that owner.

Storage layout (``autoreg.plugin.layout``):

    <base>/sandbox/<user_id>/<plugin_id>/          # package dir
    <base>/sandbox/<user_id>/<plugin_id>-data/     # data dir (plugin.db)

The host registry is keyed ``(user_id, plugin_id) → ServicePluginHost``.
Hosts are started **on demand** (lazily by routing) — never at app boot.
A lightweight periodic task stops hosts idle > 15 minutes (keeps them
registered for cheap restart).

Sandbox hosts use ``source="sandbox"`` for status clarity but inherit the
community sandbox caps (5s call timeout, 256MB memory limit) — the caps
apply regardless of env (see ``host.py``).

TOFU pins are scoped per ``(user_id, plugin_id)`` in a separate file
(``sandbox_plugin_pins.json``) — global pins are untouched.
"""

from __future__ import annotations

import logging
import shutil
import time
from pathlib import Path
from typing import TYPE_CHECKING

from autoreg.plugin.layout import (
    sandbox_plugin_data_dir,
    sandbox_plugin_dir,
    sandbox_user_dir,
)
from stitch_backend.domains.sidecar import get_supervisor

if TYPE_CHECKING:
    from autoreg.plugin.manifest import PluginManifest

from .host import ServicePluginHost

logger = logging.getLogger(__name__)

#: Best-effort memory cap (MB) for sandbox hosts — mirrors community caps.
_SANDBOX_MEMORY_LIMIT_MB = 256

#: Idle threshold (seconds) — hosts unused for this long are stopped.
IDLE_STOP_SECONDS: float = 900.0  # 15 minutes

#: ``(user_id, plugin_id) → ServicePluginHost``
_sandbox_hosts: dict[tuple[int, str], "ServicePluginHost"] = {}

#: ``(user_id, plugin_id) → PluginManifest``
_sandbox_manifests: dict[tuple[int, str], "PluginManifest"] = {}

#: ``(user_id, plugin_id) → monotonic timestamp of last use``
_sandbox_last_use: dict[tuple[int, str], float] = {}


def _reset_state() -> None:
    """Clear all sandbox registries (test isolation)."""
    _sandbox_hosts.clear()
    _sandbox_manifests.clear()
    _sandbox_last_use.clear()


def register_sandbox_manifest(
    user_id: int, plugin_id: str, manifest: "PluginManifest"
) -> None:
    """Store manifest metadata for a sandbox plugin (idempotent)."""
    _sandbox_manifests[(user_id, plugin_id)] = manifest


def get_sandbox_manifest(
    user_id: int, plugin_id: str
) -> "PluginManifest | None":
    return _sandbox_manifests.get((user_id, plugin_id))


def get_sandbox_host(
    user_id: int, plugin_id: str
) -> "ServicePluginHost | None":
    """Return the registered sandbox host (no start).  None if not registered."""
    return _sandbox_hosts.get((user_id, plugin_id))


def _try_read_manifest(package_dir: Path) -> "PluginManifest | None":
    """Read + validate a manifest, returning None on any failure."""
    import json

    from autoreg.plugin.manifest import (
        ManifestValidationError,
        validate_manifest,
    )

    manifest_path = package_dir / "plugin.json"
    if not manifest_path.is_file():
        return None
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        return validate_manifest(raw)
    except (OSError, ValueError, ManifestValidationError):
        return None


async def ensure_sandbox_host(
    user_id: int, plugin_id: str
) -> "ServicePluginHost | None":
    """Get or create+start the sandbox host for ``(user_id, plugin_id)``.

    Returns ``None`` when the plugin is not installed in the user's sandbox
    (no package dir).  When the host is registered but stopped (idle-stop
    or crash), it is restarted.  Updates the last-use timestamp.

    Called lazily by ``call_plugin_command`` — never at app boot.
    """
    key = (user_id, plugin_id)
    host = _sandbox_hosts.get(key)

    if host is None:
        # Check if the package is installed in the user's sandbox.
        pkg_dir = sandbox_plugin_dir(user_id, plugin_id)
        if not pkg_dir.is_dir():
            return None

        manifest = _sandbox_manifests.get(key)
        if manifest is None:
            manifest = _try_read_manifest(pkg_dir)
            if manifest is None:
                return None
            _sandbox_manifests[key] = manifest

        entry_module = manifest.entry.get("module")
        if not entry_module or not isinstance(entry_module, str):
            return None

        data_dir = sandbox_plugin_data_dir(user_id, plugin_id)
        host = ServicePluginHost(
            plugin_id=plugin_id,
            entry_module=entry_module,
            package_dir=pkg_dir,
            data_dir=data_dir,
            source="sandbox",
            memory_limit_mb=_SANDBOX_MEMORY_LIMIT_MB,
            sidecar_name=f"sandbox:{user_id}:{plugin_id}",
        )
        _sandbox_hosts[key] = host

    # Update last-use BEFORE starting so the idle-stop task doesn't race.
    _sandbox_last_use[key] = time.monotonic()

    # Start if not running (on-demand).  When the host was idle-stopped,
    # ``_stopping`` is True — clear it so ``start()`` proceeds.
    if not host.rpc.is_alive and not host._crash_loop:
        if host._stopping:
            host._stopping = False
        try:
            await host.start()
        except Exception as exc:  # noqa: BLE001 — never crash routing
            logger.warning(
                "Sandbox host %s/%s start failed: %s", user_id, plugin_id, exc
            )

    return host


async def stop_idle_hosts(idle_seconds: float = IDLE_STOP_SECONDS) -> int:
    """Stop sandbox hosts idle for more than ``idle_seconds``.

    Hosts stay registered (cheap restart on next use).  Returns the count
    of hosts stopped.  Called by the periodic idle-stop task in main.py.
    """
    now = time.monotonic()
    stopped = 0
    for key, host in list(_sandbox_hosts.items()):
        last_use = _sandbox_last_use.get(key, now)
        if (now - last_use) < idle_seconds:
            continue
        if not host.rpc.is_alive:
            continue  # already stopped
        try:
            await host.stop()
            stopped += 1
            logger.info(
                "Sandbox host %s/%s idle-stopped (idle %.0fs)",
                key[0], key[1], now - last_use,
            )
        except Exception as exc:  # noqa: BLE001 — best-effort
            logger.warning(
                "Sandbox host %s/%s idle-stop failed: %s",
                key[0], key[1], exc,
            )
    return stopped


async def uninstall_sandbox_plugin(
    user_id: int, plugin_id: str
) -> dict[str, object]:
    """Stop the host, remove package + data dirs, drop registry + pin.

    Returns ``{"success": True}`` on success, ``{"success": False,
    "error": ...}`` when the plugin is not installed.
    """
    key = (user_id, plugin_id)

    # Stop the host if running.
    host = _sandbox_hosts.get(key)
    if host is not None:
        try:
            await host.stop()
        except Exception as exc:  # noqa: BLE001 — best-effort
            logger.warning(
                "Sandbox host %s/%s stop on uninstall failed: %s",
                user_id, plugin_id, exc,
            )

    # Remove package + data dirs.
    pkg_dir = sandbox_plugin_dir(user_id, plugin_id)
    data_dir = sandbox_plugin_data_dir(user_id, plugin_id)
    removed_any = False
    for d in (pkg_dir, data_dir):
        if d.is_dir():
            shutil.rmtree(d, ignore_errors=True)
            removed_any = True

    # Drop registry entries.
    _sandbox_hosts.pop(key, None)
    _sandbox_manifests.pop(key, None)
    _sandbox_last_use.pop(key, None)

    # Remove scoped pin.
    from stitch_backend.domains.plugin_distribution.pins import remove_scoped_pin
    remove_scoped_pin(user_id, plugin_id)

    if not removed_any and host is None:
        return {"success": False, "error": f"not installed: {plugin_id}"}
    logger.info("Sandbox plugin %s/%s uninstalled", user_id, plugin_id)
    return {"success": True}


def list_sandbox_plugins(user_id: int) -> list[dict[str, object]]:
    """Return the caller's sandbox plugins with status + pin info.

    Scans the user's sandbox dir for installed packages and enriches
    each with: ``id``, ``version``, ``status`` (host status or None when
    not running), ``pinned_source`` (the scoped pin or None).
    """
    from stitch_backend.domains.plugin_distribution.pins import get_scoped_pin

    user_root = sandbox_user_dir(user_id)
    if not user_root.is_dir():
        return []

    out: list[dict[str, object]] = []
    for entry in sorted(user_root.iterdir()):
        if not entry.is_dir() or entry.name.endswith("-data"):
            continue
        plugin_id = entry.name
        manifest = _sandbox_manifests.get((user_id, plugin_id)) or _try_read_manifest(entry)
        if manifest is None:
            continue
        host = _sandbox_hosts.get((user_id, plugin_id))
        status = host.status() if host and host.rpc.is_alive else None
        pin = get_scoped_pin(user_id, plugin_id)
        out.append({
            "id": plugin_id,
            "version": manifest.version,
            "status": status,
            "pinned_source": pin,
        })
    return out


async def stop_all_sandbox() -> None:
    """Pre-set ``_stopping`` on every sandbox host (shutdown wiring).

    Called from the app lifespan shutdown BEFORE ``supervisor.stop_all()``
    so the crash monitor does not race the supervisor's kill-tree.  The
    supervisor's ``stop_all()`` kills the processes; this function only
    pre-sets the flag and cancels monitor tasks.
    """
    for host in list(_sandbox_hosts.values()):
        host._stopping = True
        if host._monitor_task and not host._monitor_task.done():
            host._monitor_task.cancel()
            host._monitor_task = None


__all__ = [
    "IDLE_STOP_SECONDS",
    "register_sandbox_manifest",
    "get_sandbox_manifest",
    "get_sandbox_host",
    "ensure_sandbox_host",
    "stop_idle_hosts",
    "uninstall_sandbox_plugin",
    "list_sandbox_plugins",
    "stop_all_sandbox",
    "_reset_state",
]
