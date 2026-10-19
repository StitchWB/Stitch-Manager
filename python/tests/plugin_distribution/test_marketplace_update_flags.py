"""Marketplace update-semantics tests: update_available / dev_shadow flags.

Covers:
    - official item: catalog newer than signed installed → update_available True
    - official item: equal versions → False
    - official item: installed newer than catalog → False (no downgrade prompt)
    - cache version with invalid/empty signature is not counted as installed
    - guest (unactivated) official path carries the same flags
    - dev merge: shadowed official row → dev_shadow True, update_available False
    - dev merge: local-only row → dev_shadow True, update_available False
    - community items always carry update_available/dev_shadow False
    - list_installed_versions(signed_only=True) filter semantics
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import pytest

from autoreg.plugin import crypto

if TYPE_CHECKING:
    from pathlib import Path


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setenv("STITCH_PLUGINS_DIR", str(tmp_path))
    monkeypatch.setenv("STITCH_SERVER_URL", "http://testserver.invalid")
    monkeypatch.setenv("STITCH_AUTH_ENABLED", "0")
    monkeypatch.delenv("STITCH_DEV_MODE", raising=False)
    monkeypatch.delenv("STITCH_PLUGIN_PUBKEY", raising=False)

    from stitch_backend.config import get_settings
    from stitch_backend.domains.plugin_distribution.marketplace_commands import (
        _clear_feed_cache,
    )

    get_settings.cache_clear()
    _clear_feed_cache()
    yield
    get_settings.cache_clear()
    _clear_feed_cache()




def _write_activation(tmp_path: Path) -> None:
    (tmp_path / ".activation").write_text(
        json.dumps(
            {
                "token": "test-token",
                "pubkey": "test-pubkey",
                "entitlements": ["*"],
                "server_url": "http://testserver.invalid",
                "last_server_time": "",
                "degraded": False,
                "last_successful_heartbeat": "",
            }
        ),
        encoding="utf-8",
    )


def _make_cache_pkg(
    tmp_path: Path,
    plugin_id: str,
    version: str,
    *,
    priv_pem: bytes | None = None,
    signature: str | None = None,
) -> Path:
    """Create a cache package dir; sign it when ``priv_pem``/``signature`` given."""
    pkg = tmp_path / "plugins" / plugin_id / version
    pkg.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schema": "stitch.plugin/v1",
        "id": plugin_id,
        "name": plugin_id,
        "version": version,
        "service": plugin_id,
        "kind": "data",
        "engine": {"min": "2026.08", "api": 1},
        "depends": [],
        "entry": {
            "scenario": "scenario.json",
            "selectors": "selectors.json",
            "profile": "profile.json",
        },
        "capabilities": [],
        "outputs": [],
        "signature": "",
    }
    (pkg / "plugin.json").write_text(json.dumps(manifest), encoding="utf-8")
    (pkg / "scenario.json").write_text("{}", encoding="utf-8")
    if priv_pem is not None:
        crypto.write_signature(pkg, crypto.sign_package(pkg, priv_pem))
    elif signature is not None:
        crypto.write_signature(pkg, signature)
    return pkg


def _patch_feeds(
    monkeypatch: pytest.MonkeyPatch,
    *,
    manifest_plugins: tuple[dict[str, Any], ...] = (),
    catalog_plugins: tuple[dict[str, Any], ...] = (),
    public_plugins: tuple[dict[str, Any], ...] = (),
) -> None:
    from stitch_backend.domains.plugin_distribution import marketplace_commands

    async def _manifest(activation: Any, token: str) -> dict:
        return {"plugins": list(manifest_plugins)}

    async def _catalog() -> dict:
        return {"plugins": list(catalog_plugins)}

    async def _public(activation: Any) -> dict:
        return {"plugins": list(public_plugins)}

    async def _tiers(plugin_ids: list[str]) -> dict:
        return {}

    monkeypatch.setattr(marketplace_commands, "_fetch_manifest_cached", _manifest)
    monkeypatch.setattr(marketplace_commands, "_fetch_catalog_cached", _catalog)
    monkeypatch.setattr(
        marketplace_commands, "_fetch_public_catalog_cached", _public
    )
    monkeypatch.setattr(marketplace_commands, "get_required_tiers", _tiers)


def _write_local_service_package(
    tmp_path: Path, plugin_id: str, version: str = "0.1.0"
) -> None:
    """Dev link-install: worktree package + .stitch-link pointer in plugins-local."""
    from autoreg.plugin.layout import LINK_FILENAME

    module = plugin_id.replace("-", "_")
    src = tmp_path / "worktree" / plugin_id
    (src / module).mkdir(parents=True)
    manifest = {
        "schema": "stitch.plugin/v2",
        "id": plugin_id,
        "name": plugin_id,
        "version": version,
        "service": plugin_id,
        "kind": "service",
        "engine": {"min": "0.3.0", "api": 2},
        "depends": [],
        "entry": {"module": module},
        "capabilities": [],
        "outputs": [],
        "signature": "",
    }
    (src / "plugin.json").write_text(json.dumps(manifest), encoding="utf-8")
    link_dir = tmp_path / "plugins-local" / plugin_id
    link_dir.mkdir(parents=True)
    (link_dir / LINK_FILENAME).write_text(str(src), encoding="utf-8")


async def _get_marketplace() -> dict:
    from stitch_backend.domains.plugin_distribution.marketplace_commands import (
        cmd_get_marketplace,
    )

    return await cmd_get_marketplace({})


def _official_items(result: dict) -> list[dict]:
    return [i for i in result["items"] if i["source"] == "official"]




async def test_update_available_when_catalog_newer(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _write_activation(tmp_path)
    priv, pub = crypto.generate_keypair()
    monkeypatch.setenv("STITCH_PLUGIN_PUBKEY", pub)
    _make_cache_pkg(tmp_path, "kiro-autoreg", "1.0.0", priv_pem=priv)
    _patch_feeds(
        monkeypatch,
        manifest_plugins=({"id": "kiro-autoreg", "version": "2.0.0"},),
        catalog_plugins=({"id": "comm-plugin", "version": "1.0.0"},),
    )

    result = await _get_marketplace()
    item = _official_items(result)[0]
    assert item["installed"] is True
    assert item["installed_version"] == "1.0.0"
    assert item["update_available"] is True
    assert item["dev_shadow"] is False

    comm = [i for i in result["items"] if i["source"] == "community"][0]
    assert comm["update_available"] is False
    assert comm["dev_shadow"] is False


async def test_no_update_when_versions_equal(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _write_activation(tmp_path)
    priv, pub = crypto.generate_keypair()
    monkeypatch.setenv("STITCH_PLUGIN_PUBKEY", pub)
    _make_cache_pkg(tmp_path, "kiro-autoreg", "1.0.0", priv_pem=priv)
    _patch_feeds(
        monkeypatch,
        manifest_plugins=({"id": "kiro-autoreg", "version": "1.0.0"},),
    )

    item = _official_items(await _get_marketplace())[0]
    assert item["installed"] is True
    assert item["installed_version"] == "1.0.0"
    assert item["update_available"] is False


async def test_no_update_when_installed_newer(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Downgrade bug: installed newer than catalog must not offer an update."""
    _write_activation(tmp_path)
    priv, pub = crypto.generate_keypair()
    monkeypatch.setenv("STITCH_PLUGIN_PUBKEY", pub)
    _make_cache_pkg(tmp_path, "kiro-autoreg", "3.0.0", priv_pem=priv)
    _patch_feeds(
        monkeypatch,
        manifest_plugins=({"id": "kiro-autoreg", "version": "2.0.0"},),
    )

    item = _official_items(await _get_marketplace())[0]
    assert item["installed"] is True
    assert item["installed_version"] == "3.0.0"
    assert item["update_available"] is False


async def test_invalid_signature_not_counted_installed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Cache dirs with empty or non-verifying signatures are not 'installed'."""
    _write_activation(tmp_path)
    priv, pub = crypto.generate_keypair()
    _other_priv, _ = crypto.generate_keypair()
    monkeypatch.setenv("STITCH_PLUGIN_PUBKEY", pub)
    _make_cache_pkg(tmp_path, "kiro-autoreg", "1.0.0")  # unsigned
    _make_cache_pkg(  # signed by a foreign key → verification fails
        tmp_path, "kiro-autoreg", "1.5.0", priv_pem=_other_priv
    )
    _patch_feeds(
        monkeypatch,
        manifest_plugins=({"id": "kiro-autoreg", "version": "2.0.0"},),
    )

    item = _official_items(await _get_marketplace())[0]
    assert item["installed"] is False
    assert item["installed_version"] is None
    assert item["update_available"] is False


async def test_guest_official_flags(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Unactivated (guest) official rows carry the same flag semantics."""
    priv, pub = crypto.generate_keypair()
    monkeypatch.setenv("STITCH_PLUGIN_PUBKEY", pub)
    _make_cache_pkg(tmp_path, "kiro-autoreg", "1.0.0", priv_pem=priv)
    _patch_feeds(
        monkeypatch,
        public_plugins=(
            {"id": "kiro-autoreg", "name": "Kiro", "version": "2.0.0"},
        ),
    )

    result = await _get_marketplace()
    assert result["activated"] is False
    item = _official_items(result)[0]
    assert item["installed"] is True
    assert item["installed_version"] == "1.0.0"
    assert item["update_available"] is True
    assert item["dev_shadow"] is False




async def test_dev_merge_shadows_official_row(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Local dev manifest overwrites the official row: shadowed, no update."""
    _write_activation(tmp_path)
    monkeypatch.setenv("STITCH_DEV_MODE", "1")
    priv, pub = crypto.generate_keypair()
    monkeypatch.setenv("STITCH_PLUGIN_PUBKEY", pub)
    _make_cache_pkg(tmp_path, "stitch-demo", "1.0.0", priv_pem=priv)
    _write_local_service_package(tmp_path, "stitch-demo", "0.1.0")
    _patch_feeds(
        monkeypatch,
        manifest_plugins=({"id": "stitch-demo", "version": "2.0.0"},),
    )

    result = await _get_marketplace()
    rows = [i for i in result["items"] if i["id"] == "stitch-demo"]
    assert len(rows) == 1
    item = rows[0]
    assert item["dev_shadow"] is True
    assert item["update_available"] is False
    assert item["installed"] is True
    assert item["installed_version"] == "0.1.0"


async def test_dev_local_only_row_flags(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Dev-only plugin (not in any feed) → source local, shadowed, no update."""
    monkeypatch.setenv("STITCH_DEV_MODE", "1")
    _write_local_service_package(tmp_path, "stitch-demo", "0.1.0")
    _patch_feeds(monkeypatch)

    result = await _get_marketplace()
    rows = [i for i in result["items"] if i["id"] == "stitch-demo"]
    assert len(rows) == 1
    item = rows[0]
    assert item["source"] == "local"
    assert item["dev_shadow"] is True
    assert item["update_available"] is False
    assert item["installed"] is True
    assert item["installed_version"] == "0.1.0"




def test_list_installed_versions_signed_only(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from autoreg.plugin.install import list_installed_versions

    priv, pub = crypto.generate_keypair()
    _make_cache_pkg(tmp_path, "engine-pack", "2.0.0", priv_pem=priv)
    _make_cache_pkg(tmp_path, "engine-pack", "2.1.0")  # unsigned
    _make_cache_pkg(tmp_path, "engine-pack", "2.2.0", signature="ed25519:broken")

    assert list_installed_versions("engine-pack") == ["2.0.0", "2.1.0", "2.2.0"]
    assert list_installed_versions(
        "engine-pack", signed_only=True, public_key_b64=pub
    ) == ["2.0.0"]
    assert list_installed_versions("engine-pack", signed_only=True) == [
        "2.0.0",
        "2.1.0",
        "2.2.0",
    ]


def test_dedup_by_id_keeps_first_feed_occurrence() -> None:
    from stitch_backend.domains.plugin_distribution.marketplace_commands import (
        _dedup_by_id,
    )

    items = [
        {"id": "stitch-devbox", "version": "0.2.6", "source": "official"},
        {"id": "stitch-devbox", "version": "0.2.6", "source": "community"},
        {"id": "stitch-devbox", "version": "0.2.6", "source": "community"},
        {"id": "stitch-mail", "version": "2.0.0", "source": "official"},
    ]
    out = _dedup_by_id(items)
    assert [i["id"] for i in out] == ["stitch-devbox", "stitch-mail"]
    assert out[0]["source"] == "official"
