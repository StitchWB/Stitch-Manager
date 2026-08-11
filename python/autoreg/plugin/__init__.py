"""Stitch plugin system core (Phase 1, data-only).

Public surface:
    manifest  — PluginManifest + validate_manifest
    layout    — data-dir resolution (plugins-local / cache / staging)
    crypto    — ed25519 sign/verify of plugin packages
    install   — atomic installer with version monotonicity + LKG retention
    loader    — PluginLoader.resolve(service_id) dual-format resolver

This module is intentionally side-effect free; import submodules explicitly.
"""

from __future__ import annotations

from .manifest import ManifestValidationError, PluginManifest, validate_manifest

__all__ = [
    "ManifestValidationError",
    "PluginManifest",
    "validate_manifest",
]
