"""Manual plugin install commands (ADR-006, channels B1/B2).

``install_local_plugin`` installs a package from a local directory or zip:

- **signed** → verified and installed into the versioned cache
  (``plugins/{id}/{version}/``), trust ``official`` — the signature IS the
  entitlement, no dev_mode needed;
- **unsigned** → requires ``STITCH_DEV_MODE``; copied to ``plugins-local/``,
  trust ``local``.

Zip inputs are extracted to a temp dir; a single top-level wrapper dir is
unwrapped (``pkg-1.2.3/plugin.json`` layouts).
"""

from __future__ import annotations

import json
import logging
import shutil
import tempfile
import zipfile
from pathlib import Path

from autoreg.plugin import crypto
from autoreg.plugin.install import InstallError, install_package
from autoreg.plugin.manifest import validate_manifest
from stitch_backend.core.command_registry import register_command

logger = logging.getLogger(__name__)


def _dev_mode() -> bool:
    import os

    return os.environ.get("STITCH_DEV_MODE", "").strip().lower() in (
        "1", "true", "yes", "on",
    )


def _unwrap_single_dir(root: Path) -> Path:
    """If ``root`` holds exactly one directory and no plugin.json, descend."""
    if (root / "plugin.json").is_file():
        return root
    entries = [e for e in root.iterdir() if not e.name.startswith(".")]
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return root


@register_command("install_local_plugin")
async def cmd_install_local_plugin(params: dict) -> dict:
    raw_path = str(params.get("path", "")).strip()
    if not raw_path:
        return {"success": False, "error": "path required"}
    src = Path(raw_path)
    if not src.exists():
        return {"success": False, "error": f"not found: {src}"}

    tmp_dir: Path | None = None
    try:
        if src.is_file():
            if src.suffix.lower() != ".zip":
                return {"success": False, "error": "expected a directory or .zip"}
            tmp_dir = Path(tempfile.mkdtemp(prefix="stitch-local-install-"))
            with zipfile.ZipFile(src) as zf:
                zf.extractall(tmp_dir)
            src = _unwrap_single_dir(tmp_dir)

        if not (src / "plugin.json").is_file():
            return {"success": False, "error": "plugin.json not found (not a package dir)"}
        try:
            manifest = validate_manifest(
                json.loads((src / "plugin.json").read_text(encoding="utf-8"))
            )
        except Exception as exc:  # noqa: BLE001 — report as install failure
            return {"success": False, "error": f"manifest invalid: {exc}"}

        if manifest.signature:
            pubkey = crypto.load_embedded_pubkey()
            if not pubkey:
                return {"success": False, "error": "no embedded public key"}
            try:
                target = install_package(src, public_key_b64=pubkey)
            except InstallError as exc:
                return {"success": False, "error": str(exc)}
            logger.info("local install (signed): %s@%s -> %s", manifest.id, manifest.version, target)
            return {
                "success": True,
                "id": manifest.id,
                "version": manifest.version,
                "trust": "official",
                "path": str(target),
            }

        if not _dev_mode():
            return {
                "success": False,
                "error": "unsigned package requires dev mode (STITCH_DEV_MODE)",
            }
        from stitch_plugin_tools.publish import dev_install

        dest = dev_install(src)
        logger.info("local install (unsigned, dev_mode): %s -> %s", manifest.id, dest)
        return {
            "success": True,
            "id": manifest.id,
            "version": manifest.version,
            "trust": "local",
            "path": str(dest),
        }
    except zipfile.BadZipFile:
        return {"success": False, "error": "corrupt zip file"}
    finally:
        if tmp_dir is not None:
            shutil.rmtree(tmp_dir, ignore_errors=True)


@register_command("uninstall_local_plugin")
async def cmd_uninstall_local_plugin(params: dict) -> dict:
    """Remove a package from plugins-local (manual/dev installs)."""
    plugin_id = str(params.get("id", "")).strip()
    if not plugin_id or "/" in plugin_id or "\\" in plugin_id:
        return {"success": False, "error": "valid id required"}
    from autoreg.plugin.layout import plugins_local_dir

    target = plugins_local_dir() / plugin_id
    if not target.is_dir():
        return {"success": False, "error": f"not installed locally: {plugin_id}"}
    shutil.rmtree(target)
    logger.info("local uninstall: %s", plugin_id)
    return {"success": True, "id": plugin_id}
