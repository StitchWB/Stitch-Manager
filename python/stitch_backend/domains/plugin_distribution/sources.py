"""Plugin source abstraction — git repo + release asset fetch (todo 26).

Two trust tiers mirroring the existing channels (plan §addendum):
  - repo@ref (dev tier): clone url@ref, pin commit SHA into ``.source.json``.
    Unsigned → gated like plugins-local (``STITCH_DEV_MODE`` OR admin trust).
    Installs to ``plugins-local/{id}/`` (same as ``dev_install``).
  - release asset (distribution tier): download tarball, verify sha256 BEFORE
    extract.  Signed → ``install_package`` (signature verify path).  Unsigned
    → community tier gating (``STITCH_COMMUNITY_SERVICES`` for kind=service,
    ``STITCH_COMMUNITY_ENABLED`` for kind=data), installs to
    ``community/{id}/{version}/``.

The fetch + install pipeline reuses the same patterns as
``community_commands.py`` (unsigned community install) and ``sync.py``
(signed ``install_package``) — no new install logic, only the source
materialization (git clone / tarball download) is new.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import shutil
import subprocess
import tarfile
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from autoreg.plugin.crypto import load_embedded_pubkey, package_is_signed, read_manifest
from autoreg.plugin.install import install_package
from autoreg.plugin.layout import plugins_local_dir
from autoreg.plugin.loader import _community_enabled, _community_services_enabled

from .community import _atomic_replace_dir, _package_dir

logger = logging.getLogger(__name__)

_SOURCE_SIDECAR = ".source.json"
_GIT_TIMEOUT = 60
_HTTP_TIMEOUT = 60.0


@dataclass(frozen=True)
class PluginSourceSpec:
    """Describes a plugin source to fetch + install.

    type: ``'git'`` for repo@ref clone, ``'release'`` for tarball download.
    url: git URL (git mode) or tarball URL (release mode).  Local file
        paths are accepted for release assets (tests / local dev).
    ref: branch/tag/SHA to checkout (git mode).  Defaults to ``'main'``.
    release: tag name (release mode, informational).
    expected_sha256: required for release mode (checksum verify before
        extract).  Optional for git (commit SHA is pinned post-clone).
    """

    type: str
    url: str | None = None
    ref: str | None = None
    release: str | None = None
    expected_sha256: str | None = None


class SourceError(Exception):
    """Raised when a source fetch or trust-gate check is refused."""

    def __init__(self, reason: str, message: str) -> None:
        self.reason = reason
        super().__init__(message)


# ── fetch ────────────────────────────────────────────────────────────────────


async def fetch(spec: PluginSourceSpec, dest_dir: Path) -> Path:
    """Materialize a plugin package dir from ``spec`` into ``dest_dir``.

    Returns the package directory (containing ``plugin.json``).
    Raises :class:`SourceError` on any failure.
    """
    if spec.type == "git":
        return _fetch_git(spec, dest_dir)
    if spec.type == "release":
        return await _fetch_release(spec, dest_dir)
    raise SourceError("bad_type", f"unsupported source type: {spec.type}")


# ── git mode ─────────────────────────────────────────────────────────────────


def _fetch_git(spec: PluginSourceSpec, dest_dir: Path) -> Path:
    """Clone url@ref into dest_dir, pin commit SHA, write .source.json."""
    if not spec.url:
        raise SourceError("no_url", "git source requires url")
    ref = spec.ref or "main"

    tmp_clone = Path(tempfile.mkdtemp(prefix="stitch-src-git-"))
    try:
        _git_clone(spec.url, ref, tmp_clone)
        commit_sha = _git_rev_parse(tmp_clone)

        pkg_dir = _find_package_dir(tmp_clone)
        if pkg_dir is None:
            raise SourceError(
                "no_manifest", f"no plugin.json found in git clone of {spec.url}"
            )

        dest_dir.mkdir(parents=True, exist_ok=True)
        _copy_package(pkg_dir, dest_dir)
        _write_source_sidecar(
            dest_dir,
            {
                "url": spec.url,
                "ref": ref,
                "commit_sha": commit_sha,
                "fetched_at": _now_iso(),
            },
        )
        return dest_dir
    finally:
        shutil.rmtree(tmp_clone, ignore_errors=True)


def _git_clone(url: str, ref: str, dest: Path) -> None:
    """Clone url@ref into dest (depth 1 for branches/tags, full for SHA)."""
    if _looks_like_sha(ref):
        # Shallow clone by SHA is unreliable across git versions / hosts.
        result = subprocess.run(
            ["git", "clone", "--quiet", url, str(dest)],
            capture_output=True, text=True, timeout=_GIT_TIMEOUT,
        )
        if result.returncode != 0:
            raise SourceError(
                "clone_failed",
                f"git clone failed: {result.stderr.strip() or result.stdout.strip()}",
            )
        result = subprocess.run(
            ["git", "-C", str(dest), "checkout", "--quiet", ref],
            capture_output=True, text=True, timeout=_GIT_TIMEOUT,
        )
        if result.returncode != 0:
            raise SourceError(
                "checkout_failed",
                f"git checkout {ref} failed: {result.stderr.strip() or result.stdout.strip()}",
            )
    else:
        result = subprocess.run(
            ["git", "clone", "--depth", "1", "--branch", ref, "--quiet", url, str(dest)],
            capture_output=True, text=True, timeout=_GIT_TIMEOUT,
        )
        if result.returncode != 0:
            raise SourceError(
                "clone_failed",
                f"git clone --branch {ref} failed: {result.stderr.strip() or result.stdout.strip()}",
            )


def _git_rev_parse(repo: Path) -> str:
    """Return the pinned commit SHA of the cloned repo HEAD."""
    result = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        capture_output=True, text=True, timeout=10,
    )
    if result.returncode != 0:
        raise SourceError(
            "rev_parse_failed",
            f"git rev-parse HEAD failed: {result.stderr.strip()}",
        )
    return result.stdout.strip()


def _looks_like_sha(ref: str) -> bool:
    """True if ref looks like a 40-char hex git commit SHA."""
    return len(ref) == 40 and all(c in "0123456789abcdef" for c in ref.lower())


# ── release mode ─────────────────────────────────────────────────────────────


async def _fetch_release(spec: PluginSourceSpec, dest_dir: Path) -> Path:
    """Download tarball, verify sha256 BEFORE extract, locate package dir."""
    if not spec.url:
        raise SourceError("no_url", "release source requires url")

    data = await _download_or_read(spec.url)

    actual_sha = hashlib.sha256(data).hexdigest()
    if spec.expected_sha256 and actual_sha != spec.expected_sha256:
        raise SourceError(
            "checksum_mismatch",
            f"sha256 mismatch: expected {spec.expected_sha256}, got {actual_sha}",
        )

    dest_dir.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as tf:
        tf.extractall(dest_dir)

    pkg_dir = _find_package_dir(dest_dir)
    if pkg_dir is None:
        raise SourceError(
            "no_manifest", f"no plugin.json found in release tarball from {spec.url}"
        )
    return pkg_dir


async def _download_or_read(url: str) -> bytes:
    """Download from HTTP URL or read a local file path (tests / local dev)."""
    if url.startswith("file://"):
        return Path(url[7:]).read_bytes()
    p = Path(url)
    if p.exists() and p.is_file():
        return p.read_bytes()
    async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.content


# ── shared helpers ───────────────────────────────────────────────────────────


def _find_package_dir(root: Path, max_depth: int = 2) -> Path | None:
    """Find a dir containing ``plugin.json``, searching up to max_depth."""
    if (root / "plugin.json").is_file():
        return root
    if max_depth <= 0:
        return None
    for entry in sorted(root.iterdir()):
        if entry.is_dir():
            found = _find_package_dir(entry, max_depth - 1)
            if found is not None:
                return found
    return None


def _copy_package(src: Path, dst: Path) -> None:
    """Copy package tree from src to dst (overwrites dst)."""
    if dst.exists():
        shutil.rmtree(dst, ignore_errors=True)
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(src, dst)


def _write_source_sidecar(pkg_dir: Path, data: dict[str, Any]) -> None:
    """Write ``.source.json`` sidecar into pkg_dir."""
    (pkg_dir / _SOURCE_SIDECAR).write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── install hand-off ─────────────────────────────────────────────────────────


async def install_from_source(
    spec: PluginSourceSpec, *, trust: bool = False,
) -> dict[str, Any]:
    """Fetch + install a plugin from spec, respecting trust tiers.

    Returns ``{success, plugin_id, version, pinned_sha?}`` on success,
    or ``{success: False, error, reason?}`` on failure.
    """
    tmp_dir = Path(tempfile.mkdtemp(prefix="stitch-src-install-"))
    try:
        pkg_dir = await fetch(spec, tmp_dir)
        manifest = read_manifest(pkg_dir)

        if spec.type == "git":
            _gate_dev(trust)
            _install_to_local(pkg_dir, manifest.id)
            pinned = _read_sidecar_sha(pkg_dir)
            return {
                "success": True,
                "plugin_id": manifest.id,
                "version": manifest.version,
                "pinned_sha": pinned,
            }

        # Release mode: signed → install_package, unsigned → community tier.
        if package_is_signed(manifest):
            pubkey = load_embedded_pubkey()
            if not pubkey:
                raise SourceError("no_pubkey", "no embedded public key for signature verify")
            install_package(pkg_dir, public_key_b64=pubkey)
            return {
                "success": True,
                "plugin_id": manifest.id,
                "version": manifest.version,
                "pinned_sha": None,
            }

        _gate_community(manifest.kind)
        _install_to_community(pkg_dir, manifest.id, manifest.version)
        return {
            "success": True,
            "plugin_id": manifest.id,
            "version": manifest.version,
            "pinned_sha": None,
        }
    except SourceError as exc:
        return {"success": False, "error": str(exc), "reason": exc.reason}
    except Exception as exc:  # noqa: BLE001 — surface as command error
        logger.warning("install_from_source failed: %s", exc)
        return {"success": False, "error": str(exc)}


def _gate_dev(trust: bool) -> None:
    """Dev-tier gate: allow when STITCH_DEV_MODE OR admin trust=True."""
    if trust:
        return
    raw = os.environ.get("STITCH_DEV_MODE", "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return
    raise SourceError(
        "dev_gate", "git source requires STITCH_DEV_MODE or admin trust=True",
    )


def _gate_community(kind: str) -> None:
    """Community-tier gate for unsigned releases."""
    if kind == "service":
        if not _community_services_enabled():
            raise SourceError(
                "community_services_gate",
                "unsigned service release requires STITCH_COMMUNITY_SERVICES=1",
            )
    else:
        if not _community_enabled():
            raise SourceError(
                "community_gate",
                "unsigned release requires STITCH_COMMUNITY_ENABLED",
            )


def _install_to_local(pkg_dir: Path, plugin_id: str) -> None:
    """Install to plugins-local/{id}/ (dev tier, like dev_install)."""
    dest = plugins_local_dir() / plugin_id
    if dest.exists():
        shutil.rmtree(dest, ignore_errors=True)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(pkg_dir, dest)


def _install_to_community(pkg_dir: Path, plugin_id: str, version: str) -> None:
    """Install to community/{id}/{version}/ (community tier, like install_community)."""
    target = _package_dir(plugin_id, version)
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = target.parent / f".{version}.tmp.{os.getpid()}"
    if staging.exists():
        shutil.rmtree(staging, ignore_errors=True)
    shutil.copytree(pkg_dir, staging)
    _atomic_replace_dir(staging, target)


def _read_sidecar_sha(pkg_dir: Path) -> str | None:
    """Read commit_sha from .source.json sidecar (git mode)."""
    sidecar = pkg_dir / _SOURCE_SIDECAR
    if not sidecar.is_file():
        return None
    try:
        return json.loads(sidecar.read_text(encoding="utf-8")).get("commit_sha")
    except (OSError, ValueError):
        return None
