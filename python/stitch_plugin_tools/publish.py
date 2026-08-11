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


# ── Packaging ──────────────────────────────────────────────────────────────────


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


# ── Config resolution ──────────────────────────────────────────────────────────


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


# ── Publish ────────────────────────────────────────────────────────────────────


async def publish_package(
    package_dir: Path,
    *,
    server_url: str,
    admin_key: str,
    signing_key_pem: bytes | None = None,
    rollout_percent: int = 0,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Sign (optional), zip, and publish a package to the server.

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


# ── Dev install ────────────────────────────────────────────────────────────────


def dev_install(package_dir: Path) -> Path:
    """Copy a package into ``plugins-local/{id}/`` (dev loop, no server).

    Overwrites any existing copy of the same plugin id.  Returns the
    destination path.
    """
    manifest = crypto.read_manifest(package_dir)
    dest = plugins_local_dir() / manifest.id
    if dest.exists():
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(package_dir, dest)
    return dest


# ── Engine-pack assembly ───────────────────────────────────────────────────────


# Solver modules to bundle from autoreg/captcha/ into the engine-pack.
# Both are self-contained (no autoreg.* imports) — copied verbatim.
_ENGINE_PACK_SOLVERS = ("turnstile", "aliyun_slider")


def pack_engine(
    out_dir: Path,
    *,
    version: str = "0.1.0",
    name: str = "Engine Pack",
    service: str = "engine",
) -> Path:
    """Assemble an engine-pack from the real ``autoreg/captcha/`` solvers.

    Copies the captcha solver modules from the open-core source tree into a
    publish-ready engine-pack directory.  The assembled pack passes
    ``stitch_plugin_tools sign`` + ``verify`` unchanged.

    Import-handling decisions per solver module (plan §4.6):

    - ``turnstile.py`` — self-contained (stdlib only: ``os``, ``random``,
      ``time``, ``collections.abc``, ``pathlib``).  Zero ``autoreg.*``
      imports.  Copied verbatim.  References ``checkbox_template.png`` via
      ``Path(__file__).parent``; the template is NOT bundled (file does not
      exist in the repo) and the solver degrades gracefully (returns
      ``False`` on missing template).

    - ``aliyun_slider.py`` — self-contained (stdlib + lazy ``cv2``,
      ``numpy``, ``captcha_recognizer``).  Zero ``autoreg.*`` imports.
      Copied verbatim.  External deps are engine runtime deps, not bundled.

    Both solvers have zero ``autoreg.*`` imports — no import rewriting
    needed.  This is the intended design: the pack ships method code, the
    engine API stays open.

    The captcha source directory is located via the plugin package path
    (``autoreg/plugin/crypto.py`` → ``autoreg/captcha/``) so no
    ``autoreg.captcha`` import is needed here (zone-boundary clean).

    Args:
        out_dir: Target directory for the engine-pack. Created if absent.
        version: Semver version string (default ``"0.1.0"``).
        name: Human-readable pack name (default ``"Engine Pack"``).
        service: Service identifier (default ``"engine"``).

    Returns:
        The path to the assembled engine-pack directory.

    Raises:
        FileNotFoundError: if the captcha source directory or a solver
            module is not found.
    """
    import json

    out_dir.mkdir(parents=True, exist_ok=True)

    # Locate the real captcha source dir via the plugin package path:
    # autoreg/plugin/crypto.py -> autoreg/plugin/ -> autoreg/ -> autoreg/captcha/
    captcha_src = Path(crypto.__file__).parent.parent / "captcha"
    if not captcha_src.is_dir():
        raise FileNotFoundError(f"captcha source not found: {captcha_src}")

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
        "capabilities": [],
        "outputs": [],
        "signature": "",
    }
    (out_dir / MANIFEST_FILENAME).write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )

    captcha_dst = out_dir / "captcha"
    captcha_dst.mkdir(exist_ok=True)
    for solver in _ENGINE_PACK_SOLVERS:
        src = captcha_src / f"{solver}.py"
        if not src.is_file():
            raise FileNotFoundError(f"solver module not found: {src}")
        shutil.copy2(src, captcha_dst / src.name)

    return out_dir
