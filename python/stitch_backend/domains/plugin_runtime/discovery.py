"""Service-plugin discovery — scan plugin sources and start hosts.

Called from the app lifespan (``main.py``) after sidecar registration.
Scans ``plugins-local/`` and ``plugins/`` (cache) for ``kind=service``
manifests.  For each discovered service plugin:

  1. ``register_manifest(plugin_id, manifest)`` — stores metadata for
     ``list_service_plugins``.
  2. Creates a ``ServicePluginHost`` with the manifest's entry module,
     data dir, and migration flag.
  3. ``register_host(host)`` + ``await host.start()``.
  4. Skips unhealthy hosts with a warning log (never crashes startup).

Signature policy mirrors ``PluginLoader``:
  - ``plugins-local/`` — unsigned allowed in dev_mode (``STITCH_DEV_MODE``).
  - ``plugins/`` (cache) — always requires a valid signature.

Zone-2: depends on ``stitch_backend`` (plugin_runtime, sidecar) and
``autoreg.plugin`` (layout, manifest, crypto, loader).
"""

from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING, Any

# Import spi_builtin_oauth so the built-in OAuthProvider SPI is registered
# at startup (before any service-plugin that may call engine.oauth.* starts).
# Import spi_builtin_email so the built-in EmailVerificationProvider is
# registered before the stitch-mail plugin starts.  (There is no built-in
# MailInboxSPI — the plugin is the only provider.)
import stitch_backend.core.spi_builtin_email  # noqa: F401
import stitch_backend.core.spi_builtin_oauth  # noqa: F401
from autoreg.plugin import crypto
from autoreg.plugin.dependency_resolver import resolve_service_dependencies
from autoreg.plugin.layout import (
    _base_dir,
    plugins_cache_dir,
    plugins_local_dir,
    resolve_link,
)
from autoreg.plugin.loader import PluginLoader
from autoreg.plugin.manifest import (
    PluginManifest,
    parse_semver,
    resolve_entry_command,
    semver_sort_key,
    try_read_manifest,
)
from autoreg.scenario.schema import ENGINE_API
from stitch_backend.domains.plugin_runtime import (
    get_host,
    get_manifest,
    register_host,
    register_manifest,
)
from stitch_backend.domains.plugin_runtime.host import (
    HostInitKwargs,
    ServicePluginHost,
)
from stitch_backend.domains.plugin_runtime.host_capabilities import (
    host_driver_eligible,
)
from stitch_backend.domains.plugin_runtime.lkg import (
    maybe_save_crash_report,
    previous_version_dir,
    record_event,
    reset_crashes,
)
from stitch_backend.domains.plugin_runtime.runtime_state import is_plugin_disabled

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)

_DEV_MODE_ENV = "STITCH_DEV_MODE"
_COMMUNITY_SERVICES_ENV = "STITCH_COMMUNITY_SERVICES"
#: Best-effort memory cap (MB) for community-origin service plugins.
_COMMUNITY_MEMORY_LIMIT_MB = 256

#: The service-plugin platform engine version this host implements.  v2
#: service plugins whose ``engine.min`` is strictly newer than this are
#: skipped at discovery time (log warning, never crash startup).  Bump
#: when the service-plugin platform contract changes.
SERVICE_ENGINE_VERSION = "0.3.0"


async def start_service_plugins() -> None:
    """Discover and start all installed service plugins.

    Called from the app lifespan.  Never raises — unhealthy plugins
    are logged and skipped so the server still boots.
    """
    dev_mode = _resolve_dev_mode()
    pubkey = crypto.load_embedded_pubkey()
    loader = PluginLoader(dev_mode=dev_mode, public_key_b64=pubkey)

    discovered = _discover_service_plugins(dev_mode, pubkey)
    if not discovered:
        logger.info("No service plugins discovered")
        return

    started = 0
    for manifest, package_dir, source in discovered:
        try:
            ok = await _start_one(
                manifest, package_dir, source=source, loader=loader,
            )
            if ok:
                started += 1
        except Exception as exc:  # noqa: BLE001 — never crash startup
            logger.warning(
                "Service plugin %s failed to start: %s",
                manifest.id, exc,
            )
    logger.info("Started %d/%d service plugin(s)", started, len(discovered))


def build_child_env(manifest: PluginManifest, source: str = "local") -> dict[str, str]:
    """Child env for a service plugin: storage Fernet key (trusted sources
    only) plus the id-specific bridge env resolved in the core process.

    Shared by discovery and reload so the two spawn paths cannot drift.
    """
    child_env: dict[str, str] = {}
    storage_decl = manifest.contributions.get("storage", {})
    # SECURITY: the core Fernet key must never reach unsigned community/sandbox code.
    if (
        storage_decl
        and source not in ("community", "sandbox")
        and (tok := os.environ.get("TOKEN_ENCRYPTION_KEY", ""))
    ):
        child_env["TOKEN_ENCRYPTION_KEY"] = tok

    # The claude CLI is invisible under the supervisor's stripped PATH — resolve it here.
    if manifest.id == "stitch-freemodel":
        from stitch_backend.domains.ai_proxy.freemodel_sidecar import (
            freemodel_child_env,
        )
        child_env.update(freemodel_child_env())

    # Auth files live under the real user home, invisible to the sandbox-scoped child.
    if manifest.id == "stitch-antigravity":
        from stitch_backend.domains.ai_proxy.antigravity_sidecar import (
            antigravity_child_env,
        )
        child_env.update(antigravity_child_env())

    # The opencode config dir under the real home is invisible to the sandbox-scoped child.
    if manifest.id == "stitch-opencode":
        from stitch_backend.domains.plugin_runtime.opencode_sidecar import (
            opencode_child_env,
        )
        child_env.update(opencode_child_env())

    if manifest.id == "stitch-velly":
        from stitch_backend.domains.plugin_runtime.velly_sidecar import velly_child_env

        child_env.update(velly_child_env())

    return child_env


def _preflight_manifest(
    manifest: PluginManifest, loader: PluginLoader | None
) -> str | None:
    """Return a skip reason when a start guard fails, else None.

    Guards: entry.module or entry.command present, engine.api not newer
    than the host, engine.min not newer than the host service-plugin
    engine, declared dependencies installed.
    """
    entry_module = manifest.entry.get("module")
    entry_command = manifest.entry.get("command")
    has_module = isinstance(entry_module, str) and bool(entry_module)
    has_command = isinstance(entry_command, list) and bool(entry_command)
    if not has_module and not has_command:
        return "entry.module or entry.command missing"

    engine_api = manifest.engine.get("api")
    if isinstance(engine_api, int) and engine_api > ENGINE_API:
        return f"engine.api {engine_api} is newer than host ENGINE_API {ENGINE_API}"

    # semver_sort_key accepts a same-triple prerelease (0.3.0-rc.1) but rejects a higher triple.
    if engine_api is not None and engine_api >= 2:
        engine_min = manifest.engine.get("min", "")
        try:
            if semver_sort_key(engine_min) > semver_sort_key(SERVICE_ENGINE_VERSION):
                return (
                    f"engine.min {engine_min} is newer than host "
                    f"service-plugin engine {SERVICE_ENGINE_VERSION}"
                )
        except ValueError:
            return f"engine.min {engine_min} is not valid semver"

    # Presence check only — range suffixes are stripped; the dep id is checked, not its scenario.
    if manifest.depends:
        dep_loader = loader or PluginLoader()
        missing = resolve_service_dependencies(manifest, dep_loader)
        if missing:
            return f"dependency {', '.join(missing)} not installed"
    return None


async def _resolve_host_driver(manifest: PluginManifest, source: str) -> bool:
    host_driver = host_driver_eligible(manifest.capabilities, source)
    if host_driver:
        from stitch_backend.domains.plugin_distribution.entitlements import (
            get_effective_entitlements,
            is_entitled_to,
        )
        entitlements = await get_effective_entitlements(None, None)
        host_driver = is_entitled_to(manifest.id, entitlements)
    return host_driver


def _make_service_host(
    manifest: PluginManifest,
    package_dir: Path,
    *,
    source: str,
    host_driver: bool,
) -> ServicePluginHost:
    storage_decl = manifest.contributions.get("storage", {})
    memory_limit_mb = (
        _COMMUNITY_MEMORY_LIMIT_MB
        if source == "community" and not host_driver
        else None
    )
    common: HostInitKwargs = {
        "plugin_id": manifest.id,
        "package_dir": package_dir,
        "data_dir": _base_dir() / "data" / "plugins" / manifest.id,
        "migrations": bool(storage_decl.get("migrations")),
        "source": source,
        "host_driver": host_driver,
        "memory_limit_mb": memory_limit_mb,
        "env": build_child_env(manifest, source),
    }
    command = resolve_entry_command(manifest.entry, package_dir)
    if command is not None:
        return ServicePluginHost(command=command, **common)
    return ServicePluginHost(entry_module=manifest.entry["module"], **common)


async def _start_one(
    manifest: PluginManifest,
    package_dir: Path,
    *,
    source: str = "local",
    loader: PluginLoader | None = None,
) -> bool:
    """Register + start a single service plugin host.  Returns True on success."""
    reason = _preflight_manifest(manifest, loader)
    if reason is not None:
        logger.warning("Service plugin %s: %s — skipping", manifest.id, reason)
        return False

    entry_module = manifest.entry.get("module")
    module_dir = (
        package_dir / entry_module
        if isinstance(entry_module, str) and entry_module
        else None
    )

    # Vendor drift check — WARN only, never block startup.  The vendored
    # rpc_server.py may drift when a package is hand-edited or generated
    # from a different canonical source.  The upgrade tool + dev-install
    # refresh exist to fix drift; this is just a visibility nudge.
    # The vendored file lives in the MODULE dir (<pkg>/<module>/_vendor/),
    # not the package root — resolve it the same way the spawner does.
    try:
        from stitch_plugin_tools.vendoring import vendored_matches_canonical
        if module_dir is not None and not vendored_matches_canonical(module_dir):
            logger.warning(
                "Service plugin %s: vendored rpc_server.py drifts from "
                "canonical — run `python -m stitch_plugin_tools vendor "
                "<package>` to refresh",
                manifest.id,
            )
    except ImportError:
        pass  # stitch_plugin_tools not available — skip drift check

    host_driver = await _resolve_host_driver(manifest, source)
    host = _make_service_host(
        manifest, package_dir, source=source, host_driver=host_driver,
    )
    # Crash-loop hook: telemetry report + LKG rollback (todo 23).
    host.crash_hook = _on_crash_loop
    register_manifest(manifest.id, manifest)
    if is_plugin_disabled(manifest.id):
        register_host(host)  # stays listed so the enable command can start it
        logger.info(
            "Service plugin %s disabled by user — registered, not started",
            manifest.id,
        )
        return False
    # one RPC reader owns the reused sidecar's stdout pipe; a second host attach races it
    existing = get_host(manifest.id)
    if existing is not None and existing is not host and existing.rpc.is_alive:
        logger.info(
            "Service plugin %s already running (pid=%s) — reusing host",
            manifest.id, existing.status().get("pid"),
        )
        return True
    ok, result = await _start_host(host, manifest)
    if not ok:
        logger.warning(
            "Service plugin %s unhealthy (status=%s) — skipping",
            manifest.id, result.get("status"),
        )
        return False
    logger.info("Service plugin %s started (pid=%s, source=%s)", manifest.id, result.get("pid"), source)
    return True


async def _start_host(
    host: ServicePluginHost, manifest: PluginManifest
) -> tuple[bool, dict[str, Any]]:
    """Start a prepared host and wire it into the registry + SPI bridge.

    Shared by discovery and reload so the start sequence cannot drift.
    """
    result = await host.start()
    if result.get("status") != "running":
        return False, result
    register_host(host)
    reset_crashes(manifest.id)
    # Register plugin-backed SPI proxies (MailInboxSPI, EmailVerificationProvider,
    # etc.) so spi.resolve() returns the plugin impl when healthy, falling back
    # to built-in when the plugin is dead (health_check = rpc ping).
    try:
        from stitch_backend.domains.plugin_runtime.spi_bridge import (
            register_plugin_spi,
        )
        register_plugin_spi(host, manifest)
    except Exception as exc:  # noqa: BLE001 — never crash startup
        logger.warning(
            "Service plugin %s: SPI registration failed: %s", manifest.id, exc
        )
    return True, result


# ── LKG rollback (todo 23) ────────────────────────────────────────────────


async def _on_crash_loop(host: ServicePluginHost) -> None:
    """Crash hook: save a telemetry report, then attempt LKG rollback.

    Runs as its own task (spawned by the host monitor) after the host
    died following its restart-once — i.e. 2 consecutive crashes.
    """
    plugin_id = host.plugin_id
    manifest = get_manifest(plugin_id)
    version = manifest.version if manifest else "unknown"
    logger.warning(
        "Service plugin %s crash loop (version=%s) — telemetry + LKG rollback",
        plugin_id, version,
    )
    await maybe_save_crash_report(
        plugin_id, version, host.get_logs(), host.get_structured_logs()
    )
    await rollback_service_plugin(plugin_id)


async def rollback_service_plugin(plugin_id: str) -> bool:
    """LKG rollback for a crash-looped service plugin.

    Stops the dead host and starts the newest strictly-older version dir
    from the plugins cache (``install.py`` retains 2 versions precisely
    for this).  When no previous version exists the plugin stays degraded:
    the host remains registered and ``list_service_plugins`` surfaces its
    error status + restart count.  Returns True when the rolled-back host
    is running.
    """
    host = get_host(plugin_id)
    if host is None:
        logger.warning("rollback_service_plugin: unknown plugin %s", plugin_id)
        return False

    manifest = get_manifest(plugin_id)
    current_version = manifest.version if manifest else None
    prev_dir = previous_version_dir(plugin_id, current_version)
    if prev_dir is None:
        logger.warning(
            "Service plugin %s crash-looped with no previous version — degraded",
            plugin_id,
        )
        record_event({
            "action": "degraded",
            "plugin_id": plugin_id,
            "version": current_version or "",
        })
        return False

    prev_manifest = _try_read_manifest(prev_dir)
    prev_entry = prev_manifest.entry if prev_manifest else {}
    entry_module = prev_entry.get("module")
    entry_command = prev_entry.get("command")
    has_module = isinstance(entry_module, str) and bool(entry_module)
    has_command = isinstance(entry_command, list) and bool(entry_command)
    if (
        prev_manifest is None
        or prev_manifest.kind != "service"
        or not (has_module or has_command)
    ):
        logger.warning(
            "Service plugin %s: previous version %s has no usable manifest — degraded",
            plugin_id, prev_dir.name,
        )
        record_event({
            "action": "degraded",
            "plugin_id": plugin_id,
            "version": current_version or "",
            "reason": "bad_previous_manifest",
        })
        return False

    # Stop the dead host and drop its SPI proxies before starting the
    # rolled-back version (built-in SPI fallbacks take over meanwhile).
    try:
        await host.stop()
    except Exception as exc:  # noqa: BLE001 — rollback must proceed
        logger.warning("rollback %s: stop failed: %s", plugin_id, exc)
    try:
        from stitch_backend.domains.plugin_runtime.spi_bridge import (
            unregister_plugin_spi,
        )
        unregister_plugin_spi(host)
    except Exception as exc:  # noqa: BLE001 — best-effort cleanup
        logger.warning("rollback %s: SPI unregister failed: %s", plugin_id, exc)

    storage_decl = prev_manifest.contributions.get("storage", {})
    # Skip rollback to a version whose engine.min is newer than the host's
    # service-plugin engine version (same guard as _start_one).
    prev_engine_api = prev_manifest.engine.get("api")
    if prev_engine_api is not None and prev_engine_api >= 2:
        prev_engine_min = prev_manifest.engine.get("min", "")
        try:
            if semver_sort_key(prev_engine_min) > semver_sort_key(SERVICE_ENGINE_VERSION):
                logger.warning(
                    "Service plugin %s: rollback target engine.min %s is newer "
                    "than host service-plugin engine %s — degraded",
                    plugin_id, prev_engine_min, SERVICE_ENGINE_VERSION,
                )
                record_event({
                    "action": "degraded",
                    "plugin_id": plugin_id,
                    "version": current_version or "",
                    "reason": "engine_too_new_for_rollback",
                })
                return False
        except ValueError:
            pass
    common: HostInitKwargs = {
        "plugin_id": plugin_id,
        "package_dir": prev_dir,
        "data_dir": _base_dir() / "data" / "plugins" / plugin_id,
        "migrations": bool(storage_decl.get("migrations")),
        "source": host.source,
        "host_driver": host.host_driver,
        "memory_limit_mb": host.memory_limit_mb,
    }
    command = resolve_entry_command(prev_manifest.entry, prev_dir)
    if command is not None:
        new_host = ServicePluginHost(command=command, **common)
    else:
        new_host = ServicePluginHost(entry_module=entry_module, **common)
    new_host.crash_hook = _on_crash_loop
    result = await new_host.start()
    if result.get("status") != "running":
        logger.error(
            "Service plugin %s rollback to %s failed to start: %s",
            plugin_id, prev_manifest.version, result.get("error"),
        )
        record_event({
            "action": "rollback_failed",
            "plugin_id": plugin_id,
            "from_version": current_version or "",
            "to_version": prev_manifest.version,
        })
        return False

    register_host(new_host)
    register_manifest(plugin_id, prev_manifest)
    reset_crashes(plugin_id)
    try:
        from stitch_backend.domains.plugin_runtime.spi_bridge import (
            register_plugin_spi,
        )
        register_plugin_spi(new_host, prev_manifest)
    except Exception as exc:  # noqa: BLE001 — never crash on SPI wiring
        logger.warning("rollback %s: SPI registration failed: %s", plugin_id, exc)
    logger.info(
        "Service plugin %s rolled back %s -> %s (LKG)",
        plugin_id, current_version, prev_manifest.version,
    )
    record_event({
        "action": "rollback",
        "plugin_id": plugin_id,
        "from_version": current_version or "",
        "to_version": prev_manifest.version,
    })
    return True


# ── Discovery ─────────────────────────────────────────────────────────────


def _discover_service_plugins(
    dev_mode: bool, pubkey: str | None
) -> list[tuple[PluginManifest, Path, str]]:
    """Scan plugin sources for kind=service manifests.

    Returns ``[(manifest, package_dir, source), ...]`` where source is
    ``"local"``, ``"cache"``, or ``"community"``.  Deduplicates by plugin id
    (plugins-local takes precedence over cache, cache over community).

    Community source is gated by ``STITCH_COMMUNITY_SERVICES`` (additive
    on top of ``STITCH_COMMUNITY_ENABLED``).  When the flag is off,
    community service packages are skipped.
    """
    seen_ids: set[str] = set()
    result: list[tuple[PluginManifest, Path, str]] = []

    # 1. plugins-local (dev source — unsigned allowed in dev_mode)
    local_root = plugins_local_dir()
    if local_root.is_dir():
        for entry in sorted(local_root.iterdir()):
            if not entry.is_dir():
                continue
            # dev-install --link leaves only a .stitch-link pointer file.
            entry = resolve_link(entry)
            manifest = _try_read_manifest(entry)
            if manifest is None or manifest.kind != "service":
                continue
            if manifest.id in seen_ids:
                continue
            if not dev_mode and not _verify_signed(entry, pubkey):
                logger.warning(
                    "plugins-local/%s: invalid signature — skipping", entry.name
                )
                continue
            seen_ids.add(manifest.id)
            result.append((manifest, entry, "local"))

    # 2. plugins cache (signed — always requires valid signature)
    cache_root = plugins_cache_dir()
    if cache_root.is_dir():
        for plugin_id_entry in sorted(cache_root.iterdir()):
            if not plugin_id_entry.is_dir() or plugin_id_entry.name == ".staging":
                continue
            newest = _newest_service_version(
                plugin_id_entry, seen_ids, skip_dotfiles=False
            )
            if newest is None:
                continue
            _ver, path, manifest = newest
            if not _verify_signed(path, pubkey):
                logger.warning(
                    "cache package %s: invalid signature — skipping", path
                )
                continue
            seen_ids.add(manifest.id)
            result.append((manifest, path, "cache"))

    # 3. community (unsigned, gated by STITCH_COMMUNITY_SERVICES)
    if _community_services_enabled():
        community_root = _base_dir() / "community"
        if community_root.is_dir():
            for plugin_id_entry in sorted(community_root.iterdir()):
                if not plugin_id_entry.is_dir():
                    continue
                newest = _newest_service_version(
                    plugin_id_entry, seen_ids, skip_dotfiles=True
                )
                if newest is None:
                    continue
                _ver, path, manifest = newest
                seen_ids.add(manifest.id)
                result.append((manifest, path, "community"))

    return result


def _newest_service_version(
    plugin_id_entry: Path, seen_ids: set[str], *, skip_dotfiles: bool
) -> tuple[tuple[int, int, int], Path, PluginManifest] | None:
    """Newest ``kind=service`` version dir under a plugin-id dir, or None."""
    newest: tuple[tuple[int, int, int], Path, PluginManifest] | None = None
    for version_entry in sorted(plugin_id_entry.iterdir()):
        if not version_entry.is_dir():
            continue
        if skip_dotfiles and version_entry.name.startswith("."):
            continue
        manifest = _try_read_manifest(version_entry)
        if manifest is None or manifest.kind != "service":
            continue
        if manifest.id in seen_ids:
            continue
        try:
            ver_tuple = parse_semver(manifest.version)
        except ValueError:
            continue
        if newest is None or ver_tuple > newest[0]:
            newest = (ver_tuple, version_entry, manifest)
    return newest


def _try_read_manifest(package_dir: Path) -> PluginManifest | None:
    """Read + validate a manifest, returning None on any failure."""
    return try_read_manifest(package_dir)


def _verify_signed(package_dir: Path, pubkey: str | None) -> bool:
    """Verify the package signature.  Returns False if unsigned or invalid."""
    signature = crypto.read_signature(package_dir)
    if not signature:
        return False
    if not pubkey:
        logger.warning(
            "no public key configured; cannot verify %s", package_dir
        )
        return False
    return crypto.verify_package(package_dir, signature, pubkey)


def _resolve_dev_mode() -> bool:
    """Read STITCH_DEV_MODE env var (default False)."""
    raw = os.environ.get(_DEV_MODE_ENV, "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _community_services_enabled() -> bool:
    """Read STITCH_COMMUNITY_SERVICES env var (default False).

    Additive gate on top of STITCH_COMMUNITY_ENABLED: only kind=service
    community packages require this flag.  Mirrors the loader's helper.
    """
    raw = os.environ.get(_COMMUNITY_SERVICES_ENV, "").strip().lower()
    return raw in ("1", "true", "yes", "on")


__all__ = [
    "start_service_plugins",
    "rollback_service_plugin",
    "build_child_env",
    "SERVICE_ENGINE_VERSION",
]
