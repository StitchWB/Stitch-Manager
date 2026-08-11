"""Engine-pack loader — prototype (plan §4.6).

The engine-pack is a signed, gated *engine* module: captcha solvers now
(``turnstile`` / ``aliyun_slider``), hooks-runtime later.  Unlike data-only
plugins it carries engine CODE, so it is the precursor of v2 "code plugins".

Why it exists: the binary channel (GitHub releases) is public — anything
baked into the exe leaks.  The open-core binary therefore does NOT bundle the
captcha solvers; they ship through the same gated data channel as plugins,
signed with the same offline key, downloaded after activation and cached under
the plugin cache at ``plugins/engine-pack/<version>/``.

Layout of an installed engine-pack (mirrors the plugin package layout):

    plugins-local/engine-pack/          # dev source (single working copy)
    plugins/engine-pack/<version>/      # server cache (versioned, newest wins)
        plugin.json                     # manifest, id == "engine-pack"
        captcha/
            turnstile.py
            aliyun_slider.py
            ...

This prototype locates the newest installed engine-pack and dynamically imports
a captcha solver module from it.  When no engine-pack is installed the loader
returns ``None`` and callers (e.g. ``CaptchaMixin``) degrade gracefully — the
open-core simply has no captcha solving until the pack is downloaded.

The Qoder IDE bypass module is explicitly NOT part of the engine-pack: it
cannot even sit on the distribution server and lives only in rare releases
for a narrow circle.
"""

from __future__ import annotations

import importlib.util
import json
import logging
import os
import re
from pathlib import Path
from types import ModuleType

from . import crypto
from .layout import plugins_cache_dir, plugins_local_dir
from .manifest import ManifestValidationError, parse_semver, validate_manifest

logger = logging.getLogger(__name__)

# Reserved plugin id for the engine-pack. Must never collide with a provider
# autoreg plugin id.
ENGINE_PACK_ID = "engine-pack"

# Subdirectory inside the engine-pack that holds captcha solver modules.
_CAPTCHA_SUBDIR = "captcha"

_DEV_MODE_ENV = "STITCH_DEV_MODE"

# Valid Python module name — blocks path separators, "..", and anything else
# that could escape the captcha/ subdirectory (path-traversal guard).
_MODULE_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _resolve_dev_mode(flag: bool | None) -> bool:
    if flag is not None:
        return flag
    raw = os.environ.get(_DEV_MODE_ENV, "").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _try_read_manifest(pack: Path):
    """Read + validate a manifest, returning ``None`` on any failure."""
    manifest_path = pack / "plugin.json"
    if not manifest_path.is_file():
        return None
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
        return validate_manifest(raw)
    except (OSError, ValueError, ManifestValidationError):
        return None


def _verify_engine_pack(pack: Path, public_key_b64: str | None) -> bool:
    """Verify the engine-pack signature. Mirrors ``PluginLoader._verify_signed``."""
    if not public_key_b64:
        logger.warning("no public key configured; cannot verify %s", pack)
        return False
    manifest = _try_read_manifest(pack)
    if manifest is None or not manifest.signature:
        logger.warning("engine-pack %s has no signature; refusing", pack)
        return False
    return crypto.verify_package(pack, manifest.signature, public_key_b64)


def locate_engine_pack(
    *,
    dev_mode: bool | None = None,
    public_key_b64: str | None = None,
) -> Path | None:
    """Locate the installed engine-pack directory.

    Signature policy (mirrors ``PluginLoader``):
      * ``plugins-local/engine-pack/`` is used ONLY in ``dev_mode`` (unsigned
        ok for rapid iteration).  In non-dev mode it is ignored entirely, so
        an attacker who can write to ``plugins-local`` gets nothing.
      * The server cache (``plugins/engine-pack/<version>/``, newest semver
        wins) ALWAYS requires a valid signature, even in dev_mode.

    Returns ``None`` when no trusted engine-pack is installed.
    """
    dev = _resolve_dev_mode(dev_mode)
    pubkey = public_key_b64 or crypto.load_embedded_pubkey()

    if dev:
        local = plugins_local_dir() / ENGINE_PACK_ID
        if local.is_dir():
            logger.debug(
                "dev_mode: using plugins-local/%s (unsigned ok)", ENGINE_PACK_ID
            )
            return local

    pack_root = plugins_cache_dir() / ENGINE_PACK_ID
    if not pack_root.is_dir():
        return None
    versions = [
        d for d in pack_root.iterdir() if d.is_dir() and not d.name.startswith(".")
    ]
    if not versions:
        return None

    def _sort_key(p: Path) -> tuple[int, int, int]:
        try:
            return parse_semver(p.name)
        except ValueError:
            return (-1, -1, -1)  # non-semver dirs sort as oldest

    newest = max(versions, key=_sort_key)
    if _verify_engine_pack(newest, pubkey):
        return newest
    logger.warning("cache engine-pack %s has invalid signature; skipping", newest)
    return None


def load_solver_module(
    module_name: str,
    *,
    dev_mode: bool | None = None,
    public_key_b64: str | None = None,
) -> ModuleType | None:
    """Dynamically import a captcha solver module from the engine-pack.

    ``module_name`` is the solver module filename without extension, e.g.
    ``"turnstile"`` for ``captcha/turnstile.py`` inside the engine-pack.
    Returns the loaded module, or ``None`` when no trusted engine-pack is
    installed, the module is absent, or ``module_name`` is not a safe module
    name (path-traversal guard).
    """
    if not _MODULE_NAME_RE.match(module_name):
        logger.warning("refusing unsafe engine-pack module name: %r", module_name)
        return None

    pack = locate_engine_pack(dev_mode=dev_mode, public_key_b64=public_key_b64)
    if pack is None:
        return None
    module_path = pack / _CAPTCHA_SUBDIR / f"{module_name}.py"
    if not module_path.is_file():
        return None

    qualname = f"stitch_engine_pack.{_CAPTCHA_SUBDIR}.{module_name}"
    spec = importlib.util.spec_from_file_location(qualname, module_path)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def get_solver_class(
    module_name: str,
    class_name: str,
    *,
    dev_mode: bool | None = None,
    public_key_b64: str | None = None,
) -> type | None:
    """Return a solver class from the engine-pack, or ``None`` if unavailable.

    Convenience wrapper over :func:`load_solver_module`.  ``class_name`` is the
    attribute name of the solver class within the module, e.g.
    ``get_solver_class("turnstile", "TurnstileSolver")``.
    """
    module = load_solver_module(
        module_name, dev_mode=dev_mode, public_key_b64=public_key_b64
    )
    if module is None:
        return None
    cls = getattr(module, class_name, None)
    return cls if isinstance(cls, type) else None
