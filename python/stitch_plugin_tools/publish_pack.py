"""Engine-pack and provider-plugin assembly for the publish pipeline.

``pack_engine`` builds the engine-pack from the canonical source tree;
``pack_provider`` assembles a self-contained kind=provider CODE package
(copy + base/common bundling + import rewrite + manifest emit).  Both are
re-exported from :mod:`stitch_plugin_tools.publish`, which keeps the
network-facing publish/dev-install half.
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path

from autoreg.plugin import crypto
from autoreg.plugin.manifest import (
    MANIFEST_FILENAME,
    SCHEMA_ID,
    validate_manifest,
)

# Only aliyun_slider is bundled; turnstile comes from the engine-pack unified solver.
_ENGINE_PACK_SOLVERS = ("aliyun_slider",)


def _default_src_roots() -> tuple[Path, Path]:
    """Derive ``(autoreg_root, repo_root)`` from the installed SDK location.

    Back-compat default for :func:`pack_engine` / :func:`pack_provider`:
    ``crypto.__file__`` → ``autoreg/plugin/crypto.py`` → ``autoreg/`` → repo
    root.  Callers that build from an explicit checkout (e.g. a standalone
    plugin repo's CI) pass ``src_root`` / ``providers_root`` instead.
    """
    plugin_dir = Path(crypto.__file__).resolve().parent  # autoreg/plugin/
    autoreg_root = plugin_dir.parent                     # autoreg/
    repo_root = autoreg_root.parents[1]                  # python/ → repo root
    return autoreg_root, repo_root


_CANONICAL_METADATA_KEYS = (
    "description", "author", "category", "status", "icon",
    "features", "changelog", "homepage", "repository",
)


def _canonical_manifest(plugin_id: str) -> dict | None:
    """Return the canonical authored manifest for ``plugin_id``, else ``None``.

    Canonical manifests carry the rich marketplace fields generated manifests
    lack; they live in ``python/autoreg/plugin/<id>/`` (engine-pack + provider
    packs) and ``plugins-src/<id>/`` (service plugins) of this repo.
    """
    import json

    repo_root = Path(__file__).resolve().parents[2]
    roots = (
        repo_root / "python" / "autoreg" / "plugin",
        repo_root / "plugins-src",
    )
    for root in roots:
        if not root.is_dir():
            continue
        for manifest_path in sorted(root.glob(f"*/{MANIFEST_FILENAME}")):
            raw = json.loads(manifest_path.read_text(encoding="utf-8"))
            if raw.get("id") == plugin_id:
                return raw
    return None


def _merge_canonical_metadata(manifest: dict, canonical: dict | None) -> dict:
    """Copy the marketplace fields present in ``canonical`` over ``manifest``."""
    if canonical:
        for key in _CANONICAL_METADATA_KEYS:
            if key in canonical:
                manifest[key] = canonical[key]
    return manifest


def pack_engine(
    out_dir: Path,
    *,
    version: str | None = None,
    name: str = "Engine Pack",
    service: str = "engine",
    src_root: Path | None = None,
) -> Path:
    """Assemble an engine-pack from the canonical source tree.

    The engine-pack consists of:
      1. ``plugin.json`` — manifest with ``captcha_backends`` config
      2. ``captcha/turnstile.py`` — unified multi-backend solver
      3. ``captcha/aliyun_slider.py`` — aliyun slider solver (from autoreg)
      4. ``vendor/turnstile-solver/`` — bundled D3-vin HTTP service
      5. ``captcha/checkbox_template.png`` — OpenCV template (optional)

    The unified TurnstileSolver (item 2) replaces the old separate
    turnstile.py + turnstile_api.py pair.  It supports three backends:
      - ``local_service`` : launch bundled D3-vin at <pack>/vendor/...
      - ``remote_http``   : call a central farm endpoint (config-only switch)
      - ``opencv_dom``    : pure in-browser fallback (always available)

    The captcha_backends config lives in plugin.json extras so that
    operators can switch from local_service → remote_http without
    rebuilding the pack — just update the manifest on the server.

    Args:
        out_dir: Target directory for the engine-pack. Created if absent.
        version: Semver version string.  ``None`` (default) takes the
            canonical manifest's version, falling back to ``"0.1.0"``.
        name: Human-readable pack name (default ``"Engine Pack"``).
        service: Service identifier (default ``"engine"``).
        src_root: Repo root to assemble from — must contain
            ``python/autoreg/`` (engine-pack + captcha sources) and
            ``vendor/turnstile-solver/``.  ``None`` (default) resolves the
            roots from the installed SDK location (back-compat).

    Returns:
        The path to the assembled engine-pack directory.
    """
    import json

    out_dir.mkdir(parents=True, exist_ok=True)

    if src_root is not None:
        repo_root = Path(src_root)
        autoreg_root = repo_root / "python" / "autoreg"
        plugin_dir = autoreg_root / "plugin"
    else:
        autoreg_root, repo_root = _default_src_roots()
        plugin_dir = autoreg_root / "plugin"
    captcha_src = autoreg_root / "captcha"               # autoreg/captcha/

    # ── 1. plugin.json with captcha_backends config ──────────────────────
    manifest = {
        "schema": SCHEMA_ID,
        "id": "engine-pack",
        "name": name,
        "version": version or "0.1.0",
        "service": service,
        "kind": "engine-pack",
        "engine": {"min": "0.3.0", "api": 2},
        "depends": [],
        "entry": {},
        "capabilities": ["captcha.solve"],
        "outputs": [],
        "signature": "",
        # Declarative captcha backend; swap local_service for remote_http + endpoint to use a farm.
        "captcha_backends": {
            "turnstile": {
                "type": "local_service",
                "service_dir": "vendor/turnstile-solver",
                "service_entrypoint": "api.py",
                "service_port_env": "TURNSTILE_SOLVER_PORT",
                "service_host_env": "TURNSTILE_API_HOST",
                "headless": True,
                "fallback": "opencv_dom",
            }
        },
    }
    canonical = _canonical_manifest("engine-pack")
    _merge_canonical_metadata(manifest, canonical)
    manifest["version"] = version or (canonical or {}).get("version") or "0.1.0"
    validate_manifest(manifest)
    (out_dir / MANIFEST_FILENAME).write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )

    # Unified TurnstileSolver from engine-pack: single source for local_service, remote_http, opencv_dom.
    engine_pack_src = plugin_dir / "engine-pack" / "captcha"
    captcha_dst = out_dir / "captcha"
    if engine_pack_src.is_dir():
        shutil.copytree(
            engine_pack_src, captcha_dst, dirs_exist_ok=True,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".git"),
        )
        # Add aliyun_slider from autoreg/captcha/ (not part of unified pack).
        aliyun_src = captcha_src / "aliyun_slider.py"
        if aliyun_src.is_file():
            shutil.copy2(aliyun_src, captcha_dst / "aliyun_slider.py")
    else:
        # Fallback: build captcha dir from individual sources (greenfield).
        captcha_dst.mkdir(exist_ok=True)
        legacy_turnstile = autoreg_root / "captcha" / "turnstile.py"
        if legacy_turnstile.is_file():
            shutil.copy2(legacy_turnstile, captcha_dst / "turnstile.py")
        for solver in _ENGINE_PACK_SOLVERS:
            src = captcha_src / f"{solver}.py"
            if src.is_file():
                shutil.copy2(src, captcha_dst / src.name)

    # ── 3. OpenCV checkbox template (optional, degrades gracefully) ──────
    template_src = captcha_src / "checkbox_template.png"
    if template_src.is_file():
        shutil.copy2(template_src, out_dir / "captcha" / template_src.name)

    # Bundled D3-vin service makes the pack self-sufficient when type=local_service.
    service_src = repo_root / "vendor" / "turnstile-solver"
    if service_src.is_dir():
        service_dst = out_dir / "vendor" / "turnstile-solver"
        if service_dst.exists():
            shutil.rmtree(service_dst)
        shutil.copytree(
            service_src,
            service_dst,
            ignore=shutil.ignore_patterns(
                ".git", "__pycache__", "*.pyc", "proxies.txt",
            ),
        )

    return out_dir


# ── Provider plugin assembly ────────────────────────────────────────────


def _rewrite_provider_imports(source: str, provider_id: str) -> str:
    """Rewrite imports in a bundled provider module to package-relative.

    Transforms (applied to every ``.py`` file in the assembled package):

      ``from ..base import``        → ``from .base import``      (bundled)
      ``from ..common import``      → ``from .common import``    (bundled)
      ``from ..<other>.X import``    → ``from autoreg.providers.<other>.X import``
      ``from ..<other> import``     → ``from autoreg.providers.<other> import``
      ``from ...X import``          → ``from autoreg.X import``  (host-resolved)
      ``from autoreg.providers.<id>.X import`` → ``from .X import``
      ``from autoreg.providers.<id> import``    → ``from . import``
      ``from autoreg.providers.base import``    → ``from .base import``
      ``from autoreg.providers.common import`` → ``from .common import``

    One-dot relative imports (``from .browser import``) are left untouched —
    they already resolve within the bundled package.
    """
    pid = re.escape(provider_id)

    # Absolute imports referencing the provider's own package → package-relative
    source = re.sub(
        rf"from autoreg\.providers\.{pid}\.([\w.]+) import",
        r"from .\1 import",
        source,
    )
    source = re.sub(
        rf"from autoreg\.providers\.{pid} import",
        "from . import",
        source,
    )
    # Absolute imports to base/common → package-relative (bundled copies)
    source = re.sub(
        r"from autoreg\.providers\.base import",
        "from .base import",
        source,
    )
    source = re.sub(
        r"from autoreg\.providers\.common import",
        "from .common import",
        source,
    )

    # Two-dot relative: ..base / ..common → .base / .common (bundled)
    source = re.sub(r"from \.\.base import", "from .base import", source)
    source = re.sub(r"from \.\.common import", "from .common import", source)
    # Two-dot relative: ..<other>.X → autoreg.providers.<other>.X (cross-provider)
    source = re.sub(
        r"from \.\.([a-zA-Z_]\w*)\.([\w.]+) import",
        r"from autoreg.providers.\1.\2 import",
        source,
    )
    source = re.sub(
        r"from \.\.([a-zA-Z_]\w*) import",
        r"from autoreg.providers.\1 import",
        source,
    )
    # Three-dot relative: ...X → autoreg.X (host-resolved absolute)
    source = re.sub(
        r"from \.\.\.([\w.]+) import",
        r"from autoreg.\1 import",
        source,
    )
    # Four-dot relative: ....X → autoreg.X (unlikely, but handle for safety)
    source = re.sub(
        r"from \.\.\.\.([\w.]+) import",
        r"from autoreg.\1 import",
        source,
    )
    return source


def pack_provider(
    provider_id: str,
    out_dir: Path,
    *,
    version: str | None = None,
    providers_root: Path | None = None,
) -> Path:
    """Assemble a self-contained CODE plugin package from ``<providers>/<id>/``.

    Mirrors :func:`pack_engine`: copies the provider implementation into the
    package dir, bundles ``base.py`` + ``common.py`` if any bundled module
    imports them, rewrites all imports to package-relative or host-resolved
    absolute form, emits ``plugin.json`` (``kind=provider``, entry
    ``provider.py`` / class ``Provider``), and appends a ``Provider = <ClassName>``
    alias to ``provider.py`` so the manifest entry class resolves.

    The emitted manifest id is the canonical ``<provider>-autoreg`` form
    (``kiro`` → ``kiro-autoreg``); marketplace metadata and the default
    version come from the canonical manifest when one exists.

    The package is unsigned — sign with :func:`autoreg.plugin.crypto.sign_package`
    + :func:`autoreg.plugin.crypto.write_signature`, then publish with
    :func:`publish_package` (same pipeline as engine-pack).

    Args:
        provider_id: Provider directory name (e.g. ``"kiro"``).
        out_dir: Target directory for the package. Created if absent.
        version: Semver version string.  ``None`` (default) takes the
            canonical manifest's version, falling back to ``"0.1.0"``.
        providers_root: Directory containing ``<provider_id>/`` plus the
            shared ``base.py`` / ``common.py`` — e.g. a method repo's
            ``providers/`` tree.  ``None`` (default) resolves
            ``autoreg/providers/`` from the installed SDK location
            (back-compat with the monorepo layout).
    """
    import json

    out_dir.mkdir(parents=True, exist_ok=True)

    if providers_root is not None:
        providers_src = Path(providers_root)
    else:
        autoreg_root, _repo_root = _default_src_roots()
        providers_src = autoreg_root / "providers"      # autoreg/providers/
    provider_src = providers_src / provider_id

    if not provider_src.is_dir():
        raise FileNotFoundError(f"provider source not found: {provider_src}")

    # ── 1. Copy provider implementation ────────────────────────────────
    shutil.copytree(
        provider_src, out_dir, dirs_exist_ok=True,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".git"),
    )

    # ── 2. Bundle base.py + common.py if any bundled file imports them ──
    needs_base = False
    needs_common = False
    for py_file in out_dir.rglob("*.py"):
        text = py_file.read_text(encoding="utf-8")
        if "from ..base import" in text or "from autoreg.providers.base import" in text:
            needs_base = True
        if "from ..common import" in text or "from autoreg.providers.common import" in text:
            needs_common = True
    if needs_base:
        base_src = providers_src / "base.py"
        if base_src.is_file():
            shutil.copy2(base_src, out_dir / "base.py")
    if needs_common:
        common_src = providers_src / "common.py"
        if common_src.is_file():
            shutil.copy2(common_src, out_dir / "common.py")

    # ── 3. Rewrite imports in all .py files ─────────────────────────────
    for py_file in out_dir.rglob("*.py"):
        text = py_file.read_text(encoding="utf-8")
        rewritten = _rewrite_provider_imports(text, provider_id)
        if rewritten != text:
            py_file.write_text(rewritten, encoding="utf-8")

    # ── 4. Append Provider alias to provider.py ────────────────────────
    provider_py = out_dir / "provider.py"
    if not provider_py.is_file():
        raise FileNotFoundError(
            f"provider.py not found in {provider_src} — cannot emit entry point"
        )
    source = provider_py.read_text(encoding="utf-8")
    match = re.search(r"^class (\w+Provider)\b", source, re.MULTILINE)
    if not match:
        raise ValueError(
            f"could not detect provider class in {provider_py} "
            f"(expected a class matching \\w+Provider)"
        )
    class_name = match.group(1)
    if f"Provider = {class_name}" not in source:
        provider_py.write_text(
            source.rstrip()
            + f"\n\n# Plugin entry alias (generated by pack_provider)\n"
            f"Provider = {class_name}\n",
            encoding="utf-8",
        )

    # ── 5. Emit plugin.json ───────────────────────────────────────────
    manifest = {
        "schema": SCHEMA_ID,
        "id": f"{provider_id.replace('_', '-')}-autoreg",
        "name": f"{provider_id} provider",
        "description": f"Code plugin for {provider_id} registration provider.",
        "author": "WhiteBite",
        "version": version or "0.1.0",
        "service": provider_id,
        "kind": "provider",
        "engine": {"min": "0.3.0", "api": 2},
        "depends": [],
        "entry": {"module": "provider.py", "class": "Provider"},
        "capabilities": [f"autoreg.{provider_id}"],
        "outputs": [],
        "signature": "",
    }
    canonical = _canonical_manifest(manifest["id"])
    _merge_canonical_metadata(manifest, canonical)
    manifest["version"] = version or (canonical or {}).get("version") or "0.1.0"
    validate_manifest(manifest)
    (out_dir / MANIFEST_FILENAME).write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    return out_dir


# Service-plugin sources are standalone git repos, so their trees carry VCS/CI/docs files that must not ship.
PACKAGE_EXCLUDE_DIRS = frozenset(
    {
        ".git",
        ".github",
        ".ruff_cache",
        ".mypy_cache",
        ".pytest_cache",
        "__pycache__",
        ".venv",
        "node_modules",
        "tests",
    }
)

_PACKAGE_EXCLUDE_FILES = frozenset(
    {".gitignore", ".gitattributes", ".gitmodules", "ruff.toml", "pyproject.toml"}
)
_PACKAGE_EXCLUDE_PREFIXES = ("README", "LICENSE")
_PACKAGE_EXCLUDE_SUFFIXES = (".pyc", ".pyo", ".log", ".db", ".sqlite3")


def _package_excluded(rel: Path) -> bool:
    if any(part in PACKAGE_EXCLUDE_DIRS for part in rel.parts):
        return True
    name = rel.name
    if name in _PACKAGE_EXCLUDE_FILES or name.startswith(_PACKAGE_EXCLUDE_PREFIXES):
        return True
    return name.endswith(_PACKAGE_EXCLUDE_SUFFIXES)


def pack_service(package_dir: Path, out_dir: Path) -> Path:
    """Assemble a clean, signable copy of a service-plugin package.

    Copies ``package_dir`` into ``out_dir`` minus repository/CI metadata and
    dev-only tests (see :data:`PACKAGE_EXCLUDE_DIRS`), so the signed artifact
    carries only the runtime payload (``plugin.json`` + module + ``_vendor``).
    Unlike :func:`pack_provider` / :func:`pack_engine` no code is rewritten —
    service plugins are self-contained subprocesses.

    Packing to a fresh directory (rather than signing ``package_dir`` in
    place) also keeps ``publish`` from mutating the source tree, which matters
    once ``plugins-src/<id>`` is a git submodule: an in-place signature write
    would dirty the checked-out public repo.

    Args:
        package_dir: Source package root (must contain ``plugin.json``).
        out_dir: Destination pack directory (recreated if it exists).

    Returns:
        ``out_dir``.

    Raises:
        FileNotFoundError: when ``package_dir`` has no ``plugin.json``.
    """
    if not (package_dir / MANIFEST_FILENAME).is_file():
        raise FileNotFoundError(f"no {MANIFEST_FILENAME} in {package_dir}")

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    for src in sorted(package_dir.rglob("*")):
        if not src.is_file():
            continue
        rel = src.relative_to(package_dir)
        if _package_excluded(rel):
            continue
        dst = out_dir / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    return out_dir
