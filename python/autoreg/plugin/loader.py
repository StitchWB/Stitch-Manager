"""PluginLoader — dual-format resolver (plan §3.3 decision 9, §4.5).

Resolution precedence for ``resolve(service_id)``:
    1. ``plugins-local/{id}/``  — dev source (unsigned allowed in dev_mode)
    2. ``plugins/{id}/{ver}/``  — server cache, newest version wins
    3. ``None``                 — caller falls back to built-in provider modules

Pinning contract: resolution happens ONCE per loader instance.  Callers
create a fresh ``PluginLoader`` at the start of each run so a package
installed/removed mid-run does not change the resolved version — the next
run picks up the change.  This is the load-bearing pinning guarantee from
plan §3.2 item 5 (``runner pins version on entry to run()``).

Signature policy:
    * ``dev_mode=True``  — plugins-local packages may be unsigned (rapid
      iteration); cache packages STILL require a valid signature.
    * ``dev_mode=False`` — ALL packages (local + cache) require a valid
      signature.  ``dev_mode`` is compiled out of release builds later;
      for now it is an explicit flag, default OFF.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from autoreg.scenario.schema import ENGINE_API

from . import crypto
from .layout import plugins_cache_dir, plugins_local_dir
from .manifest import (
    ManifestValidationError,
    PluginManifest,
    parse_semver,
    validate_manifest,
)

logger = logging.getLogger(__name__)

_DEV_MODE_ENV = "STITCH_DEV_MODE"


class PluginLoader:
    """Resolve a service id to an installed plugin package directory.

    Construct one loader per run (see pinning contract above).
    """

    def __init__(
        self,
        *,
        dev_mode: bool | None = None,
        public_key_b64: str | None = None,
    ) -> None:
        self._dev_mode = _resolve_dev_mode(dev_mode)
        self._public_key_b64 = public_key_b64 or crypto.load_embedded_pubkey()
        self._resolved: dict[str, Path | None] = {}

    @property
    def dev_mode(self) -> bool:
        return self._dev_mode

    def resolve(self, service_id: str) -> Path | None:
        """Return the package dir for ``service_id``, or ``None``.

        The first successful resolution for a given ``service_id`` is
        cached for the lifetime of this loader instance (pinning).
        """
        if service_id in self._resolved:
            return self._resolved[service_id]

        result = (
            self._resolve_from_local(service_id)
            or self._resolve_from_cache(service_id)
        )
        self._resolved[service_id] = result
        return result

    # ── plugins-local ──────────────────────────────────────────────────────

    def _resolve_from_local(self, service_id: str) -> Path | None:
        local_root = plugins_local_dir()
        if not local_root.is_dir():
            return None
        for entry in sorted(local_root.iterdir()):
            if not entry.is_dir():
                continue
            manifest = _try_read_manifest(entry)
            if manifest is None or manifest.service != service_id:
                continue
            api = manifest.engine.get("api")
            if isinstance(api, int) and api > ENGINE_API:
                logger.warning(
                    "skipping plugins-local/%s: manifest engine.api=%d > ENGINE_API=%d",
                    entry.name,
                    api,
                    ENGINE_API,
                )
                continue
            if self._dev_mode:
                logger.debug(
                    "dev_mode: resolving %s from plugins-local/%s (unsigned ok)",
                    service_id,
                    entry.name,
                )
                return entry
            if self._verify_signed(entry, manifest):
                return entry
            logger.warning(
                "plugins-local/%s has invalid signature; skipping", entry.name
            )
        return None

    # ── cache ──────────────────────────────────────────────────────────────

    def _resolve_from_cache(self, service_id: str) -> Path | None:
        cache_root = plugins_cache_dir()
        if not cache_root.is_dir():
            return None
        candidates: list[tuple[tuple[int, int, int], str, str, Path]] = []
        for plugin_id_entry in sorted(cache_root.iterdir()):
            if not plugin_id_entry.is_dir() or plugin_id_entry.name == ".staging":
                continue
            for version_entry in sorted(plugin_id_entry.iterdir()):
                if not version_entry.is_dir():
                    continue
                manifest = _try_read_manifest(version_entry)
                if manifest is None or manifest.service != service_id:
                    continue
                api = manifest.engine.get("api")
                if isinstance(api, int) and api > ENGINE_API:
                    logger.warning(
                        "skipping cache package %s: manifest engine.api=%d > ENGINE_API=%d",
                        version_entry,
                        api,
                        ENGINE_API,
                    )
                    continue
                try:
                    ver_tuple = parse_semver(manifest.version)
                except ValueError:
                    continue
                candidates.append(
                    (ver_tuple, plugin_id_entry.name, manifest.version, version_entry)
                )
        if not candidates:
            return None
        # Newest version wins; ties broken by plugin id for determinism.
        candidates.sort(key=lambda c: (c[0], c[1]))
        _, _plugin_id, _version, newest_dir = candidates[-1]
        manifest = _try_read_manifest(newest_dir)
        if manifest is None:
            return None
        # Cache packages ALWAYS require a valid signature, even in dev_mode.
        if self._verify_signed(newest_dir, manifest):
            return newest_dir
        logger.warning(
            "cache package %s has invalid signature; skipping", newest_dir
        )
        return None

    # ── signature verification ─────────────────────────────────────────────

    def _verify_signed(self, package_dir: Path, manifest: PluginManifest) -> bool:
        if not manifest.signature:
            return False
        if not self._public_key_b64:
            logger.warning(
                "no public key configured; cannot verify %s", package_dir
            )
            return False
        return crypto.verify_package(
            package_dir, manifest.signature, self._public_key_b64
        )


def _resolve_dev_mode(flag: bool | None) -> bool:
    if flag is not None:
        return flag
    raw = os.environ.get(_DEV_MODE_ENV, "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _try_read_manifest(package_dir: Path) -> PluginManifest | None:
    """Read + validate a manifest, returning ``None`` on any failure.

    Used during scanning — a corrupt manifest in one package must not
    prevent the loader from finding the next candidate.
    """
    manifest_path = package_dir / "plugin.json"
    if not manifest_path.is_file():
        return None
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        return validate_manifest(raw)
    except (OSError, ValueError, ManifestValidationError):
        return None
