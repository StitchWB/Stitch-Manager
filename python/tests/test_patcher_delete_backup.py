import pytest

from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.patcher import commands


@pytest.mark.asyncio
async def test_delete_backup_removes_only_selected_backup(tmp_path, monkeypatch):
    monkeypatch.setattr(commands, "_get_backup_dir", lambda ide: tmp_path)
    selected = tmp_path / "kiro_extension_20260101.bak"
    other = tmp_path / "kiro_extension_20260102.bak"
    selected.write_bytes(b"backup")
    other.write_bytes(b"other")
    await commands.cmd_delete_backup({"backupId": selected.name})
    assert not selected.exists()
    assert other.read_bytes() == b"other"


@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["../kiro_extension_x.bak", "..\\kiro_extension_x.bak", "x.txt", "unknown_extension_x.bak"])
async def test_delete_backup_rejects_untrusted_paths(name):
    with pytest.raises(StitchError):
        await commands.cmd_delete_backup({"backupId": name})


@pytest.mark.asyncio
async def test_delete_backup_rejects_missing_file(tmp_path, monkeypatch):
    monkeypatch.setattr(commands, "_get_backup_dir", lambda ide: tmp_path)
    with pytest.raises(StitchError, match="not found"):
        await commands.cmd_delete_backup({"backupId": "kiro_extension_missing.bak"})
