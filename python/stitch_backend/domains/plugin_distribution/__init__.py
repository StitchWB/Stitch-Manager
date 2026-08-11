"""Plugin distribution client — activation, sync, heartbeat (plan §3.1-3.2).

Public entry point: ``run_startup_sequence()`` — called from the app
lifespan after table creation.  In standalone mode (no STITCH_SERVER_URL)
it no-ops.  Never raises — distribution failures are logged and swallowed
so app startup is never blocked.
"""

from __future__ import annotations

import logging

import httpx

from .activation import ActivationService, ActivationState, derive_hwid
from .config import standalone_mode
from .heartbeat import HeartbeatClient
from .sync import ManifestReplayError, PluginSyncService, SyncReport

logger = logging.getLogger(__name__)

__all__ = [
    "ActivationService",
    "ActivationState",
    "HeartbeatClient",
    "ManifestReplayError",
    "PluginSyncService",
    "SyncReport",
    "derive_hwid",
    "run_startup_sequence",
]


async def run_startup_sequence() -> None:
    """Load activation → heartbeat → sync.  Never raises.

    - Standalone mode (no STITCH_SERVER_URL): no-op.
    - Not activated: no-op.
    - Heartbeat revoked: degraded mode, sync skipped.
    - Otherwise: sync plugins from server.
    """
    if standalone_mode():
        logger.debug("Standalone mode — no plugin distribution server")
        return

    activation = ActivationService()
    state = activation.load()
    if state is None:
        logger.debug("Not activated — skipping plugin distribution startup")
        return

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            heartbeat = HeartbeatClient(activation, client=client)
            revoked = await heartbeat.ping()
            if revoked:
                logger.warning("Token revoked — degraded mode, sync skipped")
                return

            sync = PluginSyncService(activation, client=client)
            report = await sync.sync()
            logger.info(
                "Plugin sync: %d updated, %d skipped, %d rolled back, %d errors",
                len(report.updated),
                len(report.skipped),
                len(report.rolled_back),
                len(report.errors),
            )
    except Exception as exc:  # noqa: BLE001 — never block startup
        logger.error("Plugin distribution startup failed: %s", exc)
