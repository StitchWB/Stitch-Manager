"""Plugin sync service — manifest fetch + anti-replay + canary + install.

Implements plan §3.1 item 2 (canary + kill-switch + LKG) and §3.2 item 6
(anti-replay / anti-downgrade).  Uses ``autoreg.plugin.install`` for atomic
installation with signature verification and version monotonicity.

v1.1 SELECTOR-PACK channel (plan §8): after the install/skip-current
decision, the manifest's ``selectors_version`` for each plugin entry is
compared against the locally stored overlay meta.  When the server has a
newer pack, it is downloaded, sha256-verified, and atomic-written into
``<plugin cache dir>/<version>/selectors_overlay.json`` (+ ``.meta.json``).
Monotonic: a downgrade attempt is warned + skipped (the old overlay stays).
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import shutil
import tempfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx

from autoreg.plugin.install import install_package, list_installed_versions
from autoreg.plugin.layout import plugin_cache_path
from autoreg.plugin.manifest import parse_semver

from .config import server_url

if TYPE_CHECKING:
    from .activation import ActivationService

logger = logging.getLogger(__name__)


class ManifestReplayError(Exception):
    """Raised when a manifest's server_time is not newer than the last seen."""


@dataclass
class SyncReport:
    """Result of a sync run — lists updated / skipped / rolled_back / errors."""

    updated: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    rolled_back: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


# ── Selector overlay file names (plan §8) ─────────────────────────────────────

_OVERLAY_FILENAME = "selectors_overlay.json"
_OVERLAY_META_FILENAME = ".selectors_meta.json"


class PluginSyncService:
    """Fetch manifest and sync plugins to the local cache."""

    def __init__(
        self,
        activation: ActivationService,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._activation = activation
        self._client = client

    def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=60.0)
        return self._client

    async def fetch_manifest(self, token: str) -> dict:
        """GET /manifest with anti-replay (plan §3.2 item 6).

        Rejects manifests whose server_time is <= last seen.
        Updates last_server_time on accept.
        """
        url = f"{server_url()}/manifest"
        client = self._ensure_client()
        resp = await client.get(url, headers={"Authorization": f"Bearer {token}"})
        resp.raise_for_status()
        body: dict[str, Any] = resp.json()

        server_time = body.get("server_time", "")
        state = self._activation.load()
        last = state.last_server_time if state else ""

        if last and server_time and server_time <= last:
            raise ManifestReplayError(
                f"server_time {server_time} <= last seen {last}"
            )

        if state is not None and server_time:
            self._activation.set_last_server_time(server_time)

        return body

    async def sync(self) -> SyncReport:
        """Sync all plugins from the manifest to the local cache."""
        report = SyncReport()
        state = self._activation.load()
        if state is None:
            report.errors.append("not activated")
            return report
        if state.degraded:
            logger.info("Sync skipped — degraded mode (revoked token)")
            return report

        try:
            manifest = await self.fetch_manifest(state.token)
        except ManifestReplayError as exc:
            report.errors.append(f"manifest replay: {exc}")
            return report
        except httpx.HTTPError as exc:
            report.errors.append(f"manifest fetch: {exc}")
            return report

        for entry in manifest.get("plugins", []):
            plugin_id = entry["id"]
            version = entry["version"]
            rollout = entry.get("rollout_percent", 100)
            deprecated = entry.get("deprecated", [])

            try:
                if not _in_canary_cohort(state.token, rollout):
                    report.skipped.append(f"{plugin_id}@{version} (canary)")
                    continue

                installed = list_installed_versions(plugin_id)
                _handle_deprecation(plugin_id, installed, deprecated, report)

                if _matches_any_spec(version, deprecated):
                    report.skipped.append(f"{plugin_id}@{version} (deprecated)")
                    continue

                installed = list_installed_versions(plugin_id)
                if version in installed:
                    report.skipped.append(f"{plugin_id}@{version} (current)")
                    # Overlay sync still runs for already-installed versions
                    # (hot selector updates land without a plugin bump).
                    await self._sync_selector_overlay(
                        plugin_id, version, entry, state.token, report
                    )
                    continue

                if _is_older(version, installed):
                    report.skipped.append(f"{plugin_id}@{version} (older)")
                    continue

                await self._download_and_install(
                    plugin_id, version, state.token, state.pubkey
                )
                report.updated.append(f"{plugin_id}@{version}")
                # Fresh install — also pull the latest overlay if the manifest
                # advertises one.
                await self._sync_selector_overlay(
                    plugin_id, version, entry, state.token, report
                )
            except Exception as exc:  # noqa: BLE001 — per-plugin error isolation
                report.errors.append(f"{plugin_id}@{version}: {exc}")
                logger.warning("Sync failed for %s@%s: %s", plugin_id, version, exc)

        return report

    async def _download_and_install(
        self, plugin_id: str, version: str, token: str, pubkey: str
    ) -> None:
        """Download zip, unzip to temp dir, install via autoreg.plugin.install."""
        url = f"{server_url()}/plugins/{plugin_id}/{version}"
        client = self._ensure_client()
        resp = await client.get(url, headers={"Authorization": f"Bearer {token}"})
        resp.raise_for_status()

        tmp_dir = Path(tempfile.mkdtemp(prefix="stitch-sync-"))
        try:
            with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
                zf.extractall(tmp_dir)
            install_package(tmp_dir, public_key_b64=pubkey)
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    # ── Selector overlay sync (plan §8) ──────────────────────────────────────

    async def _sync_selector_overlay(
        self,
        plugin_id: str,
        version: str,
        manifest_entry: dict[str, Any],
        token: str,
        report: SyncReport,
    ) -> None:
        """Download a newer selector overlay pack if the manifest advertises one.

        Monotonic: never downgrade.  On a downgrade attempt (manifest version
        < local version) the old overlay is kept and a warning is logged.
        Sha256 mismatch on the downloaded pack → keep the old overlay + warn.
        """
        remote_version = int(manifest_entry.get("selectors_version", 0) or 0)
        remote_sha = str(manifest_entry.get("selectors_sha256", "") or "")

        # No overlay published for this plugin@version — nothing to do.
        if remote_version <= 0:
            return

        pkg_dir = plugin_cache_path(plugin_id, version)
        if not pkg_dir.is_dir():
            # Plugin not installed (e.g. canary-skipped) — cannot place overlay.
            return

        local_version = _read_local_overlay_version(pkg_dir)

        # Monotonic: skip downgrade.
        if local_version >= remote_version:
            logger.info(
                "selector overlay %s@%s: local v%d >= remote v%d — skip",
                plugin_id, version, local_version, remote_version,
            )
            return

        # Download the pack.
        url = (
            f"{server_url()}/plugins/{plugin_id}/{version}"
            f"/selectors/{remote_version}"
        )
        client = self._ensure_client()
        resp = await client.get(url, headers={"Authorization": f"Bearer {token}"})
        if resp.status_code == 404:
            # Pack was deleted server-side between manifest + fetch — not an
            # error, just nothing to apply.
            logger.info(
                "selector overlay %s@%s v%d not found on server — skip",
                plugin_id, version, remote_version,
            )
            return
        resp.raise_for_status()
        body = resp.json()

        # Verify sha256 (defend against transport corruption / server bug).
        actual_sha = _canonical_selectors_sha(body.get("selectors", {}))
        if actual_sha != remote_sha:
            logger.warning(
                "selector overlay %s@%s v%d sha256 mismatch "
                "(expected %s, got %s) — keep old overlay",
                plugin_id, version, remote_version, remote_sha, actual_sha,
            )
            report.errors.append(
                f"{plugin_id}@{version}: selector overlay sha256 mismatch"
            )
            return

        # Atomic-write overlay + meta.
        _atomic_write_overlay(pkg_dir, body.get("selectors", {}), remote_version)
        logger.info(
            "selector overlay %s@%s updated to v%d",
            plugin_id, version, remote_version,
        )


def _read_local_overlay_version(pkg_dir: Path) -> int:
    """Read the locally stored selectors_version for a package dir (0 if none)."""
    meta_path = pkg_dir / _OVERLAY_META_FILENAME
    if not meta_path.is_file():
        return 0
    try:
        raw = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return 0
    if not isinstance(raw, dict):
        return 0
    try:
        return int(raw.get("selectors_version", 0))
    except (TypeError, ValueError):
        return 0


def _canonical_selectors_sha(selectors: dict[str, Any]) -> str:
    """sha256 of the canonical-JSON encoding of the selectors payload.

    Mirrors the server's ``selectors._canonical_sha256`` so client + server
    agree on the hash of the same payload.
    """
    canonical = json.dumps(selectors, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _atomic_write_overlay(
    pkg_dir: Path, selectors: dict[str, Any], selectors_version: int
) -> None:
    """Atomic-write the overlay + meta files into ``pkg_dir``.

    Writes to a temp file in the same directory, then ``os.replace`` (atomic
    on both POSIX + Windows for files).  The meta file is written first so
    a crash between the two leaves an old meta pointing at a not-yet-written
    overlay — the next sync re-downloads (idempotent).
    """
    overlay_path = pkg_dir / _OVERLAY_FILENAME
    meta_path = pkg_dir / _OVERLAY_META_FILENAME

    overlay_text = json.dumps(selectors, ensure_ascii=False, indent=2) + "\n"
    meta_text = json.dumps({"selectors_version": selectors_version}) + "\n"

    # Meta first (crash-safe: old meta + old overlay is consistent).
    _atomic_write_text(meta_path, meta_text)
    _atomic_write_text(overlay_path, overlay_text)


def _atomic_write_text(path: Path, text: str) -> None:
    """Write ``text`` to ``path`` atomically (temp file + os.replace)."""
    tmp = path.with_suffix(path.suffix + f".tmp.{os.getpid()}")
    try:
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


# ── Cohort + version helpers ─────────────────────────────────────────────────


def _in_canary_cohort(token: str, rollout_percent: int) -> bool:
    """Client-side cohort selection (plan §3.1 item 2).

    cohort = sha256(token) % 100 < rollout_percent
    """
    if rollout_percent >= 100:
        return True
    if rollout_percent <= 0:
        return False
    cohort = int(hashlib.sha256(token.encode("utf-8")).hexdigest(), 16) % 100
    return cohort < rollout_percent


def _is_older(version: str, installed: list[str]) -> bool:
    """True if ``version`` is older than the newest installed version."""
    if not installed:
        return False
    newest = max(installed, key=lambda v: parse_semver(v))
    try:
        return parse_semver(version) < parse_semver(newest)
    except ValueError:
        return True


def _handle_deprecation(
    plugin_id: str,
    installed: list[str],
    deprecated_specs: list[str],
    report: SyncReport,
) -> None:
    """Kill-switch: remove deprecated installed versions (plan §3.1 item 2).

    If an installed version matches a deprecation spec, delete it from the
    cache so the loader falls back to the next-newest non-deprecated version
    (last-known-good).
    """
    if not deprecated_specs or not installed:
        return

    for ver in list(installed):
        if _matches_any_spec(ver, deprecated_specs):
            ver_dir = plugin_cache_path(plugin_id, ver)
            if ver_dir.is_dir():
                shutil.rmtree(ver_dir, ignore_errors=True)
                report.rolled_back.append(f"{plugin_id}@{ver}")
                logger.info("Rolled back deprecated %s@%s", plugin_id, ver)


def _matches_any_spec(version: str, specs: list[str]) -> bool:
    """Check if ``version`` matches any deprecation spec."""
    return any(_matches_spec(version, spec) for spec in specs)


def _matches_spec(version: str, spec: str) -> bool:
    """Match a version against a spec like ``<=1.2.3``, ``<1.2.3``, etc."""
    spec = spec.strip()
    try:
        v = parse_semver(version)
    except ValueError:
        return False

    for prefix, cmp in (
        ("<=", lambda a, b: a <= b),
        (">=", lambda a, b: a >= b),
        ("==", lambda a, b: a == b),
        ("<", lambda a, b: a < b),
        (">", lambda a, b: a > b),
    ):
        if spec.startswith(prefix):
            target = spec[len(prefix):].strip()
            try:
                t = parse_semver(target)
            except ValueError:
                return False
            return bool(cmp(v, t))

    # Bare version = exact match
    try:
        return v == parse_semver(spec)
    except ValueError:
        return False
