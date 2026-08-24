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
ONLY that host's plugin impls so the registry reflects reality.

This module is the ONLY place that maps manifest SPI class names to
core SPI string constants — the manifest declares the public contract
(class names), the bridge maps to internal registry keys.

Method forwarding is driven by :data:`SPI_METHOD_MAP` — an explicit,
auditable map of SPI constant → method → (plugin command, params).
No method is forwarded unless it appears in the map.  This is critical
because protocol method names do not always match plugin command names
(e.g. ``TotpProvider.get_code`` → plugin command ``generate_code``).
"""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any

from autoreg.plugin.rpc import RpcCallError, RpcTimeoutError
from stitch_backend.core.spi import (
    register_impl,
    spi_registry,
    unregister_plugin,
)

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


# ── SPI method map ────────────────────────────────────────────────────────────
#
# Keyed by core SPI constant.  Each entry maps protocol method name →
# method spec.  The spec has:
#   "cmd": plugin RPC command name (str), or None for a local no-op.
#   "params": list of (param_name, default_expr) tuples.
#       default_expr is None for required params (no default).
#       Otherwise it's a string expression evaluated as the default.
#   "returns": declared return-shape expectation — one of "list", "int",
#       "str", "dict", "any".  ``_forward`` validates the RPC result
#       against it; a mismatch is treated like a failed call (per-call
#       built-in fallback).  Core consumers assume the protocol shapes
#       (list_keys → list, count_owned_keys → int, list_profiles → list),
#       so a malformed plugin result must never reach them.  "any" skips
#       validation (e.g. verify_code → bool, not in the light spec).
#
# The factory :func:`_generate_method` builds async wrappers from these
# specs with exact signatures (no **kwargs) so callers that inspect
# signatures (imap_otp_capability) see the protocol's real shape.
#
# Methods that appear under multiple SPIs (e.g. ``wait_otp`` under both
# ``mail_inbox`` and ``email_verification``) must have identical params —
# the factory verifies this.  The command name is looked up at call time
# via ``self._spi_const`` so the same generated method serves any SPI.

SPI_METHOD_MAP: dict[str, dict[str, dict[str, Any]]] = {
    "mail_inbox": {
        "list_profiles": {
            "cmd": "list_profiles",
            "params": [("owner_id", "None")],
            "returns": "list",
        },
        "wait_otp": {
            "cmd": "wait_otp",
            "params": [
                ("email", None),
                ("subject_filter", '""'),
                ("code_pattern", "None"),
                ("timeout", "120.0"),
            ],
            "returns": "str",
        },
        "sync": {
            "cmd": "sync",
            "params": [("profile_id", None)],
            "returns": "dict",
        },
    },
    "email_verification": {
        "wait_otp": {
            "cmd": "wait_otp",
            "params": [
                ("email", None),
                ("subject_filter", '""'),
                ("code_pattern", "None"),
                ("timeout", "120.0"),
            ],
            "returns": "str",
        },
        # close is a local no-op — the plugin has no persistent IMAP
        # connection to release (built-in EmailService is per-call).
        "close": {
            "cmd": None,
            "params": [],
        },
    },
    "totp": {
        "generate_secret": {
            "cmd": "generate_secret",
            "params": [],
            "returns": "str",
        },
        # NOTE the name mismatch: protocol method get_code → plugin
        # command generate_code.  This is exactly why the method map
        # must be explicit — blind forwarding would call "get_code"
        # which the plugin doesn't implement.
        "get_code": {
            "cmd": "generate_code",
            "params": [("secret", None), ("timestamp", "None")],
            "returns": "str",
        },
        "verify_code": {
            "cmd": "verify_code",
            "params": [("secret", None), ("code", None)],
            # Protocol returns bool — not in the light shape spec, so
            # pass through unvalidated.
            "returns": "any",
        },
        "count_owned_keys": {
            "cmd": "count_owned_keys",
            "params": [("owner_id", "None")],
            "returns": "int",
        },
        "list_keys": {
            "cmd": "list_keys",
            "params": [],
            "returns": "list",
        },
    },
    "oauth": {
        "start_pkce_flow": {
            "cmd": "start_pkce_flow",
            "params": [
                ("authorize_url", None),
                ("token_url", None),
                ("client_id", None),
                ("redirect_uri", '"http://localhost:25584/api/oauth/callback"'),
                ("scope", '"openid profile email"'),
                ("state", "None"),
            ],
            "returns": "dict",
        },
        "start_device_flow": {
            "cmd": "start_device_flow",
            "params": [
                ("device_auth_url", None),
                ("token_url", None),
                ("client_id", None),
                ("scope", '""'),
            ],
            "returns": "dict",
        },
        "exchange_code": {
            "cmd": "exchange_code",
            "params": [
                ("code", None),
                ("code_verifier", None),
                ("token_url", None),
                ("client_id", None),
                ("redirect_uri", '"http://localhost:25584/api/oauth/callback"'),
                ("proxy", "None"),
            ],
            "returns": "dict",
        },
    },
}


#: Return-shape predicates for the ``"returns"`` spec key (see
#: :data:`SPI_METHOD_MAP`).  ``int`` rejects ``bool`` (a bool is an int
#: subclass but never a valid count).
_RETURN_SHAPE_CHECKS: dict[str, Any] = {
    "list": lambda v: isinstance(v, list),
    "int": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "str": lambda v: isinstance(v, str),
    "dict": lambda v: isinstance(v, dict),
    "any": lambda v: True,
}


# ── Method factory ───────────────────────────────────────────────────────────


def _generate_method(method_name: str, spec: dict[str, Any]) -> Any:
    """Build an async wrapper method from a method spec.

    The wrapper has the exact signature of the protocol method (no
    ``**kwargs``) so ``inspect.signature`` returns the real shape.
    It builds a params dict from named args (omitting None values)
    and delegates to ``self._forward(method_name, params)``.
    """
    cmd = spec["cmd"]
    params = spec["params"]

    if cmd is None:
        # Local no-op (e.g. close).
        src = f"async def {method_name}(self):\n    pass\n"
        namespace: dict[str, Any] = {}
        exec(src, namespace)
        return namespace[method_name]

    # Build signature: "email, subject_filter=''", code_pattern=None, ..."
    sig_parts: list[str] = []
    for name, default in params:
        if default is None:
            sig_parts.append(name)  # required
        else:
            sig_parts.append(f"{name}={default}")
    sig_str = ", ".join(sig_parts)

    # Build params dict construction (omit None values).
    lines = [f"async def {method_name}(self, {sig_str}):"]
    lines.append("    _params = {}")
    for name, _ in params:
        lines.append(f"    if {name} is not None:")
        lines.append(f"        _params[{name!r}] = {name}")
    lines.append(f"    return await self._forward({method_name!r}, _params)")
    src = "\n".join(lines)

    namespace = {}
    exec(src, namespace)
    return namespace[method_name]


def _install_methods(cls: type) -> type:
    """Generate and attach all SPI methods to the proxy class.

    Iterates :data:`SPI_METHOD_MAP`, generating one async wrapper per
    unique method name.  Methods shared across SPIs (e.g. ``wait_otp``)
    must have identical params — verified here.  The command name is
    resolved at call time via ``self._spi_const`` so the same method
    serves any SPI that declares it.
    """
    seen: dict[str, list] = {}
    for _spi_const, methods in SPI_METHOD_MAP.items():
        for method_name, spec in methods.items():
            if method_name in seen:
                prev_params = seen[method_name]
                if prev_params != spec["params"]:
                    raise ValueError(
                        f"Method {method_name!r} has different params under "
                        f"different SPIs: {prev_params} vs {spec['params']}"
                    )
                continue
            seen[method_name] = spec["params"]
            method = _generate_method(method_name, spec)
            setattr(cls, method_name, method)
    return cls


# ── Proxy ────────────────────────────────────────────────────────────────────


class _PluginSpiProxy:
    """RPC-backed SPI proxy.

    All SPI interface methods are generated from
    :data:`SPI_METHOD_MAP` and forwarded to the plugin's RPC commands.
    The ``health_check`` method pings the plugin — when the plugin is
    dead, ``_is_healthy`` returns False and ``spi.resolve`` falls back
    to built-in.

    A single proxy instance serves ONE SPI constant (``self._spi_const``).
    ``register_plugin_spi`` creates one proxy per declared SPI so the
    per-call fallback knows which built-in to resolve.
    """

    def __init__(self, host: ServicePluginHost, spi_const: str | None = None) -> None:
        self._host = host
        self._spi_const = spi_const
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

    async def _forward(self, method_name: str, params: dict[str, Any]) -> Any:
        """Forward a method call to the plugin RPC with built-in fallback.

        Looks up the plugin command name from
        :data:`SPI_METHOD_MAP[self._spi_const][method_name]`.  If the
        RPC call fails with ``RpcCallError`` / ``RpcTimeoutError`` /
        ``PluginCallTimeout`` / ``PluginNotRunning`` — or returns a value
        whose shape does not match the spec's ``"returns"`` expectation —
        falls back to the built-in impl for that SPI (via the registry's
        public ``get_builtin`` accessor).  If no built-in is registered,
        re-raises the original exception.
        """
        # Lazy import to avoid loading host.py at module import time
        # (host.py pulls in sidecar + spi_builtin_oauth).
        from .host import PluginCallTimeout, PluginNotRunning

        spi_const = self._spi_const
        if spi_const is None:
            raise RuntimeError(
                f"proxy for {self._host.plugin_id} has no spi_const — "
                "forwarded methods require a spi_const"
            )
        spec = SPI_METHOD_MAP[spi_const][method_name]
        cmd = spec["cmd"]
        try:
            result = await self._host.call(cmd, params)
            # Return-shape validation: core consumers assume protocol
            # shapes, so a malformed plugin result is treated like a
            # failed call (raises into the fallback below).
            expected = spec.get("returns", "any")
            if not _RETURN_SHAPE_CHECKS[expected](result):
                logger.warning(
                    "Plugin %s: SPI %s method %s returned %s, expected "
                    "%r — treating as failed call",
                    self._host.plugin_id, spi_const, method_name,
                    type(result).__name__, expected,
                )
                raise RpcCallError(
                    -32603,
                    f"SPI {spi_const} method {method_name} returned "
                    f"{type(result).__name__}, expected {expected}",
                )
            return result
        except (
            RpcCallError,
            RpcTimeoutError,
            PluginCallTimeout,
            PluginNotRunning,
        ) as exc:
            # Per-call defensive fallback: resolve the built-in impl for
            # this SPI and call the same method.
            builtin = spi_registry.get_builtin(spi_const)
            if builtin is None:
                raise
            logger.warning(
                "Plugin %s: SPI %s method %s failed (%s) — "
                "falling back to built-in",
                self._host.plugin_id, spi_const, method_name, exc,
            )
            builtin_method = getattr(builtin, method_name)
            # The params dict omits None values (plugin RPC contract), but
            # the built-in method takes the protocol's full signature —
            # rebuild it from the spec so required args (e.g. owner_id)
            # are passed as None rather than dropped.
            builtin_kwargs = {
                name: params.get(name) for name, _ in spec["params"]
            }
            return await builtin_method(**builtin_kwargs)


# Generate and attach all SPI methods to the proxy class.  _install_methods
# mutates the class in place (setattr) and returns it, so no reassignment.
_install_methods(_PluginSpiProxy)


# ── Per-host registration tracking ────────────────────────────────────────────
#
# Keyed by host.plugin_id (hosts are unique per plugin_id).  Stores the
# list of SPI constants registered for that host so unregister_plugin_spi
# removes ONLY that host's registrations — not every plugin's.

_registered_spis: dict[str, list[str]] = {}


def register_plugin_spi(
    host: ServicePluginHost, manifest: PluginManifest
) -> list[str]:
    """Register plugin-backed SPI proxies for each declared SPI name.

    Returns the list of core SPI constants that were registered.
    Unknown SPI class names (not in ``_SPI_NAME_MAP``) are logged and
    skipped — tolerant reader so a newer manifest does not crash an
    older host.

    Creates one proxy per SPI constant (each proxy knows its spi_const
    for per-call fallback).  Tracks registered constants per plugin_id
    so :func:`unregister_plugin_spi` can remove only this host's.
    """
    # Defensive: clean up old registrations for this plugin in case of
    # re-registration without explicit unregister (LKG rollback calls
    # unregister first, but this guards against leaks).
    old_consts = _registered_spis.pop(host.plugin_id, [])
    for old_const in old_consts:
        unregister_plugin(old_const)

    contributions = manifest.contributions
    spi_names_raw = contributions.get("spi", [])
    if not isinstance(spi_names_raw, list):
        logger.warning(
            "Plugin %s: contributions.spi is not a list — skipping SPI registration",
            manifest.id,
        )
        return []

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
        proxy = _PluginSpiProxy(host, spi_const=spi_const)
        register_impl(spi_const, proxy, source="plugin")
        registered.append(spi_const)
        logger.info(
            "Plugin %s: registered SPI %s (%s) as plugin-backed",
            manifest.id, class_name, spi_const,
        )
    _registered_spis[host.plugin_id] = registered
    return registered


def unregister_plugin_spi(host: ServicePluginHost) -> None:
    """Unregister all plugin-backed SPI impls for *host*.

    Removes ONLY the SPI constants that were registered for this host
    (tracked in ``_registered_spis``).  Other hosts' registrations are
    untouched.  The built-in fallback stays.
    """
    spi_consts = _registered_spis.pop(host.plugin_id, [])
    for spi_const in spi_consts:
        unregister_plugin(spi_const)
    logger.debug(
        "Plugin %s: unregistered %d SPI proxies", host.plugin_id, len(spi_consts)
    )


def unregister_all_plugin_spi() -> None:
    """Unregister plugin-backed SPI impls for ALL hosts.

    Called from ``plugin_runtime.stop_all()`` during app shutdown so
    the registry is clean for the next startup (tests, CLI re-run).
    """
    _registered_spis.clear()
    for spi_const in _SPI_NAME_MAP.values():
        unregister_plugin(spi_const)


__all__ = [
    "register_plugin_spi",
    "unregister_plugin_spi",
    "unregister_all_plugin_spi",
]
