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

import json
import logging
import os
from pathlib import Path
from typing import Any

from autoreg.plugin import crypto
from autoreg.plugin.layout import _base_dir, plugins_cache_dir, plugins_local_dir
from autoreg.plugin.manifest import (
    ManifestValidationError,
    PluginManifest,
    parse_semver,
    validate_manifest,
)

# Import spi_builtin_oauth so the built-in OAuthProvider SPI is registered
# at startup (before any service-plugin that may call engine.oauth.* starts).
# Import spi_builtin_email so the built-in MailInboxSPI and
# EmailVerificationProvider are registered before the stitch-mail plugin
# starts — the plugin overrides them, and when it dies the SPI registry
# must fall back to the built-in impls.
import stitch_backend.core.spi_builtin_email  # noqa: F401
import stitch_backend.core.spi_builtin_oauth  # noqa: F401
from stitch_backend.domains.plugin_runtime import (
    get_host,
    get_manifest,
    register_host,
    register_manifest,
)
from stitch_backend.domains.plugin_runtime.host import ServicePluginHost
from stitch_backend.domains.plugin_runtime.lkg import (
    maybe_save_crash_report,
    previous_version_dir,
    record_event,
    reset_crashes,
)

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

    discovered = _discover_service_plugins(dev_mode, pubkey)
    if not discovered:
        logger.info("No service plugins discovered")
        return

    started = 0
    for manifest, package_dir, source in discovered:
        try:
            memory_mb = _COMMUNITY_MEMORY_LIMIT_MB if source == "community" else None
            ok = await _start_one(
                manifest, package_dir, source=source, memory_limit_mb=memory_mb
            )
            if ok:
                started += 1
        except Exception as exc:  # noqa: BLE001 — never crash startup
            logger.warning(
                "Service plugin %s failed to start: %s",
                manifest.id, exc,
            )
    logger.info("Started %d/%d service plugin(s)", started, len(discovered))


async def _start_one(
    manifest: PluginManifest,
    package_dir: Path,
    *,
    source: str = "local",
    memory_limit_mb: int | None = None,
) -> bool:
    """Register + start a single service plugin host.  Returns True on success."""
    entry_module = manifest.entry.get("module")
    if not entry_module or not isinstance(entry_module, str):
        logger.warning(
            "Service plugin %s: entry.module missing — skipping",
            manifest.id,
        )
        return False

    # Skip v2 plugins whose engine.min is newer than the host's
    # service-plugin engine version.  Never crash startup — just log.
    engine_api = manifest.engine.get("api")
    if engine_api is not None and engine_api >= 2:
        engine_min = manifest.engine.get("min", "")
        try:
            if parse_semver(engine_min) > parse_semver(SERVICE_ENGINE_VERSION):
                logger.warning(
                    "Service plugin %s: engine.min %s is newer than host "
                    "service-plugin engine %s — skipping",
                    manifest.id, engine_min, SERVICE_ENGINE_VERSION,
                )
                return False
        except ValueError:
            logger.warning(
                "Service plugin %s: engine.min %s is not valid semver — skipping",
                manifest.id, engine_min,
            )
            return False

    contributions = manifest.contributions
    storage_decl = contributions.get("storage", {})
    migrations = bool(storage_decl.get("migrations"))

    # Plugins with their own storage need TOKEN_ENCRYPTION_KEY to encrypt
    # secrets at rest with the same Fernet key as the core (tokens stay
    # interchangeable across the migration boundary).  Passed via plan.env,
    # NOT the supervisor allowlist — it is a secret that only
    # storage-declaring plugins should see.
    #
    # SECURITY: only TRUSTED sources (local dev / signed cache) receive the
    # core Fernet key.  Community / sandbox plugins are unsigned arbitrary
    # code — handing them the core key would let them decrypt every secret
    # in the core DB.  They fall back to their own key: plugin crypto
    # (e.g. stitch-totp's crypto.py) resolves env var → core key file →
    # plugin-local ``<data_dir>/.db_key`` when the env var is absent.
    child_env: dict[str, str] = {}
    if (
        storage_decl
        and source not in ("community", "sandbox")
        and (tok := os.environ.get("TOKEN_ENCRYPTION_KEY", ""))
    ):
        child_env["TOKEN_ENCRYPTION_KEY"] = tok

    host = ServicePluginHost(
        plugin_id=manifest.id,
        entry_module=entry_module,
        package_dir=package_dir,
        data_dir=_base_dir() / "data" / "plugins" / manifest.id,
        migrations=migrations,
        source=source,
        memory_limit_mb=memory_limit_mb,
        env=child_env,
    )
    # Crash-loop hook: telemetry report + LKG rollback (todo 23).
    host.crash_hook = _on_crash_loop
    register_manifest(manifest.id, manifest)
    result = await host.start()
    if result.get("status") != "running":
        logger.warning(
            "Service plugin %s unhealthy (status=%s) — skipping",
            manifest.id, result.get("status"),
        )
        return False
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
    logger.info("Service plugin %s started (pid=%s, source=%s)", manifest.id, result.get("pid"), source)
    return True


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
    await maybe_save_crash_report(plugin_id, version, host.get_logs())
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
    entry_module = prev_manifest.entry.get("module") if prev_manifest else None
    if (
        prev_manifest is None
        or prev_manifest.kind != "service"
        or not isinstance(entry_module, str)
        or not entry_module
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
            if parse_semver(prev_engine_min) > parse_semver(SERVICE_ENGINE_VERSION):
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
    new_host = ServicePluginHost(
        plugin_id=plugin_id,
        entry_module=entry_module,
        package_dir=prev_dir,
        data_dir=_base_dir() / "data" / "plugins" / plugin_id,
        migrations=bool(storage_decl.get("migrations")),
        source=host.source,
        memory_limit_mb=host.memory_limit_mb,
    )
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
            manifest = _try_read_manifest(entry)
            if manifest is None or manifest.kind != "service":
                continue
            if manifest.id in seen_ids:
                continue
            if not dev_mode and not _verify_signed(entry, manifest, pubkey):
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
            # Pick newest version for this plugin id.
            newest: tuple[tuple[int, int, int], Path, PluginManifest] | None = None
            for version_entry in sorted(plugin_id_entry.iterdir()):
                if not version_entry.is_dir():
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
            if newest is None:
                continue
            _ver, path, manifest = newest
            if not _verify_signed(path, manifest, pubkey):
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
                # Pick newest version for this plugin id.
                newest_comm: tuple[tuple[int, int, int], Path, PluginManifest] | None = None
                for version_entry in sorted(plugin_id_entry.iterdir()):
                    if not version_entry.is_dir() or version_entry.name.startswith("."):
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
                    if newest_comm is None or ver_tuple > newest_comm[0]:
                        newest_comm = (ver_tuple, version_entry, manifest)
                if newest_comm is None:
                    continue
                _ver, path, manifest = newest_comm
                seen_ids.add(manifest.id)
                result.append((manifest, path, "community"))

    return result


def _try_read_manifest(package_dir: Path) -> PluginManifest | None:
    """Read + validate a manifest, returning None on any failure."""
    manifest_path = package_dir / "plugin.json"
    if not manifest_path.is_file():
        return None
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        return validate_manifest(raw)
    except (OSError, ValueError, ManifestValidationError):
        return None


def _verify_signed(
    package_dir: Path, manifest: PluginManifest, pubkey: str | None
) -> bool:
    """Verify the package signature.  Returns False if unsigned or invalid."""
    if not manifest.signature:
        return False
    if not pubkey:
        logger.warning(
            "no public key configured; cannot verify %s", package_dir
        )
        return False
    return crypto.verify_package(package_dir, manifest.signature, pubkey)


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


__all__ = ["start_service_plugins", "rollback_service_plugin", "SERVICE_ENGINE_VERSION"]
