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
    validate_manifest,
)

from stitch_backend.domains.plugin_runtime import (
    register_host,
    register_manifest,
)
from stitch_backend.domains.plugin_runtime.host import ServicePluginHost

logger = logging.getLogger(__name__)

_DEV_MODE_ENV = "STITCH_DEV_MODE"


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
    for manifest, package_dir in discovered:
        try:
            ok = await _start_one(manifest, package_dir)
            if ok:
                started += 1
        except Exception as exc:  # noqa: BLE001 — never crash startup
            logger.warning(
                "Service plugin %s failed to start: %s",
                manifest.id, exc,
            )
    logger.info("Started %d/%d service plugin(s)", started, len(discovered))


async def _start_one(
    manifest: PluginManifest, package_dir: Path
) -> bool:
    """Register + start a single service plugin host.  Returns True on success."""
    entry_module = manifest.entry.get("module")
    if not entry_module or not isinstance(entry_module, str):
        logger.warning(
            "Service plugin %s: entry.module missing — skipping",
            manifest.id,
        )
        return False

    contributions = manifest.contributions
    storage_decl = contributions.get("storage", {})
    migrations = bool(storage_decl.get("migrations"))

    host = ServicePluginHost(
        plugin_id=manifest.id,
        entry_module=entry_module,
        package_dir=package_dir,
        data_dir=_base_dir() / "data" / "plugins" / manifest.id,
        migrations=migrations,
    )
    register_manifest(manifest.id, manifest)
    result = await host.start()
    if result.get("status") != "running":
        logger.warning(
            "Service plugin %s unhealthy (status=%s) — skipping",
            manifest.id, result.get("status"),
        )
        return False
    register_host(host)
    logger.info("Service plugin %s started (pid=%s)", manifest.id, result.get("pid"))
    return True


# ── Discovery ─────────────────────────────────────────────────────────────


def _discover_service_plugins(
    dev_mode: bool, pubkey: str | None
) -> list[tuple[PluginManifest, Path]]:
    """Scan plugin sources for kind=service manifests.

    Returns ``[(manifest, package_dir), ...]``.  Deduplicates by plugin id
    (plugins-local takes precedence over cache).
    """
    seen_ids: set[str] = set()
    result: list[tuple[PluginManifest, Path]] = []

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
            result.append((manifest, entry))

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
                from autoreg.plugin.manifest import parse_semver
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
            result.append((manifest, path))

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


__all__ = ["start_service_plugins"]
