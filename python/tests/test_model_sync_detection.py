"""Detection regressions: Windows shims, dual binaries, sqlite credential probe."""

from __future__ import annotations

import json
import sqlite3
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from pathlib import Path

from stitch_backend.domains.ai_proxy.model_sync import detection


def test_windows_cmd_shim_is_probeable(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    extensionless = tmp_path / "opencode2"
    extensionless.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    cmd = tmp_path / "opencode2.cmd"
    cmd.write_text("@echo off\r\n", encoding="utf-8")

    monkeypatch.setattr(detection.os, "name", "nt")
    monkeypatch.setattr(
        detection.shutil,
        "which",
        lambda name: str(extensionless) if name == "opencode2" else None,
    )

    seen: list[Path] = []

    def fake_run(binary: Path, timeout: float) -> str | None:
        seen.append(binary)
        return "opencode2 2.0.22" if binary == cmd else None

    monkeypatch.setattr(detection, "_run_version_probe", fake_run)
    probed = detection._probe_one_opencode_binary("opencode2", 0.1)
    assert probed is not None
    assert probed["version"] == "2.0.22"
    assert probed["schema"] == "v2"
    assert probed["path"] == str(cmd)
    assert cmd in seen


def _install_desktop_cli_fixture(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Path:
    appdata = tmp_path / "Roaming"
    cli = appdata / "ai.opencode.desktop" / "cli" / "2.4.1-x64" / "opencode-cli.exe"
    cli.parent.mkdir(parents=True)
    cli.write_text("fake desktop cli placeholder", encoding="utf-8")
    monkeypatch.setenv("APPDATA", str(appdata))
    monkeypatch.setattr(detection.shutil, "which", lambda _name: None)

    def fake_run(binary: Path, timeout: float) -> str | None:
        return "opencode v2.4.1" if binary == cli else None

    monkeypatch.setattr(detection, "_run_version_probe", fake_run)
    return cli


def test_desktop_bundled_opencode_cli_is_probeable_as_v2(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    cli = _install_desktop_cli_fixture(tmp_path, monkeypatch)

    probed = detection._probe_one_opencode_binary("opencode2", 0.1)

    assert probed is not None
    assert probed["version"] == "2.4.1"
    assert probed["schema"] == "v2"
    assert probed["path"] == str(cli)


def test_real_world_v2_config_layout_and_desktop_cli_detected(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    cli = _install_desktop_cli_fixture(tmp_path, monkeypatch)
    config_dir = tmp_path / "home" / ".config" / "opencode"
    config_dir.mkdir(parents=True)
    (config_dir / "opencode.json").write_text(
        json.dumps({
            "$schema": "https://opencode.ai/config.json",
            "providers": {},
            "agents": {},
        }),
        encoding="utf-8",
    )
    (config_dir / "cli.json").write_text("{}", encoding="utf-8")

    result = detection.detect_opencode_version(
        config_dir,
        binary_probe=lambda: detection.probe_opencode_binaries(0.1),
    )

    assert result["version"] == "v2"
    assert result["source"] == "binary"
    assert result["binary"] == "opencode2"
    assert result["binaries"]["opencode2"]["path"] == str(cli)


def test_both_binaries_reported_and_v2_wins(tmp_path: Path) -> None:
    binaries = {
        "opencode": {"version": "1.19.4", "schema": "v1", "path": "x", "raw": "1.19.4"},
        "opencode2": {"version": "2.0.22", "schema": "v2", "path": "y", "raw": "2.0.22"},
    }
    result = detection.detect_opencode_version(tmp_path, binary_probe=lambda: binaries)
    assert result["version"] == "v2"
    assert result["source"] == "binary"
    assert result["binary"] == "opencode2"
    assert result["binaries"]["opencode"]["version"] == "1.19.4"
    assert result["binaries"]["opencode2"]["version"] == "2.0.22"


def test_cli_json_v2_beats_v1_binary(tmp_path: Path) -> None:
    (tmp_path / "cli.json").write_text("{}", encoding="utf-8")
    binaries = {
        "opencode": {"version": "1.19.4", "schema": "v1", "path": "x", "raw": "1.19.4"},
        "opencode2": None,
    }
    result = detection.detect_opencode_version(tmp_path, binary_probe=lambda: binaries)
    assert result["version"] == "v2"
    assert result["source"] == "cli.json"


def _fixture_db(path: Path, *, integration_column: str) -> None:
    conn = sqlite3.connect(path)
    conn.execute(
        f'create table credential (id text, "{integration_column}" text, label text, '
        "active integer, time_created integer, value text)"
    )
    rows = [
        ("cred-inactive", "stitch", "old", 0, 3, {"type": "key", "key": "inactive-secret"}),
        ("cred-active", "stitch", "current", 1, 1, {"type": "key", "key": "active-secret"}),
        ("cred-other", "other", "other", 1, 4, {"type": "key", "key": "other-secret"}),
    ]
    for row in rows:
        conn.execute(
            "insert into credential values (?,?,?,?,?,?)",
            (*row[:5], json.dumps(row[5])),
        )
    conn.commit()
    conn.close()


@pytest.mark.parametrize("integration_column", ["integrationID", "integration_id"])
def test_credential_probe_fixture_db_active_order_and_no_secret(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, integration_column: str
) -> None:
    db = tmp_path / "opencode.db"
    _fixture_db(db, integration_column=integration_column)
    monkeypatch.setenv("OPENCODE_DB", str(db))
    monkeypatch.setattr(detection, "probe_opencode_db_path", lambda timeout=4.0: None)

    result = detection.check_stitch_credential("active-secret")
    assert result["status"] == "credential-match"
    assert result["credentialId"] == "cred-active"
    assert result["active"] is True
    assert result["count"] == 2
    assert result["dbPath"] == str(db)
    blob = json.dumps(result)
    assert "active-secret" not in blob
    assert "inactive-secret" not in blob
    assert "other-secret" not in blob

    mismatch = detection.check_stitch_credential("different")
    assert mismatch["status"] == "credential-mismatch"
    assert "active-secret" not in json.dumps(mismatch)
