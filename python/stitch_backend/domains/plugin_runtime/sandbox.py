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

SPI contract:
    Sandbox plugins do NOT participate in the SPI registry.  The SPI
    registry is global by design — ``register_plugin_spi`` is called only
    in ``discovery.py`` for global hosts.  A sandbox plugin's manifest may
    declare ``contributions.spi``, but those declarations are inert in
    sandbox mode: ``spi.resolve("mail_inbox")`` still hits the global
    plugin or built-in.  This contract is enforced by omission (the
    sandbox install/start flow never calls ``register_plugin_spi``) and
    made visible by a WARNING logged at install time
    (:func:`_warn_if_spi_declared`).  SPI integrations require a real
    global install (``dev-install``).
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import threading
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

#: Maximum concurrent ``host.stop()`` calls in ``stop_idle_hosts``.  Each
#: stop involves a graceful RPC shutdown + supervisor kill-tree (~3s);
#: without concurrency, N idle hosts take N×3s while the tick is 60s.
#: The semaphore bounds the concurrent stops to avoid overwhelming the
#: supervisor while still finishing well within the tick.
_IDLE_STOP_CONCURRENCY = 8

#: ``(user_id, plugin_id) → ServicePluginHost``
_sandbox_hosts: dict[tuple[int, str], "ServicePluginHost"] = {}

#: ``(user_id, plugin_id) → PluginManifest``
_sandbox_manifests: dict[tuple[int, str], "PluginManifest"] = {}

#: ``(user_id, plugin_id) → monotonic timestamp of last use``
_sandbox_last_use: dict[tuple[int, str], float] = {}

#: Per-key locks serializing ``ensure_sandbox_host`` (create + start) per
#: ``(user_id, plugin_id)``.  Without this, two concurrent ensures for the
#: same key each create a ``ServicePluginHost`` and the first process is
#: orphaned.  Locks are created lazily under ``_ensure_locks_guard``.
_ensure_locks: dict[tuple[int, str], asyncio.Lock] = {}
_ensure_locks_guard = threading.Lock()

#: Set ``True`` by :func:`stop_all_sandbox` (app shutdown).  While set,
#: ``ensure_sandbox_host`` refuses to start hosts instead of racing the
#: supervisor's kill-tree.
_sandbox_shutting_down = False


def _reset_state() -> None:
    """Clear all sandbox registries (test isolation)."""
    global _sandbox_shutting_down
    _sandbox_hosts.clear()
    _sandbox_manifests.clear()
    _sandbox_last_use.clear()
    _ensure_locks.clear()
    _sandbox_shutting_down = False


def register_sandbox_manifest(
    user_id: int, plugin_id: str, manifest: "PluginManifest"
) -> None:
    """Store manifest metadata for a sandbox plugin (idempotent).

    Also warns when the manifest declares ``contributions.spi`` — sandbox
    plugins do not serve SPI (see the module docstring's SPI contract).
    """
    _sandbox_manifests[(user_id, plugin_id)] = manifest
    _warn_if_spi_declared(plugin_id, manifest)


def _warn_if_spi_declared(plugin_id: str, manifest: "PluginManifest") -> None:
    """Log a WARNING when a sandbox plugin's manifest declares SPI
    contributions.

    Sandbox plugins do not participate in the SPI registry — SPI calls
    resolve to the global plugin or built-in.  This warning makes the
    contract visible so authors know their SPI declarations are inert in
    sandbox mode and that activating SPI integrations requires a real
    global install (``dev-install``).
    """
    contributions = getattr(manifest, "contributions", None) or {}
    spi_names = contributions.get("spi", [])
    if not isinstance(spi_names, list) or not spi_names:
        return
    declared = [s for s in spi_names if isinstance(s, str)]
    if not declared:
        return
    logger.warning(
        "Sandbox plugin %s declares SPI contributions %s — sandbox plugins "
        "do not serve SPI; SPI calls resolve to the global plugin or "
        "built-in. Install via dev-install (global) to activate SPI "
        "integrations.",
        plugin_id, declared,
    )


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

    The whole body runs under a per-key lock so two concurrent callers for
    the same ``(user_id, plugin_id)`` cannot each create a host (the loser
    would orphan the winner's process).  Raises ``RuntimeError`` when a
    global sandbox shutdown is in progress (``stop_all_sandbox`` ran).
    """
    key = (user_id, plugin_id)
    with _ensure_locks_guard:
        lock = _ensure_locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            _ensure_locks[key] = lock

    async with lock:
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

        # A sandbox host exists or would be created/started by this call.
        # Refuse during a global sandbox shutdown — starting a host here
        # would race the supervisor's kill-tree.  Callers WITHOUT a sandbox
        # plugin already returned None above and fall through to the global
        # host path unchanged.
        if _sandbox_shutting_down:
            raise RuntimeError(
                f"sandbox shutdown in progress — refusing to start host "
                f"for user {user_id} plugin {plugin_id!r}"
            )

        if host is None:
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

        # Start if not running (on-demand).  When the host was idle-stopped,
        # ``_stopping`` is True — clear it so ``start()`` proceeds.  This is
        # safe: a global shutdown refuses above, so the flag here can only
        # come from an idle-stop / prior stop, not from ``stop_all_sandbox``.
        if not host.rpc.is_alive and not host._crash_loop:
            if host._stopping:
                host._stopping = False
            try:
                await host.start()
            except Exception as exc:  # noqa: BLE001 — never crash routing
                logger.warning(
                    "Sandbox host %s/%s start failed: %s", user_id, plugin_id, exc
                )

        # Touch last-use only AFTER a successful start (or when the host was
        # already alive).  A failed start must not look fresh to the
        # idle-stop task.
        if host.rpc.is_alive:
            _sandbox_last_use[key] = time.monotonic()

        return host


async def stop_idle_hosts(idle_seconds: float = IDLE_STOP_SECONDS) -> int:
    """Stop sandbox hosts idle for more than ``idle_seconds``.

    Hosts stay registered (cheap restart on next use).  Returns the count
    of hosts stopped.  Called by the periodic idle-stop task in main.py.

    Stops concurrently with ``asyncio.gather`` bounded by a semaphore
    (``_IDLE_STOP_CONCURRENCY``) so N idle hosts stop in ~ceil(N/8)×single-stop
    instead of N×single-stop.  Per-host error isolation: one failing stop
    does not kill the batch (each stop is wrapped in try/except).
    """
    now = time.monotonic()
    # Collect idle hosts to stop (snapshot the registry — the loop is
    # safe against concurrent ensure_sandbox_host because the per-key lock
    # serializes start; a host collected here is either stopped or was
    # already stopped — both are fine).
    to_stop: list[tuple[tuple[int, str], "ServicePluginHost"]] = []
    for key, host in list(_sandbox_hosts.items()):
        last_use = _sandbox_last_use.get(key, now)
        if (now - last_use) < idle_seconds:
            continue
        if not host.rpc.is_alive:
            continue  # already stopped
        to_stop.append((key, host))

    if not to_stop:
        return 0

    sem = asyncio.Semaphore(_IDLE_STOP_CONCURRENCY)

    async def _stop_one(
        key: tuple[int, str], host: "ServicePluginHost"
    ) -> bool:
        async with sem:
            try:
                await host.stop()
                logger.info(
                    "Sandbox host %s/%s idle-stopped (idle %.0fs)",
                    key[0], key[1], now - _sandbox_last_use.get(key, now),
                )
                return True
            except Exception as exc:  # noqa: BLE001 — best-effort
                logger.warning(
                    "Sandbox host %s/%s idle-stop failed: %s",
                    key[0], key[1], exc,
                )
                return False

    results = await asyncio.gather(
        *[_stop_one(key, host) for key, host in to_stop]
    )
    return sum(1 for r in results if r)


async def uninstall_sandbox_plugin(
    user_id: int, plugin_id: str, *, forget_pin: bool = False
) -> dict[str, object]:
    """Stop the host, remove package + data dirs, drop registry entries.

    The scoped TOFU pin is **kept** by default so a reinstall with a
    different source sha is refused (defeats silent source swaps).  Pass
    ``forget_pin=True`` to clear the pin (dedicated forget path — the
    caller acknowledges the source change).

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

    # Keep the scoped pin by default (TOFU: reinstall must match the
    # original source).  Only remove when the caller explicitly requests
    # forget_pin=True (dedicated forget path).
    if forget_pin:
        from stitch_backend.domains.plugin_distribution.pins import remove_scoped_pin
        remove_scoped_pin(user_id, plugin_id)

    if not removed_any and host is None:
        return {"success": False, "error": f"not installed: {plugin_id}"}
    logger.info(
        "Sandbox plugin %s/%s uninstalled (pin %s)",
        user_id, plugin_id, "forgotten" if forget_pin else "kept",
    )
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

    Also sets the module-level shutdown flag so a concurrent
    ``ensure_sandbox_host`` refuses to start a new host mid-shutdown
    (instead of clearing ``_stopping`` and racing the kill-tree).
    """
    global _sandbox_shutting_down
    _sandbox_shutting_down = True
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
