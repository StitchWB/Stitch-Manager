from __future__ import annotations

import json
from pathlib import Path

from autoreg.plugin import crypto

_MANIFEST = {"id": "demo-plugin", "version": "1.0.0"}


def _make_package(tmp_path: Path) -> Path:
    pkg = tmp_path / "demo-plugin" / "1.0.0"
    pkg.mkdir(parents=True)
    (pkg / "plugin.json").write_text(json.dumps(_MANIFEST), encoding="utf-8")
    (pkg / "scenario.json").write_text("{}", encoding="utf-8")
    return pkg


def _write_overlay(pkg: Path) -> None:
    (pkg / "selectors_overlay.json").write_text('{"selectors": []}', encoding="utf-8")
    (pkg / ".selectors_meta.json").write_text('{"etag": "abc"}', encoding="utf-8")


def test_overlay_files_do_not_change_package_hash(tmp_path: Path) -> None:
    pkg = _make_package(tmp_path)
    before = crypto.compute_package_hash(pkg)
    _write_overlay(pkg)
    assert crypto.compute_package_hash(pkg) == before


def test_nested_overlay_files_do_not_change_package_hash(tmp_path: Path) -> None:
    pkg = _make_package(tmp_path)
    before = crypto.compute_package_hash(pkg)
    nested = pkg / "contrib"
    nested.mkdir()
    (nested / "selectors_overlay.json").write_text("{}", encoding="utf-8")
    (nested / ".selectors_meta.json").write_text("{}", encoding="utf-8")
    assert crypto.compute_package_hash(pkg) == before


def test_verify_package_tolerates_overlay_files(tmp_path: Path) -> None:
    pkg = _make_package(tmp_path)
    private_pem, public_b64 = crypto.generate_keypair()
    signature = crypto.sign_package(pkg, private_pem)
    assert crypto.verify_package(pkg, signature, public_b64)
    _write_overlay(pkg)
    assert crypto.verify_package(pkg, signature, public_b64)


def test_pyc_files_do_not_change_package_hash(tmp_path: Path) -> None:
    pkg = _make_package(tmp_path)
    before = crypto.compute_package_hash(pkg)
    (pkg / "foo.pyc").write_bytes(b"compiled")
    cache = pkg / "__pycache__"
    cache.mkdir()
    (cache / "bar.cpython-312.pyc").write_bytes(b"compiled")
    assert crypto.compute_package_hash(pkg) == before


def test_verify_package_tolerates_pyc_files(tmp_path: Path) -> None:
    pkg = _make_package(tmp_path)
    private_pem, public_b64 = crypto.generate_keypair()
    signature = crypto.sign_package(pkg, private_pem)
    assert crypto.verify_package(pkg, signature, public_b64)
    (pkg / "foo.pyc").write_bytes(b"compiled")
    cache = pkg / "__pycache__"
    cache.mkdir()
    (cache / "bar.cpython-312.pyc").write_bytes(b"compiled")
    assert crypto.verify_package(pkg, signature, public_b64)


def test_added_non_bytecode_file_changes_package_hash(tmp_path: Path) -> None:
    pkg = _make_package(tmp_path)
    before = crypto.compute_package_hash(pkg)
    (pkg / "extra.py").write_text("x = 1\n", encoding="utf-8")
    assert crypto.compute_package_hash(pkg) != before


def test_added_content_file_changes_package_hash(tmp_path: Path) -> None:
    pkg = _make_package(tmp_path)
    before = crypto.compute_package_hash(pkg)
    (pkg / "extra.json").write_text("{}", encoding="utf-8")
    assert crypto.compute_package_hash(pkg) != before
