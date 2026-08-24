"""Owner commands for the developer sandbox (server-side).

Registers per-user commands for installing, listing, watching logs,
restarting, and uninstalling sandbox plugins.  All commands are scoped
strictly to ``_caller_user_id`` — guests (no session) are refused 403,
and a user never sees another user's sandbox (404 for unknown / not-owned
ids).

Gates: sandbox installs are dev-tier — require ``STITCH_DEV_MODE`` OR
caller role ``admin`` (mirrors ``sources._gate_dev`` semantics) so
production servers can lock it down.  Community sandbox caps (5s / 256MB)
ALWAYS apply to sandbox hosts regardless of env (see ``host.py``).
"""

from __future__ import annotations

import logging
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status

from autoreg.plugin.crypto import read_manifest
from autoreg.plugin.layout import sandbox_plugin_dir
from autoreg.plugin.manifest import semver_sort_key
from stitch_backend.core.command_registry import register_command
from stitch_backend.domains.plugin_distribution.pins import (
    check_and_record_scoped,
)
from stitch_backend.domains.plugin_distribution.sources import (
    PluginSourceSpec,
    SourceError,
    _copy_package,
    _read_sidecar_sha,
    fetch,
)
from stitch_backend.domains.plugin_runtime.discovery import (
    SERVICE_ENGINE_VERSION,
)
from stitch_backend.domains.plugin_runtime.sandbox import (
    ensure_sandbox_host,
    list_sandbox_plugins,
    register_sandbox_manifest,
    uninstall_sandbox_plugin,
)

logger = logging.getLogger(__name__)

#: Reuse the same regex as the bridge for plugin_id validation.
from stitch_backend.domains.plugin_runtime.bridge import _PLUGIN_ID_RE  # noqa: E402


def _gate_sandbox_dev(trust: bool, caller_role: str | None) -> bool:
    """Dev-tier gate: allow when ``STITCH_DEV_MODE`` OR admin role OR trust.

    Mirrors ``sources._gate_dev`` but adds the admin-role bypass so a
    server admin can install sandbox plugins without flipping the env
    flag.  ``trust`` is the explicit admin override (mirrors the
    ``--trust`` CLI flag on ``install-from``).
    """
    if trust:
        return True
    if caller_role == "admin":
        return True
    raw = os.environ.get("STITCH_DEV_MODE", "").strip().lower()
    return raw in ("1", "true", "yes", "on")


@register_command("sandbox_install")
async def cmd_sandbox_install(params: dict[str, Any]) -> dict[str, Any]:
    """Install a plugin from a git/release source into the caller's sandbox.

    Params:
        url: git URL (git mode) or tarball URL (release mode).
        ref: branch/tag/SHA (git mode).  Defaults to 'main'.
        sha256: release-mode checksum (verified before extract).
        trust: admin override for the dev-tier gate.
        force: TOFU pin override (accept a changed pin).

    Returns ``{success, plugin_id, version, pinned_sha}`` or
    ``{success: False, error, reason?}``.

    Gates: authenticated caller required (guests 403); dev-tier gate
    (``STITCH_DEV_MODE`` OR admin role OR ``trust=True``).
    """
    caller_user_id = params.get("_caller_user_id")
    caller_role = params.get("_caller_role")

    if caller_user_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="sandbox install requires an authenticated caller",
        )

    url = str(params.get("url", ""))
    if not url:
        return {"success": False, "error": "url required"}

    ref = params.get("ref")
    sha256 = params.get("sha256")
    trust = bool(params.get("trust", False))
    force = bool(params.get("force", False))

    if not _gate_sandbox_dev(trust, caller_role):
        return {
            "success": False,
            "error": "sandbox install requires STITCH_DEV_MODE or admin role",
            "reason": "dev_gate",
        }

    # Determine source type: sha256 present + no ref → release; else git.
    if sha256 is not None and ref is None:
        spec = PluginSourceSpec(
            type="release",
            url=url,
            expected_sha256=str(sha256),
        )
    else:
        spec = PluginSourceSpec(
            type="git",
            url=url,
            ref=str(ref) if ref is not None else None,
            expected_sha256=str(sha256) if sha256 is not None else None,
        )

    tmp_dir = Path(tempfile.mkdtemp(prefix="stitch-sandbox-install-"))
    try:
        pkg_dir = await fetch(spec, tmp_dir)
        manifest = read_manifest(pkg_dir)
        plugin_id = manifest.id

        # Refuse engine.min newer than the host's service-plugin engine.
        # Uses semver_sort_key so that a same-triple prerelease (e.g.
        # "0.3.0-rc.1") is accepted while a higher-triple prerelease (e.g.
        # "0.4.0-alpha") is correctly rejected.
        engine_api = manifest.engine.get("api")
        if engine_api is not None and engine_api >= 2:
            engine_min = manifest.engine.get("min", "")
            try:
                if semver_sort_key(engine_min) > semver_sort_key(SERVICE_ENGINE_VERSION):
                    return {
                        "success": False,
                        "error": (
                            f"engine.min {engine_min} is newer than host "
                            f"service-plugin engine {SERVICE_ENGINE_VERSION}"
                        ),
                        "reason": "engine_too_new",
                    }
            except ValueError:
                return {
                    "success": False,
                    "error": f"engine.min {engine_min} is not valid semver",
                    "reason": "engine_too_new",
                }

        # Determine pin value (git: commit SHA post-clone; release: sha256).
        if spec.type == "git":
            pinned_sha = _read_sidecar_sha(pkg_dir)
            if not pinned_sha:
                return {
                    "success": False,
                    "error": "git install succeeded but no commit SHA was pinned",
                    "reason": "no_pinned_sha",
                }
        else:
            pinned_sha = spec.expected_sha256 or ""

        # TOFU pin check (scoped per user+plugin).  For release mode the
        # pin is known upfront — check before copy.  For git mode the pin
        # is known post-clone — check now (before copy to sandbox dir).
        ok, msg = check_and_record_scoped(
            caller_user_id,
            plugin_id,
            new_sha=pinned_sha,
            url=url,
            force=force,
        )
        if not ok:
            return {"success": False, "error": msg, "reason": "pin_mismatch"}

        # Copy package to the user's sandbox dir.
        sandbox_pkg = sandbox_plugin_dir(caller_user_id, plugin_id)
        _copy_package(pkg_dir, sandbox_pkg)

        # Register manifest in the sandbox registry.
        register_sandbox_manifest(caller_user_id, plugin_id, manifest)

        # Start or refresh the sandbox host (on-demand).
        await ensure_sandbox_host(caller_user_id, plugin_id)

        logger.info(
            "sandbox_install: user=%s plugin=%s@%s pinned=%s",
            caller_user_id, plugin_id, manifest.version, pinned_sha,
        )
        return {
            "success": True,
            "plugin_id": plugin_id,
            "version": manifest.version,
            "pinned_sha": pinned_sha,
        }
    except SourceError as exc:
        return {"success": False, "error": str(exc), "reason": exc.reason}
    except Exception as exc:  # noqa: BLE001 — surface as command error
        logger.warning("sandbox_install failed: %s", exc)
        return {"success": False, "error": str(exc)}
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@register_command("sandbox_list", readonly=True)
async def cmd_sandbox_list(params: dict[str, Any]) -> list[dict[str, Any]]:
    """List the caller's sandbox plugins with status + pin info.

    Returns ``[{id, version, status, pinned_source}]``.  Each ``status``
    is the host's status dict (when running) or ``None`` (when not
    running).  ``pinned_source`` is the scoped TOFU pin or ``None``.
    """
    caller_user_id = params.get("_caller_user_id")
    if caller_user_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="sandbox commands require an authenticated caller",
        )
    return list_sandbox_plugins(caller_user_id)


@register_command("sandbox_logs", readonly=True)
async def cmd_sandbox_logs(params: dict[str, Any]) -> list[str]:
    """Return the last N lines from the caller's sandbox plugin host logs.

    Params:
        plugin_id: the sandbox plugin id (must be owned by the caller).
        lines: max lines to return (default 100).
    """
    caller_user_id = params.get("_caller_user_id")
    if caller_user_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="sandbox commands require an authenticated caller",
        )
    plugin_id = params.get("plugin_id")
    if not isinstance(plugin_id, str) or not _PLUGIN_ID_RE.match(plugin_id):
        raise HTTPException(
            status_code=400, detail="plugin_id is required and must be valid"
        )
    from stitch_backend.domains.plugin_runtime.sandbox import get_sandbox_host

    host = get_sandbox_host(caller_user_id, plugin_id)
    if host is None:
        raise HTTPException(
            status_code=404, detail=f"Unknown sandbox plugin: {plugin_id}"
        )
    lines = params.get("lines", 100)
    if not isinstance(lines, int) or lines < 0:
        lines = 100
    return host.get_logs(lines)


@register_command("sandbox_restart")
async def cmd_sandbox_restart(params: dict[str, Any]) -> dict[str, Any]:
    """Restart the caller's sandbox plugin host.

    Params:
        plugin_id: the sandbox plugin id (must be owned by the caller).
    """
    caller_user_id = params.get("_caller_user_id")
    if caller_user_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="sandbox commands require an authenticated caller",
        )
    plugin_id = params.get("plugin_id")
    if not isinstance(plugin_id, str) or not _PLUGIN_ID_RE.match(plugin_id):
        raise HTTPException(
            status_code=400, detail="plugin_id is required and must be valid"
        )
    from stitch_backend.domains.plugin_runtime.sandbox import get_sandbox_host

    host = get_sandbox_host(caller_user_id, plugin_id)
    if host is None:
        raise HTTPException(
            status_code=404, detail=f"Unknown sandbox plugin: {plugin_id}"
        )
    return await host.restart()


@register_command("sandbox_uninstall")
async def cmd_sandbox_uninstall(params: dict[str, Any]) -> dict[str, Any]:
    """Uninstall the caller's sandbox plugin.

    Stops the host, removes the package + data dirs, drops registry
    entries, and removes the scoped pin.

    Params:
        plugin_id: the sandbox plugin id (must be owned by the caller).
    """
    caller_user_id = params.get("_caller_user_id")
    if caller_user_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="sandbox commands require an authenticated caller",
        )
    plugin_id = params.get("plugin_id")
    if not isinstance(plugin_id, str) or not _PLUGIN_ID_RE.match(plugin_id):
        raise HTTPException(
            status_code=400, detail="plugin_id is required and must be valid"
        )
    result = await uninstall_sandbox_plugin(caller_user_id, plugin_id)
    if not result.get("success"):
        raise HTTPException(
            status_code=404,
            detail=str(result.get("error", "not installed")),
        )
    return result
