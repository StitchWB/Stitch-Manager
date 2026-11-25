"""Apply/preview protocol tests: sha256 conflicts, rollback, token redaction."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from stitch_backend.domains.ai_proxy.model_sync import service
from stitch_backend.domains.ai_proxy.model_sync.catalog import catalog_entry_from_public_model

TOKEN = "tok-secret-abcdef123456"
INSTALL_KEYS = {"opencode": "install-opencode-secret", "omp": "install-omp-secret"}
BASE = "http://127.0.0.1:8787/v1"


class _FakeModel:
    def __init__(self, mid: str, contract: dict | None = None):
        self.id = mid
        self.display_name = mid.upper()
        self.contract = contract


def _catalog():
    return [
        catalog_entry_from_public_model(
            _FakeModel("vision-best", {"inputModalities": ["text", "image"]})
        ),
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

    from stitch_backend.domains.ai_proxy.model_sync import key_material

    async def fake_plan(target, extracted, *, legacy_local_token=None):
        if extracted == INSTALL_KEYS[target]:
            return key_material.KeyMaterial(
                target=target,
                action="reuse",
                raw=extracted,
                fingerprint=key_material.sha256_key(extracted),
                key_id=f"key-{target}",
            )
        return key_material.KeyMaterial(target=target, action="create")

    async def fake_provision(target, extracted, *, legacy_local_token=None):
        raw = INSTALL_KEYS[target]
        return key_material.KeyMaterial(
            target=target,
            action="reuse" if extracted == raw else "create",
            raw=raw,
            fingerprint=key_material.sha256_key(raw),
            key_id=f"key-{target}",
            created_key_id=None if extracted == raw else f"key-{target}",
        )

    async def fake_revoke(key_ids):
        return []

    monkeypatch.setattr(key_material, "plan_key_material", fake_plan)
    monkeypatch.setattr(key_material, "provision_key_material", fake_provision)
    monkeypatch.setattr(key_material, "revoke_install_keys", fake_revoke)
    monkeypatch.setattr(
        service.opencode_credentials,
        "repair_stitch_credential",
        lambda *a, **k: {"ok": False, "error": "test fixture cli missing", "code": "cli-missing"},
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
    assert service.KEY_SENTINEL not in blob
    assert "********" in blob
    assert result["keyPlan"]["opencode"]["action"] == "create"
    assert result["keyPlan"]["omp"]["action"] == "create"
    # readonly: nothing written
    assert not (tmp_path / "opencode.json").exists()
    assert not (tmp_path / "omp-root" / "agent" / "models.yml").exists()
    # never returns the full generated config — files expose diffs only
    for entry in result["files"]:
        assert "newText" not in entry
        assert "diff" in entry


def test_redact_covers_diff_prefixed_yaml_and_json() -> None:
    text = (
        "+  apiKey: yaml-secret\n"
        "-  password: yaml-password\n"
        '+    "token": "json-secret",\n'
        "  secret: yaml-context\n"
    )
    redacted = service._redact(text, None)
    assert "yaml-secret" not in redacted
    assert "yaml-password" not in redacted
    assert "json-secret" not in redacted
    assert "yaml-context" not in redacted


async def test_preview_model_diffs(tmp_path: Path) -> None:
    result = await service.preview(_params(tmp_path))
    assert set(result["modelDiffs"]["opencode"]["added"]) == {"vision-best", "text-fast"}
    assert set(result["modelDiffs"]["omp"]["added"]) == {"vision-best", "text-fast"}


async def test_preview_never_provisions_install_keys(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from stitch_backend.domains.ai_proxy.model_sync import key_material

    async def forbidden_provision(*args, **kwargs):
        raise AssertionError("preview must not write install-key rows")

    monkeypatch.setattr(key_material, "provision_key_material", forbidden_provision)
    result = await service.preview(_params(tmp_path))
    assert result["ok"] is True
    assert result["keyPlan"]["opencode"]["action"] == "create"
    assert service.KEY_SENTINEL not in json.dumps(result)


async def test_apply_credential_repair_precedes_file_writes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    params = _params(tmp_path, targets=["opencode"], schema="v2")
    preview = await service.preview(params)
    params["expectedSha256"] = preview["expectedSha256"]

    events: list[str] = []
    monkeypatch.setattr(
        service,
        "check_stitch_credential",
        lambda *a, **k: {"status": "credential-mismatch", "detail": "stale"},
    )

    def fake_repair(raw_key, **kwargs):
        events.append("repair")
        assert raw_key == INSTALL_KEYS["opencode"]
        return {"ok": True, "credentialId": "cred_new", "verified": True}

    monkeypatch.setattr(service.opencode_credentials, "repair_stitch_credential", fake_repair)
    real_write = service.write_text_atomic

    def recording_write(path, text, *, expected_sha256, encoding="utf-8"):
        events.append("write")
        return real_write(path, text, expected_sha256=expected_sha256, encoding=encoding)

    monkeypatch.setattr(service, "write_text_atomic", recording_write)
    result = await service.apply(params)
    assert result["ok"] is True, result
    assert events[:2] == ["repair", "write"]
    data = json.loads((tmp_path / "opencode.json").read_text(encoding="utf-8"))
    assert data["providers"]["stitch"]["settings"]["apiKey"] == INSTALL_KEYS["opencode"]


async def test_apply_mismatch_repair_failure_writes_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    params = _params(tmp_path, targets=["opencode"], schema="v2")
    preview = await service.preview(params)
    params["expectedSha256"] = preview["expectedSha256"]
    monkeypatch.setattr(
        service,
        "check_stitch_credential",
        lambda *a, **k: {"status": "credential-mismatch", "detail": "stale"},
    )
    monkeypatch.setattr(
        service.opencode_credentials,
        "repair_stitch_credential",
        lambda *a, **k: {"ok": False, "error": "cli missing", "code": "cli-missing"},
    )
    result = await service.apply(params)
    assert result["ok"] is False
    assert result["partialState"]["filesWritten"] is False
    assert not (tmp_path / "opencode.json").exists()


async def test_apply_then_files_written(tmp_path: Path) -> None:
    params = _params(tmp_path)
    preview = await service.preview(params)
    params["expectedSha256"] = preview["expectedSha256"]
    result = await service.apply(params)
    assert result["ok"] is True, result
    oc_data = json.loads((tmp_path / "opencode.json").read_text(encoding="utf-8"))
    assert "stitch" in oc_data["provider"]
    assert oc_data["provider"]["stitch"]["options"]["apiKey"] == INSTALL_KEYS["opencode"]
    assert TOKEN not in json.dumps(oc_data)  # legacy local token is never provisioned
    omp_models = tmp_path / "omp-root" / "agent" / "models.yml"
    assert omp_models.exists()
    omp_text = omp_models.read_text(encoding="utf-8")
    assert INSTALL_KEYS["omp"] in omp_text
    assert TOKEN not in omp_text
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


async def test_exactly_one_backup_for_written_file_zero_for_unchanged(tmp_path: Path) -> None:
    params = _params(tmp_path)
    first_preview = await service.preview(params)
    params["expectedSha256"] = first_preview["expectedSha256"]
    first = await service.apply(params)
    assert first["ok"] is True

    # Second apply changes only opencode (smallModel); omp remains byte-identical.
    params2 = _params(tmp_path, smallModel="stitch/text-fast")
    second_preview = await service.preview(params2)
    params2["expectedSha256"] = second_preview["expectedSha256"]
    second = await service.apply(params2)
    assert second["ok"] is True, second

    oc_backups = list(tmp_path.glob("opencode.json.bak-*"))
    omp_backups = list((tmp_path / "omp-root" / "agent").glob("models.yml.bak-*"))
    assert len(oc_backups) == 1
    assert omp_backups == []
    oc_entry = next(f for f in second["files"] if f["kind"] == "opencode-primary")
    omp_entry = next(f for f in second["files"] if f["kind"] == "omp-models")
    assert oc_entry["written"] is True
    assert oc_entry["backupPath"] == str(oc_backups[0])
    assert omp_entry.get("unchanged") is True
    assert omp_entry["backupPath"] is None


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

    from stitch_backend.domains.ai_proxy.model_sync import key_material

    revoked: list[list[str]] = []

    async def recording_revoke(key_ids):
        revoked.append(list(key_ids))
        return []

    monkeypatch.setattr(key_material, "revoke_install_keys", recording_revoke)
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
    # both newly-created keys were never activated after the successful rollback
    assert revoked == [["key-opencode", "key-omp"]]
    assert result["partialState"]["filesLeftBehind"] is False


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
    restored = await service.restore(
        {
            "path": str(oc_path),
            "backupPath": written[0]["backupPath"],
        }
    )
    assert restored["ok"] is True
    backup_bytes = Path(written[0]["backupPath"]).read_bytes()
    assert oc_path.read_bytes() == backup_bytes


async def test_restore_conflict(tmp_path: Path) -> None:
    target = tmp_path / "x.yml"
    backup = tmp_path / "x.yml.bak"
    target.write_text("current", encoding="utf-8")
    backup.write_text("old", encoding="utf-8")
    result = await service.restore(
        {
            "path": str(target),
            "backupPath": str(backup),
            "expectedSha256": "0" * 64,
        }
    )
    assert result["ok"] is False
    assert result["files"][0]["error"] == "conflict"
    assert target.read_text(encoding="utf-8") == "current"


async def test_both_json_jsonc_split_write(tmp_path: Path) -> None:
    # seed both files: stitch lives in the lower-precedence json
    oc_dir = tmp_path / "ocdir"
    oc_dir.mkdir()
    (oc_dir / "opencode.json").write_text(
        json.dumps(
            {
                "provider": {"stitch": {"name": "old"}, "other": {"name": "keep"}},
                "model": "stitch/old",
            }
        ),
        encoding="utf-8",
    )
    (oc_dir / "opencode.jsonc").write_text(
        '// comment\n{"provider": {"other2": {"name": "keep2"}}}\n',
        encoding="utf-8",
    )
    params = _params(
        tmp_path, targets=["opencode"], opencodeConfigPath=None, opencodeConfigDir=str(oc_dir)
    )
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


async def test_apply_writes_requested_small_model(tmp_path: Path) -> None:
    params = _params(tmp_path, targets=["opencode"], smallModel="stitch/text-fast")
    preview = await service.preview(params)
    params["expectedSha256"] = preview["expectedSha256"]
    applied = await service.apply(params)
    assert applied["ok"] is True, applied
    data = json.loads((tmp_path / "opencode.json").read_text(encoding="utf-8"))
    assert data["small_model"] == "stitch/text-fast"
    # the preview diff already contains the selector — no separate UI channel
    assert any("stitch/text-fast" in f["diff"] for f in preview["files"])


async def test_apply_small_model_no_clobber_existing(tmp_path: Path) -> None:
    oc_path = tmp_path / "opencode.json"
    oc_path.write_text(json.dumps({"small_model": "other/user-choice"}), encoding="utf-8")
    params = _params(tmp_path, targets=["opencode"])
    preview = await service.preview(params)
    params["expectedSha256"] = preview["expectedSha256"]
    applied = await service.apply(params)
    assert applied["ok"] is True, applied
    data = json.loads(oc_path.read_text(encoding="utf-8"))
    assert data["small_model"] == "other/user-choice"  # user value never overwritten


async def test_apply_small_model_written_when_absent(tmp_path: Path) -> None:
    params = _params(tmp_path, targets=["opencode"])
    preview = await service.preview(params)
    params["expectedSha256"] = preview["expectedSha256"]
    applied = await service.apply(params)
    assert applied["ok"] is True, applied
    data = json.loads((tmp_path / "opencode.json").read_text(encoding="utf-8"))
    assert data["small_model"].startswith("stitch/")


async def test_apply_v2_never_writes_small_model(tmp_path: Path) -> None:
    params = _params(tmp_path, targets=["opencode"], schema="v2", smallModel="stitch/text-fast")
    preview = await service.preview(params)
    params["expectedSha256"] = preview["expectedSha256"]
    applied = await service.apply(params)
    assert applied["ok"] is True, applied
    data = json.loads((tmp_path / "opencode.json").read_text(encoding="utf-8"))
    assert "small_model" not in data


async def test_status_surfaces_small_model_and_omp_binary(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    oc_path = tmp_path / "opencode.json"
    oc_path.write_text(
        json.dumps({"small_model": "stitch/text-fast", "model": "stitch/vision-best"}),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        service,
        "probe_omp_binary",
        lambda: {"binaryPath": "C:/omp/omp.exe", "version": "0.14.2", "raw": "omp 0.14.2"},
    )
    result = await service.status({"opencodeConfigPath": str(oc_path)})
    assert result["ok"] is True
    assert "security" in result
    assert result["security"]["keys"]["opencode"]["configuredSecretState"] == "missing"
    assert INSTALL_KEYS["opencode"] not in json.dumps(result)
    assert result["opencode"]["smallModel"] == "stitch/text-fast"
    assert result["opencode"]["defaultModel"] == "stitch/vision-best"
    assert result["omp"]["binaryPath"] == "C:/omp/omp.exe"
    assert result["omp"]["version"] == "0.14.2"


async def test_status_omp_binary_unknown_when_absent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        service,
        "probe_omp_binary",
        lambda: {"binaryPath": None, "version": None, "raw": None},
    )
    result = await service.status({"opencodeConfigPath": str(tmp_path / "opencode.json")})
    assert result["ok"] is True
    assert result["omp"]["binaryPath"] is None
    assert result["omp"]["version"] is None
    assert "smallModel" not in result["opencode"]  # absent config key → absent in status
