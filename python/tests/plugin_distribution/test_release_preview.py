from __future__ import annotations

import hashlib
import io
import json
import tarfile
import zipfile
from typing import TYPE_CHECKING, Any

import httpx

from stitch_backend.domains.plugin_distribution import release_preview
from stitch_backend.domains.plugin_distribution.release_preview import (
    cmd_preview_release,
)

if TYPE_CHECKING:
    from collections.abc import Callable

    import pytest

_MANIFEST = {"id": "demo-plugin", "version": "1.4.2"}


def _zip_bytes(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buf.getvalue()


def _tar_gz_bytes(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for name, content in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(content.encode("utf-8"))
            tf.addfile(info, io.BytesIO(content.encode("utf-8")))
    return buf.getvalue()


def _patch_transport(
    monkeypatch: pytest.MonkeyPatch,
    handler: Callable[[httpx.Request], httpx.Response],
) -> None:
    class _MockClient(httpx.AsyncClient):
        def __init__(self, **kwargs: Any) -> None:
            super().__init__(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", _MockClient)


async def test_zip_sha256_and_manifest_prefill(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = _zip_bytes(
        {"plugin.json": json.dumps(_MANIFEST), "scenario.json": "{}"}
    )
    _patch_transport(
        monkeypatch, lambda request: httpx.Response(200, content=data)
    )

    result = await cmd_preview_release({"url": "https://example.com/pkg.zip"})

    assert result == {
        "success": True,
        "sha256": hashlib.sha256(data).hexdigest(),
        "manifest_id": "demo-plugin",
        "manifest_version": "1.4.2",
    }


async def test_tar_gz_wrapper_dir_manifest_prefill(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = _tar_gz_bytes(
        {
            "demo-plugin-1.4.2/plugin.json": json.dumps(_MANIFEST),
            "demo-plugin-1.4.2/scenario.json": "{}",
        }
    )
    _patch_transport(
        monkeypatch, lambda request: httpx.Response(200, content=data)
    )

    result = await cmd_preview_release({"url": "https://example.com/v1.4.2.tar.gz"})

    assert result["success"] is True
    assert result["sha256"] == hashlib.sha256(data).hexdigest()
    assert result["manifest_id"] == "demo-plugin"
    assert result["manifest_version"] == "1.4.2"


async def test_manifest_nulls_when_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = _zip_bytes({"scenario.json": "{}"})
    _patch_transport(
        monkeypatch, lambda request: httpx.Response(200, content=data)
    )

    result = await cmd_preview_release({"url": "https://example.com/pkg.zip"})

    assert result["success"] is True
    assert result["sha256"] == hashlib.sha256(data).hexdigest()
    assert result["manifest_id"] is None
    assert result["manifest_version"] is None


async def test_http_scheme_rejected() -> None:
    result = await cmd_preview_release({"url": "http://example.com/pkg.zip"})

    assert result["success"] is False
    assert "https" in result["error"]


async def test_oversize_body_capped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(release_preview, "_MAX_BYTES", 16)
    _patch_transport(
        monkeypatch, lambda request: httpx.Response(200, content=b"x" * 64)
    )

    result = await cmd_preview_release({"url": "https://example.com/pkg.zip"})

    assert result["success"] is False
    assert "exceeds" in result["error"]


async def test_network_error_readable(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom")

    _patch_transport(monkeypatch, handler)

    result = await cmd_preview_release({"url": "https://example.com/pkg.zip"})

    assert result["success"] is False
    assert "network" in result["error"]
