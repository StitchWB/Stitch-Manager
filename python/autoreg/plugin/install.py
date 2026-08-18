"""Atomic plugin installer (plan §3.2 items 5–6).

Flow:
    1. read + validate manifest from source dir
    2. enforce version monotonicity (reject <= highest installed)
    3. copy source into ``.staging/{id}-{ver}.tmp.{pid}/``
    4. verify signature against canonical content hash
    5. atomic-rename staging into ``plugins/{id}/{version}/``
    6. prune to the 2 newest versions (last-known-good retention)

On ANY verification failure the staging dir is removed and the target
is never created — the cache is left untouched.
"""

from __future__ import annotations

import os
import shutil
import uuid
from pathlib import Path

from . import crypto
from .layout import plugin_cache_path, plugins_cache_dir, staging_dir
from .manifest import (
    ManifestValidationError,
    PluginManifest,
    parse_semver,
    validate_manifest,
)

# Number of newest versions to retain per plugin (last-known-good).
_KEEP_VERSIONS = 2


class InstallError(Exception):
    """Raised when an installation is refused.

    ``reason`` is a short machine-readable code; the message is human-readable.
    """

    def __init__(self, reason: str, message: str) -> None:
        self.reason = reason
        super().__init__(message)


# ── Installed-version inspection ───────────────────────────────────────────


def list_installed_versions(plugin_id: str) -> list[str]:
    """Return installed versions for ``plugin_id`` in the cache, sorted ascending."""
    plugin_root = plugins_cache_dir() / plugin_id
    if not plugin_root.is_dir():
        return []
    versions: list[str] = []
    for entry in plugin_root.iterdir():
        if entry.is_dir() and entry.name != ".staging":
            versions.append(entry.name)
    # Sort by semver tuple; invalid versions sort last (defensive).
    versions.sort(key=lambda v: parse_semver(v) if _is_valid_semver(v) else (0, 0, 0))
    return versions


def _is_valid_semver(version: str) -> bool:
    try:
        parse_semver(version)
        return True
    except ValueError:
        return False


def _highest_installed_version(plugin_id: str) -> str | None:
    versions = list_installed_versions(plugin_id)
    return versions[-1] if versions else None


# ── Atomic directory replacement ────────────────────────────────────────────


def _atomic_replace_dir(src: Path, dst: Path) -> None:
    """Atomically replace ``dst`` with ``src``.

    On POSIX ``os.replace`` is atomic for both files and directories.  On
    Windows it fails when ``dst`` is an existing non-empty directory, so we
    first move the old target out of the way (into the staging dir) and
    clean it up after the swap.  The window in which ``dst`` does not exist
    is bounded and only visible to callers that race on the same path —
    the next reader sees either the old or the new version, never a hybrid.
    """
    staging = staging_dir()
    staging.mkdir(parents=True, exist_ok=True)
    # Ensure the parent of dst exists (os.replace does not create parents).
    dst.parent.mkdir(parents=True, exist_ok=True)

    if dst.exists():
        # Move the old target into staging under a unique name, then swap.
        # uuid suffix avoids collision across concurrent installs in one process.
        old = staging / f"{dst.name}.old.{os.getpid()}.{uuid.uuid4().hex}"
        if old.exists():
            shutil.rmtree(old, ignore_errors=True)
        os.rename(dst, old)
        try:
            os.replace(src, dst)
        except OSError:
            # Restore the old target on failure.
            os.rename(old, dst)
            raise
        # Best-effort cleanup; a failure here must not report a failed install
        # when the swap already succeeded.
        shutil.rmtree(old, ignore_errors=True)
    else:
        os.replace(src, dst)


# ── Install ────────────────────────────────────────────────────────────────


def install_package(
    source_dir: Path,
    *,
    public_key_b64: str,
) -> Path:
    """Install a signed package into the cache atomically.

    Args:
        source_dir: directory containing ``plugin.json`` + package files.
        public_key_b64: base64 ed25519 public key to verify the signature.

    Returns the installed target path.

    Raises ``InstallError`` on any failure (monotonicity, signature, IO).
    The staging dir is cleaned up and the target is never created.
    """
    if not source_dir.is_dir():
        raise InstallError("no_source", f"source dir not found: {source_dir}")

    manifest = _read_manifest(source_dir)

    _enforce_monotonicity(manifest.id, manifest.version)

    target = plugin_cache_path(manifest.id, manifest.version)
    staging = _make_staging_dir(manifest.id, manifest.version)

    try:
        _copy_tree(source_dir, staging)
        _verify_signature(staging, manifest, public_key_b64)
        _atomic_replace_dir(staging, target)
    except Exception:
        # Clean up staging on any failure — target must never be created.
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
        raise

    _prune_old_versions(manifest.id)
    return target


def _read_manifest(source_dir: Path) -> PluginManifest:
    import json

    manifest_path = source_dir / "plugin.json"
    if not manifest_path.is_file():
        raise InstallError("no_manifest", f"missing plugin.json in {source_dir}")
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        return validate_manifest(raw)
    except ManifestValidationError as exc:
        raise InstallError("bad_manifest", str(exc)) from exc
    except (OSError, ValueError) as exc:
        raise InstallError("bad_manifest", f"cannot read manifest: {exc}") from exc


def _enforce_monotonicity(plugin_id: str, new_version: str) -> None:
    highest = _highest_installed_version(plugin_id)
    if highest is None:
        return
    new_v = parse_semver(new_version)
    old_v = parse_semver(highest)
    if new_v <= old_v:
        raise InstallError(
            "version_rollback",
            f"version {new_version} is not newer than installed {highest}",
        )


def _make_staging_dir(plugin_id: str, version: str) -> Path:
    # uuid suffix makes the staging dir unique across concurrent installs of
    # the same version in one process (pid alone collides across threads).
    staging = staging_dir() / f"{plugin_id}-{version}.tmp.{os.getpid()}.{uuid.uuid4().hex}"
    staging.parent.mkdir(parents=True, exist_ok=True)
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir()
    return staging


def _copy_tree(src: Path, dst: Path) -> None:
    """Copy the full source tree into ``dst`` (already created)."""
    for entry in src.iterdir():
        target = dst / entry.name
        if entry.is_dir():
            shutil.copytree(entry, target)
        else:
            shutil.copy2(entry, target)


def _verify_signature(
    staging: Path,
    manifest: PluginManifest,
    public_key_b64: str,
) -> None:
    if not manifest.signature:
        raise InstallError(
            "unsigned", f"package {manifest.id}@{manifest.version} has no signature"
        )
    if not crypto.verify_package(staging, manifest.signature, public_key_b64):
        raise InstallError(
            "bad_signature",
            f"signature verification failed for {manifest.id}@{manifest.version}",
        )


def _prune_old_versions(plugin_id: str) -> None:
    """Keep only the ``_KEEP_VERSIONS`` newest versions; delete older."""
    versions = list_installed_versions(plugin_id)
    if len(versions) <= _KEEP_VERSIONS:
        return
    # versions is sorted ascending; delete all but the last _KEEP_VERSIONS.
    to_delete = versions[:-_KEEP_VERSIONS]
    plugin_root = plugins_cache_dir() / plugin_id
    for version in to_delete:
        old_dir = plugin_root / version
        if old_dir.is_dir():
            shutil.rmtree(old_dir, ignore_errors=True)
