"""write_text_atomic primitives: conflict protocol, unique backups, fsync write."""

from __future__ import annotations

import hashlib
from pathlib import Path

from stitch_backend.domains.opencode_config.service import write_text_atomic


def test_write_new_file_requires_none_sha(tmp_path: Path) -> None:
    target = tmp_path / "a.json"
    bad = write_text_atomic(target, "x", expected_sha256="0" * 64)
    assert bad["ok"] is False
    assert not target.exists()
    good = write_text_atomic(target, "x", expected_sha256=None)
    assert good["ok"] is True
    assert target.read_text(encoding="utf-8") == "x"
    assert good["backupPath"] is None


def test_write_existing_requires_matching_sha(tmp_path: Path) -> None:
    target = tmp_path / "a.json"
    target.write_text("old", encoding="utf-8")
    # expected None for an existing file is a conflict — callers must snapshot
    assert write_text_atomic(target, "new", expected_sha256=None)["ok"] is False
    assert write_text_atomic(target, "new", expected_sha256="0" * 64)["ok"] is False
    assert target.read_text(encoding="utf-8") == "old"  # untouched

    sha = hashlib.sha256(target.read_bytes()).hexdigest()
    result = write_text_atomic(target, "new", expected_sha256=sha)
    assert result["ok"] is True
    assert target.read_text(encoding="utf-8") == "new"
    backup = Path(result["backupPath"])
    assert backup.exists()
    assert backup.read_text(encoding="utf-8") == "old"


def test_backup_names_unique_within_same_second(tmp_path: Path) -> None:
    target = tmp_path / "a.json"
    target.write_text("v1", encoding="utf-8")
    names: set[str] = set()
    for idx in range(5):
        sha = hashlib.sha256(target.read_bytes()).hexdigest()
        result = write_text_atomic(target, f"v{idx + 2}", expected_sha256=sha)
        assert result["ok"] is True
        names.add(result["backupPath"])
    assert len(names) == 5  # timestamp+counter/uuid suffix — no 1s collisions


def test_newlines_not_translated(tmp_path: Path) -> None:
    target = tmp_path / "a.json"
    write_text_atomic(target, "line1\nline2\n", expected_sha256=None)
    assert target.read_bytes() == b"line1\nline2\n"  # no \r\n on Windows
