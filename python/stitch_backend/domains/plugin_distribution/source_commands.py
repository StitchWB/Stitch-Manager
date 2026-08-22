"""Admin command for installing a plugin from a git/release source (todo 26).

Registers ``install_plugin_from_source`` (admin_only=True) — accepts
``{url, ref?, release?, expected_sha256?, trust?}`` and delegates to
:func:`stitch_backend.domains.plugin_distribution.sources.install_from_source`.

The ``trust`` param lets an admin override the dev-tier gate explicitly
(mirrors the ``--trust`` CLI flag).  The command is admin-gated so a
regular web user can never reach the host through the dispatcher.
"""

from __future__ import annotations

import logging
from typing import Any

from stitch_backend.core.command_registry import register_command

from .sources import PluginSourceSpec, install_from_source

logger = logging.getLogger(__name__)


@register_command("install_plugin_from_source", admin_only=True)
async def cmd_install_plugin_from_source(params: dict) -> dict:
    """Install a plugin from a git repo or release tarball.

    Params:
        url: git URL (git mode) or tarball URL (release mode).
        ref: branch/tag/SHA (git mode).  Defaults to 'main'.
        release: tag name (release mode).  When present, switches to
            release mode; when absent + ref present, git mode.
        expected_sha256: required for release mode (checksum verify).
        trust: admin override for the dev-tier gate (git mode).

    Returns ``{success, plugin_id, version, pinned_sha?}`` or
    ``{success: False, error}``.
    """
    url = str(params.get("url", ""))
    if not url:
        return {"success": False, "error": "url required"}

    ref = params.get("ref")
    release = params.get("release")
    expected_sha256 = params.get("expected_sha256")
    trust = bool(params.get("trust", False))

    # Determine source type: release param → release mode; else git.
    if release is not None or (ref is None and expected_sha256 is not None):
        spec = PluginSourceSpec(
            type="release",
            url=url,
            release=str(release) if release is not None else None,
            expected_sha256=str(expected_sha256) if expected_sha256 is not None else None,
        )
    else:
        spec = PluginSourceSpec(
            type="git",
            url=url,
            ref=str(ref) if ref is not None else None,
            expected_sha256=str(expected_sha256) if expected_sha256 is not None else None,
        )

    result = await install_from_source(spec, trust=trust)
    if not result.get("success"):
        logger.warning("install_plugin_from_source failed: %s", result.get("error"))
    else:
        logger.info(
            "install_plugin_from_source: %s@%s (pinned=%s)",
            result.get("plugin_id"),
            result.get("version"),
            result.get("pinned_sha"),
        )
    return result
