"""SPI bridge — registers plugin-backed SPI proxies over RPC.

When a service-plugin host starts and its manifest declares ``spi``
contributions (a list of SPI Protocol class names like
``"MailInboxSPI"``, ``"EmailVerificationProvider"``), this module
registers proxy implementations in the core SPI registry with
``source="plugin"``.  Each proxy method calls the plugin's RPC command
via ``host.call(cmd, params)``.  The proxy's ``health_check`` calls
``host.rpc.ping`` — when the plugin is dead, the health probe raises
and ``spi.resolve()`` falls back to the built-in impl automatically.

On host stop / app shutdown, ``unregister_plugin_spi(host)`` removes
the plugin impls so the registry reflects reality.

This module is the ONLY place that maps manifest SPI class names to
core SPI string constants — the manifest declares the public contract
(class names), the bridge maps to internal registry keys.
"""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any

from stitch_backend.core.spi import register_impl, unregister_plugin

if TYPE_CHECKING:
    from autoreg.plugin.manifest import PluginManifest

    from .host import ServicePluginHost

logger = logging.getLogger(__name__)

#: Maps manifest SPI class names (declared in contributions.spi) to
#: core SPI registry string constants.  The manifest uses class names
#: as the public contract; the bridge translates to internal keys.
_SPI_NAME_MAP: dict[str, str] = {
    "MailInboxSPI": "mail_inbox",
    "EmailVerificationProvider": "email_verification",
    "TotpProvider": "totp",
    "OAuthProvider": "oauth",
}

#: TTL for a positive (healthy) health-check cache entry, in seconds.
#: Within this window, repeated ``spi.resolve()`` calls skip the RPC ping.
_HEALTH_TTL_OK: float = 5.0

#: TTL for a negative (unhealthy) health-check cache entry, in seconds.
#: Shorter than the positive TTL so a recovered plugin is re-probed quickly.
_HEALTH_TTL_FAIL: float = 1.0


class _PluginSpiProxy:
    """RPC-backed SPI proxy.

    All SPI interface methods (``list_profiles``, ``wait_otp``, ``sync``,
    ``close``) are forwarded to the plugin's RPC commands.  The
    ``health_check`` method pings the plugin — when the plugin is dead,
    ``_is_healthy`` returns False and ``spi.resolve`` falls back to
    built-in.

    A single proxy instance serves all SPI names the plugin declares
    (e.g. both ``MailInboxSPI`` and ``EmailVerificationProvider``).
    Methods not used by a particular SPI are simply never called.
    """

    def __init__(self, host: "ServicePluginHost") -> None:
        self._host = host
        #: Cached health result: ``(monotonic_timestamp, ok)``.
        #: ``None`` = no cache yet.  TTL is 5s when healthy, 1s when
        #: unhealthy (fast recovery).  The cache is consulted only when
        #: the host is alive; the ``is_alive`` / ``_stopping`` check is
        #: always immediate.
        self._health_cache: tuple[float, bool] | None = None

    def health_check(self) -> None:
        """Raise if the plugin is not reachable (sync, called by _is_healthy).

        Caches the last ping result per-proxy with a short TTL (5s healthy,
        1s unhealthy) so concurrent ``spi.resolve()`` calls under the
        registry lock do not each pay the 2s sync RPC ping.  The
        ``is_alive`` / ``_stopping`` check is always immediate (no ping,
        no cache); the RPC ping only fires when the cache has expired.
        """
        # Immediate unhealthy — host stopping or RPC client detached.
        # Skip ping and cache entirely.
        if self._host._stopping or not self._host.rpc.is_alive:
            raise RuntimeError(f"plugin {self._host.plugin_id} not running")

        now = time.monotonic()
        cache = self._health_cache
        if cache is not None:
            ts, ok = cache
            ttl = _HEALTH_TTL_OK if ok else _HEALTH_TTL_FAIL
            if now - ts < ttl:
                # Cache valid — return cached result without pinging.
                if ok:
                    return
                raise RuntimeError(
                    f"plugin {self._host.plugin_id} not healthy (cached)"
                )

        # Cache expired or absent — live ping.
        try:
            self._host.rpc.ping(2.0)
        except Exception:
            self._health_cache = (now, False)
            raise
        self._health_cache = (now, True)

    async def list_profiles(
        self, owner_id: int | None = None,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {}
        if owner_id is not None:
            params["owner_id"] = owner_id
        return await self._host.call("list_profiles", params)

    async def wait_otp(
        self,
        email: str,
        subject_filter: str = "",
        code_pattern: str | None = None,
        timeout: float = 120.0,
    ) -> str:
        params: dict[str, Any] = {
            "email": email,
            "subject_filter": subject_filter,
            "timeout": timeout,
        }
        if code_pattern is not None:
            params["code_pattern"] = code_pattern
        return await self._host.call("wait_otp", params)

    async def sync(self, profile_id: str) -> dict[str, Any]:
        return await self._host.call("sync", {"profile_id": profile_id})

    async def close(self) -> None:
        pass


def register_plugin_spi(
    host: "ServicePluginHost", manifest: "PluginManifest"
) -> list[str]:
    """Register plugin-backed SPI proxies for each declared SPI name.

    Returns the list of core SPI constants that were registered.
    Unknown SPI class names (not in ``_SPI_NAME_MAP``) are logged and
    skipped — tolerant reader so a newer manifest does not crash an
    older host.
    """
    contributions = manifest.contributions
    spi_names_raw = contributions.get("spi", [])
    if not isinstance(spi_names_raw, list):
        logger.warning(
            "Plugin %s: contributions.spi is not a list — skipping SPI registration",
            manifest.id,
        )
        return []

    proxy = _PluginSpiProxy(host)
    registered: list[str] = []
    for class_name in spi_names_raw:
        if not isinstance(class_name, str):
            continue
        spi_const = _SPI_NAME_MAP.get(class_name)
        if spi_const is None:
            logger.warning(
                "Plugin %s: unknown SPI class name %r — skipping",
                manifest.id, class_name,
            )
            continue
        register_impl(spi_const, proxy, source="plugin")
        registered.append(spi_const)
        logger.info(
            "Plugin %s: registered SPI %s (%s) as plugin-backed",
            manifest.id, class_name, spi_const,
        )
    return registered


def unregister_plugin_spi(host: "ServicePluginHost") -> None:
    """Unregister all plugin-backed SPI impls for *host*.

    Called on host stop / app shutdown.  Iterates all known SPI
    constants and removes the plugin slot — the built-in fallback
    stays.
    """
    for spi_const in _SPI_NAME_MAP.values():
        unregister_plugin(spi_const)
    logger.debug("Plugin %s: unregistered all SPI proxies", host.plugin_id)


def unregister_all_plugin_spi() -> None:
    """Unregister plugin-backed SPI impls for ALL hosts.

    Called from ``plugin_runtime.stop_all()`` during app shutdown so
    the registry is clean for the next startup (tests, CLI re-run).
    """
    for spi_const in _SPI_NAME_MAP.values():
        unregister_plugin(spi_const)


__all__ = [
    "register_plugin_spi",
    "unregister_plugin_spi",
    "unregister_all_plugin_spi",
]
