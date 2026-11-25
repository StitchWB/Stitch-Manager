"""Apply/preview protocol tests: sha256 conflicts, rollback, token redaction."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from stitch_backend.domains.ai_proxy.model_sync import service
from stitch_backend.domains.ai_proxy.model_sync.catalog import catalog_entry_from_public_model

TOKEN = "tok-secret-abcdef123456"
BASE = "http://127.0.0.1:8787/v1"


class _FakeModel:
    def __init__(self, mid: str, contract: dict | None = None):
        self.id = mid
        self.display_name = mid.upper()
        self.contract = contract


def _catalog():
    return [
        catalog_entry_from_public_model(_FakeModel("vision-best", {"inputModalities": ["text", "image"]})),
        catalog_entry_from_public_model(_FakeModel("text-fast", None)),
    ]


@pytest.fixture(autouse=True)
def _patch_runtime(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    monkeypatch.setattr(service, "gateway_token", lambda: TOKEN)
    monkeypatch.setattr(service, "gateway_base_url", lambda: BASE)

    async def fake_catalog():
        return _catalog()

    monkeypatch.setattr(service, "load_catalog", fake_catalog)
    monkeypatch.setattr(
        service,
        "detect_opencode_version",
        lambda *a, **k: {"version": "unknown", "source": "default", "raw": None},
    )
    monkeypatch.setattr(
        service,
        "check_stitch_credential",
        lambda *a, **k: {"status": "no-database", "detail": "test fixture"},
    )
    # redirect omp root away from the real user profile
    monkeypatch.setenv("PI_CONFIG_DIR", str(tmp_path / "omp-root"))
    monkeypatch.delenv("PI_CODING_AGENT_DIR", raising=False)
    monkeypatch.delenv("OMP_PROFILE", raising=False)
    monkeypatch.delenv("PI_PROFILE", raising=False)


def _params(tmp_path: Path, **extra) -> dict:
    omp_agent = tmp_path / "omp-root" / "agent"
    omp_agent.mkdir(parents=True, exist_ok=True)
    params = {
        "targets": ["opencode", "omp"],
        "opencodeConfigPath": str(tmp_path / "opencode.json"),
        "ompProfile": "default",
        **extra,
    }
    return params


async def test_preview_is_readonly_and_redacts_token(tmp_path: Path) -> None:
    params = _params(tmp_path)
    result = await service.preview(params)
    assert result["ok"] is True
    assert result["expectedSha256"]
    blob = json.dumps(result)
    assert TOKEN not in blob  # token redacted everywhere in the preview
    assert "********" in blob
    # readonly: nothing written
    assert not (tmp_path / "opencode.json").exists()
    assert not (tmp_path / "omp-root" / "agent" / "models.yml").exists()
    # never returns the full generated config — files expose diffs only
    for entry in result["files"]:
        assert "newText" not in entry
        assert "diff" in entry


async def test_preview_model_diffs(tmp_path: Path) -> None:
    result = await service.preview(_params(tmp_path))
    assert set(result["modelDiffs"]["opencode"]["added"]) == {"vision-best", "text-fast"}
    assert set(result["modelDiffs"]["omp"]["added"]) == {"vision-best", "text-fast"}


async def test_apply_then_files_written(tmp_path: Path) -> None:
    params = _params(tmp_path)
    preview = await service.preview(params)
    params["expectedSha256"] = preview["expectedSha256"]
    result = await service.apply(params)
    assert result["ok"] is True, result
    oc_data = json.loads((tmp_path / "opencode.json").read_text(encoding="utf-8"))
    assert "stitch" in oc_data["provider"]
    assert oc_data["provider"]["stitch"]["options"]["apiKey"] == TOKEN  # real write unmasked
    omp_models = tmp_path / "omp-root" / "agent" / "models.yml"
    assert omp_models.exists()
    assert TOKEN in omp_models.read_text(encoding="utf-8")
    assert all(f.get("written") or f.get("unchanged") for f in result["files"])


async def test_apply_conflict_zero_writes(tmp_path: Path) -> None:
    params = _params(tmp_path)
    preview = await service.preview(params)
    params["expectedSha256"] = preview["expectedSha256"]
    first = await service.apply(params)
    assert first["ok"] is True

    # tamper with one file AFTER a fresh preview → stale sha must block everything
    preview2 = await service.preview(params)
    oc_path = tmp_path / "opencode.json"
    oc_path.write_text(oc_path.read_text(encoding="utf-8") + " ", encoding="utf-8")
    params["expectedSha256"] = preview2["expectedSha256"]
    result = await service.apply(params)
    assert result["ok"] is False
    assert result["error"] == "conflict"
    assert result["status"] == 409
    assert result["mismatches"]
    # nothing written: omp files still at first-apply content
    omp_text = (tmp_path / "omp-root" / "agent" / "models.yml").read_text(encoding="utf-8")
    assert "vision-best" in omp_text


async def test_apply_requires_expected_sha(tmp_path: Path) -> None:
    result = await service.apply(_params(tmp_path))
    assert result["ok"] is False
    assert "expectedSha256" in result["error"]


async def test_apply_missing_file_in_sha_map_blocks(tmp_path: Path) -> None:
    params = _params(tmp_path)
    preview = await service.preview(params)
    broken = dict(preview["expectedSha256"])
    broken.pop(next(iter(broken)))
    params["expectedSha256"] = broken
    result = await service.apply(params)
    assert result["ok"] is False
    assert result["status"] == 409


async def test_apply_partial_failure_rolls_back(tmp_path: Path, monkeypatch) -> None:
    params = _params(tmp_path)
    preview = await service.preview(params)
    params["expectedSha256"] = preview["expectedSha256"]

    real_write = service.write_text_atomic
    calls = {"n": 0}

    def flaky_write(path, text, *, expected_sha256, encoding="utf-8"):
        calls["n"] += 1
        if calls["n"] == 2:  # fail the second file (omp config.yml)
            raise OSError("simulated transient lock")
        return real_write(path, text, expected_sha256=expected_sha256, encoding=encoding)

    monkeypatch.setattr(service, "write_text_atomic", flaky_write)
    result = await service.apply(params)
    assert result["ok"] is False
    assert "rolled back" in result["error"]
    rolled = [f for f in result["files"] if f.get("rolledBack")]
    assert rolled, "first file must have been rolled back"
    # rollback means the first file no longer exists (it was newly created)
    assert not (tmp_path / "omp-root" / "agent" / "models.yml").exists()


async def test_restore_roundtrip(tmp_path: Path) -> None:
    # seed the file so apply produces a real backup of pre-existing content
    oc_path = tmp_path / "opencode.json"
    seed = '{"seed": true}\n'
    oc_path.write_text(seed, encoding="utf-8")

    params = _params(tmp_path)
    preview = await service.preview(params)
    params["expectedSha256"] = preview["expectedSha256"]
    applied = await service.apply(params)
    assert applied["ok"] is True

    oc_path.write_text('{"tampered": true}', encoding="utf-8")
    written = [f for f in applied["files"] if f["path"] == str(oc_path)]
    assert written and written[0].get("backupPath")
    restored = await service.restore({
        "path": str(oc_path),
        "backupPath": written[0]["backupPath"],
    })
    assert restored["ok"] is True
    backup_bytes = Path(written[0]["backupPath"]).read_bytes()
    assert oc_path.read_bytes() == backup_bytes


async def test_restore_conflict(tmp_path: Path) -> None:
    target = tmp_path / "x.yml"
    backup = tmp_path / "x.yml.bak"
    target.write_text("current", encoding="utf-8")
    backup.write_text("old", encoding="utf-8")
    result = await service.restore({
        "path": str(target),
        "backupPath": str(backup),
        "expectedSha256": "0" * 64,
    })
    assert result["ok"] is False
    assert result["files"][0]["error"] == "conflict"
    assert target.read_text(encoding="utf-8") == "current"


async def test_both_json_jsonc_split_write(tmp_path: Path) -> None:
    # seed both files: stitch lives in the lower-precedence json
    oc_dir = tmp_path / "ocdir"
    oc_dir.mkdir()
    (oc_dir / "opencode.json").write_text(
        json.dumps({
            "provider": {"stitch": {"name": "old"}, "other": {"name": "keep"}},
            "model": "stitch/old",
        }),
        encoding="utf-8",
    )
    (oc_dir / "opencode.jsonc").write_text(
        '// comment\n{"provider": {"other2": {"name": "keep2"}}}\n',
        encoding="utf-8",
    )
    params = _params(tmp_path, targets=["opencode"], opencodeConfigPath=None,
                     opencodeConfigDir=str(oc_dir))
    params.pop("opencodeConfigPath")
    preview = await service.preview(params)
    assert preview["ok"] is True
    kinds = {f["kind"] for f in preview["files"]}
    assert kinds == {"opencode-primary", "opencode-secondary"}
    assert any("both" in w for w in preview["warnings"])

    params["expectedSha256"] = preview["expectedSha256"]
    applied = await service.apply(params)
    assert applied["ok"] is True, applied

    primary = json.loads((oc_dir / "opencode.jsonc").read_text(encoding="utf-8"))
    assert "stitch" in primary["provider"]  # written into highest precedence
    assert primary["provider"]["other2"]["name"] == "keep2"
    secondary = json.loads((oc_dir / "opencode.json").read_text(encoding="utf-8"))
    assert "stitch" not in secondary["provider"]  # purged from lower precedence
    assert secondary["provider"]["other"]["name"] == "keep"  # unrelated untouched
    assert "model" not in secondary  # dangling stitch pointer dropped


async def test_v2_schema_write(tmp_path: Path) -> None:
    monkeypatch_params = _params(tmp_path, targets=["opencode"], schema="v2")
    preview = await service.preview(monkeypatch_params)
    assert preview["schema"] == "v2"
    monkeypatch_params["expectedSha256"] = preview["expectedSha256"]
    applied = await service.apply(monkeypatch_params)
    assert applied["ok"] is True
    data = json.loads((tmp_path / "opencode.json").read_text(encoding="utf-8"))
    assert "providers" in data
    stitch = data["providers"]["stitch"]
    assert stitch["package"] == "@opencode/ai/providers/openai-compatible"
    assert "small_model" not in data
