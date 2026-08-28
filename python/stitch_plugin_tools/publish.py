"""Publish + dev-install for plugin packages (plan §4.5, publish pipeline).

Two distribution paths share one package format and one loader:

    dev:   prepared_area/.../{id}/ -> dev-install -> <base>/plugins-local/{id}/
    prod:  prepared_area/.../{id}/ -> publish -> server {id}-{version}.zip
           -> client sync -> <base>/plugins/{id}/{version}/

``publish`` signs (optionally), zips, computes the transport sha256 and POSTs
to ``/admin/publish``.  ``dev-install`` copies a package into ``plugins-local``
for the local dev loop (no server, unsigned allowed in dev_mode).

Paths/URLs resolve from CLI flags first, then env vars — nothing hardcoded:

    STITCH_PUBLISH_URL   server base URL   (e.g. http://localhost:8900)
    STITCH_ADMIN_KEY     X-Admin-Key for /admin/*
    STITCH_SIGNING_KEY   path to the offline private.key
"""

from __future__ import annotations

import hashlib
import io
import os
import re
import shutil
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING

import httpx

from autoreg.plugin import crypto
from autoreg.plugin.layout import plugins_local_dir
from autoreg.plugin.manifest import MANIFEST_FILENAME, SCHEMA_ID

if TYPE_CHECKING:
    from typing import Any

# Env var names — single source of truth for publish-time config.
ENV_PUBLISH_URL = "STITCH_PUBLISH_URL"
ENV_ADMIN_KEY = "STITCH_ADMIN_KEY"
ENV_SIGNING_KEY = "STITCH_SIGNING_KEY"


# ── Packaging ──────────────────────────────────────────────────────────


def zip_package(package_dir: Path) -> bytes:
    """Zip the package contents with files at the zip root.

    The client runs ``extractall(tmp)`` then ``install_package(tmp)``, so the
    manifest must land at the zip root (no wrapping directory).  Files are
    walked in sorted order for reproducible archives.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for root, _dirs, files in os.walk(package_dir):
            for fname in sorted(files):
                full = Path(root) / fname
                rel = full.relative_to(package_dir).as_posix()
                zf.write(full, rel)
    return buf.getvalue()


# ── Config resolution ──────────────────────────────────────────────────


def resolve_publish_config(
    server_url: str | None,
    admin_key: str | None,
    signing_key_path: str | None,
) -> tuple[str, str, bytes | None]:
    """Resolve publish config from CLI flags, falling back to env vars.

    Returns ``(server_url, admin_key, signing_key_pem | None)``.
    Raises :class:`ValueError` if server_url or admin_key cannot be resolved,
    or if a provided signing key path does not exist.
    """
    url = (server_url or os.environ.get(ENV_PUBLISH_URL, "")).strip()
    key = (admin_key or os.environ.get(ENV_ADMIN_KEY, "")).strip()
    if not url:
        raise ValueError(f"no server url (--server-url or {ENV_PUBLISH_URL})")
    if not key:
        raise ValueError(f"no admin key (--admin-key or {ENV_ADMIN_KEY})")

    signing_pem: bytes | None = None
    key_path = (signing_key_path or os.environ.get(ENV_SIGNING_KEY, "")).strip()
    if key_path:
        p = Path(key_path)
        if not p.is_file():
            raise ValueError(f"signing key not found: {p}")
        signing_pem = p.read_bytes()
    return url, key, signing_pem


# ── Publish ────────────────────────────────────────────────────────────


async def publish_package(
    package_dir: Path,
    *,
    server_url: str,
    admin_key: str,
    signing_key_pem: bytes | None = None,
    rollout_percent: int = 0,
    variant_index: int | None = None,
    platform: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Sign (optional), zip, and publish a package to the server.

    When ``variant_index`` is provided, the upload is stored as a watermarked
    variant (``PluginVariant`` row) rather than the legacy
    ``PluginVersion.package_path``.  The caller is responsible for injecting
    the watermark BEFORE calling this function — see
    :func:`stitch_plugin_tools.watermark.inject_watermark`.

    Returns the parsed JSON response from ``/admin/publish``.  Raises
    :class:`httpx.HTTPStatusError` on a non-2xx response and
    :class:`httpx.HTTPError` on transport failure.
    """
    # 1. Sign in place if a key is provided (updates plugin.json signature).
    if signing_key_pem is not None:
        signature = crypto.sign_package(package_dir, signing_key_pem)
        crypto.write_signature(package_dir, signature)

    # 2. Read the manifest (post-sign) for id / version / signature.
    manifest = crypto.read_manifest(package_dir)

    # 3. Zip + transport sha256 (server re-checks against the uploaded bytes).
    zip_bytes = zip_package(package_dir)
    sha256 = hashlib.sha256(zip_bytes).hexdigest()

    # 4. POST /admin/publish (multipart, X-Admin-Key header).
    url = f"{server_url.rstrip('/')}/admin/publish"
    files = {
        "package": (
            f"{manifest.id}-{manifest.version}.zip",
            zip_bytes,
            "application/zip",
        )
    }
    data: dict[str, str] = {
        "plugin_id": manifest.id,
        "version": manifest.version,
        "package_sha256": sha256,
        "rollout_percent": str(rollout_percent),
    }
    if manifest.signature:
        data["package_signature"] = manifest.signature
    if variant_index is not None:
        data["variant_index"] = str(variant_index)
    if platform is not None:
        data["platform"] = platform
    # Forward description/author from plugin.json extras so the server can
    # store them on the Plugin row and serve them in the marketplace manifest.
    description = manifest.extras.get("description")
    if isinstance(description, str) and description:
        data["description"] = description
    author = manifest.extras.get("author")
    if isinstance(author, str) and author:
        data["author"] = author
    headers = {"X-Admin-Key": admin_key}

    own_client = client is None
    http = client or httpx.AsyncClient(timeout=60.0)
    try:
        resp = await http.post(url, data=data, files=files, headers=headers)
        resp.raise_for_status()
        return resp.json()
    finally:
        if own_client:
            await http.aclose()


# ── Dev install ────────────────────────────────────────────────────────


def _find_flat_i18n_keys(i18n: dict) -> list[str]:
    """Return a list of ``"<locale>.<key>"`` flat keys in an i18n bundle.

    A top-level key in a locale bundle that contains ``.`` is a *flat key*:
    the FE ``i18nPluginBundles.ts`` ``walkBundle`` walks dot-paths through
    nested objects, so a flat top-level key like ``"my.plugin.title"``
    silently never resolves.  Authors must nest:
    ``{"my": {"plugin": {"title": …}}}``.

    Returns ``[]`` when the bundle is well-formed (or not a dict — caller
    validates shape separately).
    """
    flat: list[str] = []
    if not isinstance(i18n, dict):
        return flat
    for locale, bundle in i18n.items():
        if not isinstance(bundle, dict):
            continue
        for key in bundle:
            if isinstance(key, str) and "." in key:
                flat.append(f"{locale}.{key}")
    return flat


def dev_install(package_dir: Path) -> Path:
    """Copy a package into ``plugins-local/{id}/`` (dev loop, no server).

    Overwrites any existing copy of the same plugin id.  Returns the
    destination path.  Excludes ``__pycache__``, ``*.pyc``, ``*.db``, and
    ``*.sqlite3`` so stale bytecode and test databases don't leak into the
    dev install.

    After copying, refreshes ``<pkg>/_vendor/`` from the canonical
    ``autoreg/plugin/rpc.py`` so the dev install always carries the
    current vendored server (idempotent byte-refresh).

    Raises :class:`ValueError` when the manifest carries an i18n bundle
    with a flat top-level key (contains ``.``) — the FE walkBundle walks
    dot-paths through nested objects, so flat keys silently never resolve.
    Catching this at dev-install time saves a confusing runtime failure.
    """
    manifest = crypto.read_manifest(package_dir)

    # i18n flat-key check — catch the silent walkBundle resolution failure
    # at dev-install time so authors fix it before publishing.
    i18n = manifest.contributions.get("i18n")
    if isinstance(i18n, dict):
        flat_keys = _find_flat_i18n_keys(i18n)
        if flat_keys:
            raise ValueError(
                f"i18n bundle in {manifest.id} has flat top-level keys "
                f"({', '.join(flat_keys)}) — nest them under objects "
                f"(FE walkBundle walks dot-paths; flat keys never resolve)"
            )

    dest = plugins_local_dir() / manifest.id
    if dest.exists():
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(
        package_dir,
        dest,
        ignore=shutil.ignore_patterns(
            "__pycache__", "*.pyc", "*.db", "*.sqlite3",
        ),
    )

    # Refresh _vendor/ from canonical so the dev install is standalone.
    module = manifest.entry.get("module") if manifest.entry else None
    if module and (dest / module).is_dir():
        from stitch_plugin_tools.vendoring import vendor_rpc_server
        vendor_rpc_server(dest / module)

    return dest


# ── Engine-pack assembly ───────────────────────────────────────────────


# Solver modules to bundle from autoreg/captcha/ into the engine-pack.
# Only aliyun_slider is copied here — turnstile is replaced by the unified
# solver from engine-pack/captcha/ which supports local_service, remote_http,
# and opencv_dom backends.
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


def pack_engine(
    out_dir: Path,
    *,
    version: str = "0.1.0",
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
        version: Semver version string (default ``"0.1.0"``).
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

    # Locate source directories: explicit checkout root, or the installed
    # SDK location (back-compat).
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
        "version": version,
        "service": service,
        "kind": "engine-pack",
        "engine": {"min": "0.3.0", "api": 2},
        "depends": [],
        "entry": {},
        "capabilities": ["captcha.solve"],
        "outputs": [],
        "signature": "",
        # Captcha backend configuration — declarative, swappable without code.
        # Default: local_service (bundled D3-vin). To use a central farm,
        # change type to "remote_http" and set endpoint + auth_token.
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
    (out_dir / MANIFEST_FILENAME).write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )

    # ── 2. Unified TurnstileSolver from engine-pack source ───────────────
    # This is the single source of truth — replaces old turnstile.py +
    # turnstile_api.py pair.  Supports local_service, remote_http, opencv_dom.
    engine_pack_src = plugin_dir / "engine-pack" / "captcha"
    captcha_dst = out_dir / "captcha"
    if engine_pack_src.is_dir():
        shutil.copytree(
            engine_pack_src, captcha_dst, dirs_exist_ok=True,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
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

    # ── 4. Bundled D3-vin turnstile SERVICE ──────────────────────────────
    # Makes the engine-pack self-sufficient: the solver launches this service
    # when type=local_service.  Copied from repo's vendor/ submodule.
    # Excludes: .git, __pycache__, *.pyc, proxies.txt (user-specific config).
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
    version: str = "0.1.0",
    providers_root: Path | None = None,
) -> Path:
    """Assemble a self-contained CODE plugin package from ``<providers>/<id>/``.

    Mirrors :func:`pack_engine`: copies the provider implementation into the
    package dir, bundles ``base.py`` + ``common.py`` if any bundled module
    imports them, rewrites all imports to package-relative or host-resolved
    absolute form, emits ``plugin.json`` (``kind=provider``, entry
    ``provider.py`` / class ``Provider``), and appends a ``Provider = <ClassName>``
    alias to ``provider.py`` so the manifest entry class resolves.

    The package is unsigned — sign with :func:`autoreg.plugin.crypto.sign_package`
    + :func:`autoreg.plugin.crypto.write_signature`, then publish with
    :func:`publish_package` (same pipeline as engine-pack).

    Args:
        provider_id: Provider directory name (e.g. ``"kiro"``).
        out_dir: Target directory for the package. Created if absent.
        version: Semver version string (default ``"0.1.0"``).
        providers_root: Directory containing ``<provider_id>/`` plus the
            shared ``base.py`` / ``common.py`` — e.g. a method repo's
            ``providers/`` tree.  ``None`` (default) resolves
            ``autoreg/providers/`` from the installed SDK location
            (back-compat with the monorepo layout).
    """
    import json

    out_dir.mkdir(parents=True, exist_ok=True)

    # Locate the providers tree: explicit root, or the installed SDK
    # location (back-compat).
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
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
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
        "id": f"{provider_id}-provider",
        "name": f"{provider_id} provider",
        "description": f"Code plugin for {provider_id} registration provider.",
        "author": "WhiteBite",
        "version": version,
        "service": provider_id,
        "kind": "provider",
        "engine": {"min": "0.3.0", "api": 2},
        "depends": [],
        "entry": {"module": "provider.py", "class": "Provider"},
        "capabilities": [f"autoreg.{provider_id}"],
        "outputs": [],
        "signature": "",
    }
    (out_dir / MANIFEST_FILENAME).write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    return out_dir


def compile_provider_package(package_dir: Path, provider_id: str) -> Path:
    """Compile a staged provider plugin package into one native extension.

    Takes the output of :func:`pack_provider` (a directory of ``.py`` files +
    ``plugin.json``) and replaces the Python sources with a single
    Nuitka-compiled extension module, then rewrites the manifest entry to the
    compiled form.  This is what keeps the method source code out of the
    distributed artifact — only machine code ships.

    The package is compiled under the module name ``<provider_id>_provider``
    (identifier-safe; matches the ``PyInit_`` export the loader resolves).  The
    compiled ``--mode=package`` output bundles every package module yet leaves
    host imports (``autoreg.shared``, ``pydantic``, ...) as runtime imports
    resolved from the host app — verified empirically.

    Requires a C compiler reachable by Nuitka (MSVC on Windows, gcc/cc on
    Linux) and ``nuitka`` installed in the running interpreter.

    Args:
        package_dir: Staged package directory (from :func:`pack_provider`).
        provider_id: Provider id (e.g. ``"trae"``).

    Returns the path of the compiled extension module inside ``package_dir``.

    Raises:
        FileNotFoundError: ``provider.py`` missing from the staged package.
        ValueError: the ``Provider = <Class>`` alias cannot be detected.
        RuntimeError: Nuitka failed or produced no binary.
    """
    import json
    import subprocess
    import sys
    import tempfile

    base_name = f"{provider_id.replace('-', '_')}_provider"

    # ── 1. Detect the real provider class (exported by the package __init__) ─
    provider_py = package_dir / "provider.py"
    if not provider_py.is_file():
        raise FileNotFoundError(f"provider.py not found in {package_dir}")
    match = re.search(
        r"^Provider\s*=\s*(\w+)", provider_py.read_text(encoding="utf-8"), re.MULTILINE
    )
    if not match:
        raise ValueError(
            f"could not detect 'Provider = <Class>' alias in {provider_py}"
        )
    class_name = match.group(1)

    with tempfile.TemporaryDirectory(prefix="stitch-nuitka-") as tmp:
        # ── 2. Copy package sources into a dir named exactly base_name ────────
        # Nuitka derives the compiled module name from the directory name.
        src_dir = Path(tmp) / base_name
        src_dir.mkdir()
        for py_file in package_dir.rglob("*.py"):
            dst = src_dir / py_file.relative_to(package_dir)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(py_file, dst)

        # ── 3. Compile the whole package into one extension module ─────────
        build_out = Path(tmp) / "build"
        cmd = [
            sys.executable,
            "-m",
            "nuitka",
            "--mode=package",
            "--remove-output",   # clean intermediate C build artefacts
            "--no-pyi-file",     # no type stubs in the distributed package
            f"--output-dir={build_out}",
            str(src_dir),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(
                f"Nuitka compile failed for {provider_id} "
                f"(rc={proc.returncode}):\n{proc.stdout[-2000:]}\n{proc.stderr[-2000:]}"
            )

        # ── 4. Move the produced binary into the package dir ───────────────
        binaries = [
            b
            for b in build_out.glob(f"{base_name}.*")
            if b.is_file() and not b.name.endswith((".pyi", ".json"))
        ]
        if not binaries:
            raise RuntimeError(
                f"Nuitka reported success but no {base_name}.* binary in {build_out}"
            )
        binary = sorted(binaries)[0]
        target = package_dir / binary.name
        shutil.copy2(binary, target)

    # ── 5. Strip the Python sources — only the binary must ship ──────────
    for py_file in list(package_dir.rglob("*.py")):
        py_file.unlink()
    for pyc_file in list(package_dir.rglob("*.pyc")):
        pyc_file.unlink()
    for cache_dir in list(package_dir.rglob("__pycache__")):
        shutil.rmtree(cache_dir, ignore_errors=True)

    # ── 6. Rewrite the manifest entry to the compiled form ───────────────
    manifest_path = package_dir / MANIFEST_FILENAME
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["entry"] = {
        "module": base_name,
        "class": class_name,
        "compiled": True,
    }
    manifest_path.write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    return target
