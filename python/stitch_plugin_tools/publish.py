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
from autoreg.plugin.manifest import (
    MANIFEST_FILENAME,
    PluginManifest,
    resolve_i18n,
    validate_manifest,
)
from stitch_plugin_tools.publish_compile import (
    compile_provider_package as compile_provider_package,
)
from stitch_plugin_tools.publish_pack import pack_engine as pack_engine
from stitch_plugin_tools.publish_pack import pack_provider as pack_provider
from stitch_plugin_tools.publish_pack import pack_service as pack_service
from stitch_plugin_tools.ui_manifest import assert_contributions

if TYPE_CHECKING:
    from typing import Any

# Env var names — single source of truth for publish-time config.
ENV_PUBLISH_URL = "STITCH_PUBLISH_URL"
ENV_ADMIN_KEY = "STITCH_ADMIN_KEY"
ENV_SIGNING_KEY = "STITCH_SIGNING_KEY"

# DOS epoch floor: a fixed entry timestamp keeps archives byte-reproducible.
_ZIP_FIXED_DATE = (1980, 1, 1, 0, 0, 0)


# ── Packaging ──────────────────────────────────────────────────────────


def zip_package(package_dir: Path) -> bytes:
    """Zip the package contents with files at the zip root.

    The client runs ``extractall(tmp)`` then ``install_package(tmp)``, so the
    manifest must land at the zip root (no wrapping directory).  Files are
    walked in sorted order with fixed entry timestamps so identical trees
    produce byte-identical archives (reproducible signed artifacts).
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(package_dir):
            dirs.sort()
            for fname in sorted(files):
                full = Path(root) / fname
                rel = full.relative_to(package_dir).as_posix()
                info = zipfile.ZipInfo(rel, date_time=_ZIP_FIXED_DATE)
                info.compress_type = zipfile.ZIP_DEFLATED
                zf.writestr(info, full.read_bytes())
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

# validate_manifest only type-checks these; the official publish path requires presence.
REQUIRED_PUBLISH_METADATA = ("description", "category", "status")


def _require_publish_metadata(manifest: PluginManifest) -> None:
    """Raise ``ValueError`` when required marketplace metadata is missing.

    The official publish channel ships rich marketplace metadata; community
    packages (installed via the catalog, not this path) stay exempt.
    """
    missing: list[str] = []
    if not resolve_i18n(manifest.extras.get("description")):
        missing.append("description")
    for key in ("category", "status"):
        value = manifest.extras.get(key)
        if not isinstance(value, str) or not value.strip():
            missing.append(key)
    if missing:
        raise ValueError(
            f"manifest {manifest.id}@{manifest.version} is missing marketplace "
            f"metadata required for official publish: {', '.join(missing)}"
        )


def _require_ui_contributions(manifest: PluginManifest) -> None:
    """Raise ``ValueError`` when the manifest's UI contributions are invalid."""
    assert_contributions(manifest.id, manifest.contributions)


def _marketplace_form_fields(manifest: PluginManifest) -> dict[str, str]:
    """Extract marketplace metadata extras into /admin/publish form fields.

    ``description`` carries the resolved plain string (ru-first via
    ``resolve_i18n``); when the manifest value was an i18n object, the raw
    object is also sent JSON-encoded as ``description_i18n``.  ``features``
    and ``changelog`` travel JSON-encoded.  Absent extras are simply not
    sent — the server leaves the corresponding Plugin columns untouched.
    """
    import json

    fields: dict[str, str] = {}
    extras = manifest.extras

    description = extras.get("description")
    if description is not None:
        resolved = resolve_i18n(description)
        if resolved:
            fields["description"] = resolved
        if isinstance(description, dict):
            fields["description_i18n"] = json.dumps(description, ensure_ascii=False)

    for key in ("author", "category", "status", "icon", "homepage", "repository"):
        value = extras.get(key)
        if isinstance(value, str) and value:
            fields[key] = value

    for key in ("features", "changelog"):
        value = extras.get(key)
        if isinstance(value, list):
            fields[key] = json.dumps(value, ensure_ascii=False)

    return fields


def _assert_no_env_files(package_dir: Path) -> None:
    """Refuse to publish a package tree that still carries env files.

    Callers sign the tree before publishing, so stripping files later would
    break the signature; a raw repo-root package (with an operator ``.env``)
    must be packed first via ``pack_service``.  Failing loudly beats leaking
    secrets to the distribution server.
    """
    offenders = sorted(
        path.relative_to(package_dir).as_posix()
        for path in package_dir.rglob("*")
        if path.is_file() and path.name.startswith(".env")
    )
    if offenders:
        raise ValueError(
            "package carries env files that must not ship, pack it first "
            "(pack-service): " + ", ".join(offenders[:5])
        )


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
    _assert_no_env_files(package_dir)

    # Gate before signing: signing mutates plugin.json, so missing metadata must fail first.
    manifest = crypto.read_manifest(package_dir)
    _require_publish_metadata(manifest)
    _require_ui_contributions(manifest)

    # Sign in place if a key is provided (updates plugin.json signature).
    if signing_key_pem is not None:
        signature = crypto.sign_package(package_dir, signing_key_pem)
        crypto.write_signature(package_dir, signature)
        # Re-read: the signature field changed on disk.
        manifest = crypto.read_manifest(package_dir)

    # Zip + transport sha256 (server re-checks against the uploaded bytes).
    zip_bytes = zip_package(package_dir)
    sha256 = hashlib.sha256(zip_bytes).hexdigest()

    # POST /admin/publish (multipart, X-Admin-Key header).
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
    data.update(_marketplace_form_fields(manifest))
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


def dev_install(package_dir: Path, *, link: bool = False) -> Path:
    """Copy a package into ``plugins-local/{id}/`` (dev loop, no server).

    With ``link=True`` no copy is made: the destination holds only a
    ``.stitch-link`` pointer file with the absolute path of ``package_dir``,
    so edits in the working copy are live without re-install.  Vendor refresh
    is skipped in link mode — the working copy belongs to the author.

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
    Also raises when the UI contributions fail the manifest gate — see
    :mod:`stitch_plugin_tools.ui_manifest`.
    """
    from autoreg.plugin.layout import LINK_FILENAME

    manifest = crypto.read_manifest(package_dir)

    # i18n flat-key check: catch silent walkBundle resolution failures at dev-install, before publishing.
    i18n = manifest.contributions.get("i18n")
    if isinstance(i18n, dict):
        flat_keys = _find_flat_i18n_keys(i18n)
        if flat_keys:
            raise ValueError(
                f"i18n bundle in {manifest.id} has flat top-level keys "
                f"({', '.join(flat_keys)}) — nest them under objects "
                f"(FE walkBundle walks dot-paths; flat keys never resolve)"
            )

    _require_ui_contributions(manifest)

    dest = plugins_local_dir() / manifest.id
    if dest.exists():
        # Both link and copy dests are safe to rmtree: a link holds only the pointer file, never real package files.
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)

    if link:
        dest.mkdir()
        (dest / LINK_FILENAME).write_text(
            str(package_dir.resolve()), encoding="utf-8"
        )
        return dest

    shutil.copytree(
        package_dir,
        dest,
        ignore=shutil.ignore_patterns(
            "__pycache__", "*.pyc", "*.db", "*.sqlite3",
        ),
    )

    # Refresh _vendor/ from canonical so the dev install always carries the current vendored server (idempotent).
    module = manifest.entry.get("module") if manifest.entry else None
    if module and (dest / module).is_dir():
        from stitch_plugin_tools.vendoring import vendor_all
        vendor_all(dest / module)

    return dest


# Canonical ids resolve via pack_provider's <slug>-autoreg rule.
_PUBLISH_ALL_PROVIDERS = (
    "kiro", "kiro_v2", "windsurf", "trae", "fireworks", "qoder", "v0_app",
)


async def publish_all(
    *,
    server_url: str,
    admin_key: str,
    signing_pem: bytes | None,
    only: list[str] | None = None,
    dry_run: bool = False,
) -> list[dict]:
    """Publish every official package in one run (17 packages).

    Registry:
      1. every ``plugins-src/<id>/`` whose manifest has ``kind == "service"``
         (packed fresh into a temp dir),
      2. the engine-pack (packed fresh into a temp dir),
      3. the seven autoreg providers (packed fresh into temp dirs).

    Entries are processed sorted by manifest id.  With ``only`` given,
    non-matching entries are reported as ``skipped``.  ``dry_run=True``
    validates each manifest and never touches the network.  A per-entry
    failure is recorded as ``failed`` and never aborts the run.  Temp dirs
    are always removed.

    Returns one ``{"id", "version", "status", "error"}`` dict per entry,
    status ∈ ``published | dry-run | failed | skipped``.
    """
    import json
    import tempfile

    repo_root = Path(__file__).resolve().parents[2]
    temp_dirs: list[Path] = []
    try:
        package_dirs: list[Path] = []
        plugins_src = repo_root / "plugins-src"
        if plugins_src.is_dir():
            for child in sorted(plugins_src.iterdir()):
                manifest_path = child / MANIFEST_FILENAME
                if not child.is_dir() or not manifest_path.is_file():
                    continue
                raw = json.loads(manifest_path.read_text(encoding="utf-8"))
                if raw.get("kind") == "service":
                    pack_dir = Path(tempfile.mkdtemp(prefix=f"stitch-{raw['id']}-"))
                    temp_dirs.append(pack_dir)
                    pack_service(child, pack_dir)
                    package_dirs.append(pack_dir)

        engine_dir = Path(tempfile.mkdtemp(prefix="stitch-engine-pack-"))
        temp_dirs.append(engine_dir)
        pack_engine(engine_dir)
        package_dirs.append(engine_dir)

        for provider_id in _PUBLISH_ALL_PROVIDERS:
            provider_dir = Path(tempfile.mkdtemp(prefix=f"stitch-{provider_id}-"))
            temp_dirs.append(provider_dir)
            pack_provider(provider_id, provider_dir)
            package_dirs.append(provider_dir)

        records: list[tuple[dict, Path]] = []
        for package_dir in package_dirs:
            raw = json.loads(
                (package_dir / MANIFEST_FILENAME).read_text(encoding="utf-8")
            )
            records.append((raw, package_dir))
        records.sort(key=lambda r: r[0]["id"])

        results: list[dict] = []
        for raw, package_dir in records:
            entry = {
                "id": raw["id"],
                "version": raw["version"],
                "status": "",
                "error": None,
            }
            results.append(entry)
            if only is not None and raw["id"] not in only:
                entry["status"] = "skipped"
                continue
            try:
                if dry_run:
                    validate_manifest(raw)
                    entry["status"] = "dry-run"
                else:
                    await publish_package(
                        package_dir,
                        server_url=server_url,
                        admin_key=admin_key,
                        signing_key_pem=signing_pem,
                        rollout_percent=100,
                    )
                    entry["status"] = "published"
            except Exception as exc:
                entry["status"] = "failed"
                entry["error"] = str(exc)
        return results
    finally:
        for temp_dir in temp_dirs:
            shutil.rmtree(temp_dir, ignore_errors=True)
