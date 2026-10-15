"""Snapshot third-party catalog sources into the controlled-org store.

``stitch_plugin_tools catalog-snapshot <catalog.json> --id <id> [--version V]
(--store-dir DIR | --repo OWNER/REPO)``

A catalog entry whose ``source`` points at a third-party remote is fragile:
the author can delete the repo and installs break.  This command fetches the
source NOW, stores an immutable tarball (local ``--store-dir`` for tests, or
a release asset in ``--repo``, default ``StitchWB/stitch-plugin-snapshots``),
and rewrites the entry to ``source = {type: release, url: <snapshot>, sha256}``
with the author's original source preserved under ``upstream``.
"""

from __future__ import annotations

import hashlib
import io
import json
import subprocess
import sys
import tarfile
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from .catalog_lint import _CONTROLLED_ORG_PREFIXES

DEFAULT_SNAPSHOT_REPO = "StitchWB/stitch-plugin-snapshots"


def _snapshot_url(plugin_id: str, version: str) -> str:
    name = _asset_name(plugin_id, version)
    return (
        f"https://github.com/{DEFAULT_SNAPSHOT_REPO}/releases/download/"
        f"snap-{plugin_id}-{version}/{name}"
    )


def _asset_name(plugin_id: str, version: str) -> str:
    return f"{plugin_id}-{version}.tar.gz"


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _is_controlled(url: str) -> bool:
    return url.startswith(_CONTROLLED_ORG_PREFIXES)


def _fetch_git_tarball(url: str, ref: str | None) -> bytes:
    with tempfile.TemporaryDirectory(prefix="catalog-snapshot-") as tmp:
        clone = Path(tmp) / "src"
        cmd = ["git", "clone", "--depth", "1"]
        if ref:
            cmd += ["--branch", ref]
        cmd += [url, str(clone)]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if proc.returncode != 0:
            raise RuntimeError(f"git clone failed: {proc.stderr.strip()[:300]}")
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for item in sorted(clone.iterdir(), key=lambda p: p.name):
                if item.name == ".git":
                    continue
                tar.add(item, arcname=item.name)
        return buf.getvalue()


def _fetch_release_bytes(url: str, expected_sha: str | None) -> bytes:
    with httpx.Client(timeout=120.0, follow_redirects=True) as client:
        response = client.get(url)
        response.raise_for_status()
        data = response.content
    if expected_sha and _sha256_bytes(data) != expected_sha:
        raise RuntimeError("upstream release sha256 mismatch vs catalog entry")
    return data


def _store_artifact(
    data: bytes, plugin_id: str, version: str, store_dir: Path | None, repo: str | None
) -> None:
    name = _asset_name(plugin_id, version)
    if store_dir is not None:
        store_dir.mkdir(parents=True, exist_ok=True)
        (store_dir / name).write_bytes(data)
        return
    target = repo or DEFAULT_SNAPSHOT_REPO
    tag = f"snap-{plugin_id}-{version}"
    with tempfile.TemporaryDirectory(prefix="catalog-snapshot-") as tmp:
        asset = Path(tmp) / name
        asset.write_bytes(data)
        proc = subprocess.run(
            [
                "gh", "release", "create", tag, str(asset),
                "--repo", target,
                "--title", tag,
                "--notes", f"Snapshot of community plugin {plugin_id}@{version}",
            ],
            capture_output=True,
            text=True,
            timeout=300,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"gh release upload failed: {proc.stderr.strip()[:300]}")


def snapshot_entry(
    entry: dict[str, Any],
    *,
    store_dir: Path | None = None,
    repo: str | None = None,
) -> tuple[dict[str, Any], str]:
    """Snapshot one entry's third-party source; return (new_entry, report)."""
    source = entry.get("source")
    if not isinstance(source, dict):
        return entry, f"{entry.get('id')}: no source field — skipped"
    url = str(source.get("url") or "")
    if _is_controlled(url) and entry.get("upstream") is None:
        return entry, f"{entry.get('id')}: source already controlled-org — skipped"
    plugin_id = str(entry.get("id"))
    version = str(entry.get("version"))
    stype = source.get("type")
    if stype == "git":
        data = _fetch_git_tarball(url, source.get("ref"))
    elif stype == "release":
        data = _fetch_release_bytes(url, source.get("sha256"))
    else:
        return entry, f"{plugin_id}: unknown source type {stype!r} — skipped"
    sha = _sha256_bytes(data)
    _store_artifact(data, plugin_id, version, store_dir, repo)
    new_entry = dict(entry)
    new_entry["source"] = {"type": "release", "url": _snapshot_url(plugin_id, version), "sha256": sha}
    new_entry["upstream"] = source
    report = f"{plugin_id}@{version}: snapshot {sha[:12]}… stored, entry rewritten"
    return new_entry, report


def snapshot_catalog(
    catalog_path: str | Path,
    *,
    targets: list[tuple[str, str | None]] | None = None,
    store_dir: Path | None = None,
    repo: str | None = None,
) -> int:
    """Rewrite catalog entries in place; return exit code (0 ok, 1 error)."""
    path = Path(catalog_path)
    catalog = json.loads(path.read_text(encoding="utf-8"))
    plugins = catalog.get("plugins")
    if not isinstance(plugins, list):
        print("catalog has no plugins list", file=sys.stderr)
        return 1
    changed = False
    for idx, entry in enumerate(plugins):
        if not isinstance(entry, dict):
            continue
        eid, ever = str(entry.get("id")), str(entry.get("version"))
        if targets and not any(
            eid == tid and (tver is None or ever == tver) for tid, tver in targets
        ):
            continue
        new_entry, report = snapshot_entry(entry, store_dir=store_dir, repo=repo)
        print(report)
        if new_entry is not entry:
            plugins[idx] = new_entry
            changed = True
    if changed:
        catalog["updated_at"] = datetime.now(UTC).isoformat()
        path.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    return 0
