"""Release preview command for the submit modal.

``preview_release`` downloads a release tarball/zip (https only, streamed,
100MB cap, 30s timeout), computes the sha256 over the raw bytes, and
best-effort parses the package manifest (``plugin.json`` at the archive
root or under a single top-level wrapper dir — same layout the install
path accepts) for id/version prefill.  The sha256 is NOT the signed
``package_sha256`` — different algorithm and scope.

All failures arrive as ``{success: False, error}`` dicts; the command
never raises.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import tarfile
import zipfile
from collections.abc import Callable
from typing import Any
from urllib.parse import urlsplit

import httpx

from stitch_backend.core.command_registry import register_command

logger = logging.getLogger(__name__)

_MAX_BYTES = 100 * 1024 * 1024
_TIMEOUT_SECONDS = 30.0
_MANIFEST_NAME = "plugin.json"


class _DownloadError(Exception):
    """Release download failure carrying a user-readable message."""


@register_command("preview_release", readonly=True, timeout=60.0)
async def cmd_preview_release(params: dict) -> dict[str, Any]:
    """Compute sha256 + manifest prefill for a release URL.

    Params: ``{url}``.  Returns ``{success, sha256, manifest_id,
    manifest_version}`` — the manifest fields are ``None`` when the
    archive carries no parsable ``plugin.json``.
    """
    url = str(params.get("url", "")).strip()
    if not url:
        return {"success": False, "error": "url required"}
    if urlsplit(url).scheme.lower() != "https":
        return {"success": False, "error": "only https URLs are supported"}

    try:
        data = await _stream_download(url)
    except _DownloadError as exc:
        return {"success": False, "error": str(exc)}

    manifest_id, manifest_version = _manifest_prefill(data, url)
    return {
        "success": True,
        "sha256": hashlib.sha256(data).hexdigest(),
        "manifest_id": manifest_id,
        "manifest_version": manifest_version,
    }


async def _stream_download(url: str) -> bytes:
    chunks: list[bytes] = []
    size = 0
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(_TIMEOUT_SECONDS), follow_redirects=True
    ) as client:
        try:
            async with client.stream("GET", url) as resp:
                if resp.status_code >= 400:
                    raise _DownloadError(
                        f"download failed (HTTP {resp.status_code})"
                    )
                async for chunk in resp.aiter_bytes():
                    size += len(chunk)
                    if size > _MAX_BYTES:
                        raise _DownloadError(
                            "release exceeds the 100MB limit"
                        )
                    chunks.append(chunk)
        except httpx.HTTPError as exc:
            logger.warning("preview_release download failed: %s", exc)
            raise _DownloadError(
                "release download failed (network error)"
            ) from exc
    return b"".join(chunks)


def _manifest_prefill(data: bytes, url: str) -> tuple[str | None, str | None]:
    raw = _manifest_bytes(data, url)
    if raw is None:
        return None, None
    try:
        manifest = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None, None
    if not isinstance(manifest, dict):
        return None, None
    plugin_id = manifest.get("id")
    version = manifest.get("version")
    return (
        plugin_id if isinstance(plugin_id, str) and plugin_id else None,
        version if isinstance(version, str) and version else None,
    )


def _manifest_bytes(data: bytes, url: str) -> bytes | None:
    path = urlsplit(url).path.lower()
    readers: tuple[Callable[[bytes], bytes | None], ...]
    if path.endswith(".zip"):
        readers = (_zip_manifest,)
    elif path.endswith((".tar.gz", ".tgz", ".tar")):
        readers = (_tar_manifest,)
    else:
        readers = (_tar_manifest, _zip_manifest)
    for reader in readers:
        try:
            raw = reader(data)
        except Exception:  # noqa: BLE001 — best-effort prefill, sha256 still returned
            continue
        if raw is not None:
            return raw
    return None


def _zip_manifest(data: bytes) -> bytes | None:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        name = _find_manifest_member(zf.namelist())
        if name is None:
            return None
        return zf.read(name)


def _tar_manifest(data: bytes) -> bytes | None:
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as tf:
        name = _find_manifest_member(tf.getnames())
        if name is None:
            return None
        member = tf.extractfile(name)
        if member is None:
            return None
        return member.read()


def _find_manifest_member(names: list[str]) -> str | None:
    entries: dict[str, str] = {}
    for original in names:
        norm = _normalize_member(original)
        if norm:
            entries.setdefault(norm, original)
    if _MANIFEST_NAME in entries:
        return entries[_MANIFEST_NAME]
    tops = {
        name.split("/", 1)[0]
        for name in entries
        if "/" in name and not name.split("/", 1)[0].startswith(".")
    }
    if len(tops) == 1:
        candidate = f"{next(iter(tops))}/{_MANIFEST_NAME}"
        return entries.get(candidate)
    return None


def _normalize_member(name: str) -> str:
    name = name.replace("\\", "/")
    while name.startswith("./"):
        name = name[2:]
    return name.rstrip("/")
