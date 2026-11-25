"""opencode2 api credential-repair regressions."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from stitch_backend.domains.ai_proxy.model_sync import opencode_credentials as oc

if TYPE_CHECKING:
    from pathlib import Path

    import pytest


class _Proc:
    def __init__(self, stdout: str, returncode: int = 0, stderr: str = ""):
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = returncode


def test_repair_argv_rotation_cleanup_and_secret_redaction(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    binary = tmp_path / "opencode2.cmd"
    binary.write_text("@echo off\r\n", encoding="utf-8")
    monkeypatch.setattr(oc, "find_opencode2_binary", lambda: binary)
    monkeypatch.setattr(
        oc,
        "check_stitch_credential",
        lambda raw: {
            "status": "credential-match",
            "credentialId": "cred_new",
            "active": True,
            "count": 1,
        },
    )

    calls: list[list[str]] = []
    envs: list[dict[str, str]] = []
    raw_key = "new-secret-key"
    old_key = "old-secret-key"

    def fake_run(argv, **kwargs):
        calls.append(list(argv))
        envs.append(kwargs["env"])
        op = argv[2]
        if op == "credential.create":
            payload = json.loads(argv[4])
            assert payload["integrationID"] == "stitch"
            assert payload["activate"] is True
            assert payload["value"] == {"type": "key", "key": raw_key}
            return _Proc(json.dumps({"data": {"id": "cred_new", "active": True}}))
        if op == "credential.list":
            # Deliberately includes plaintext: it must remain internal and be redacted.
            return _Proc(
                json.dumps(
                    {
                        "data": [
                            {
                                "id": "cred_new",
                                "active": True,
                                "integrationID": "stitch",
                                "label": "Stitch Model Sync",
                                "value": {"type": "key", "key": raw_key},
                            },
                            {
                                "id": "cred_old",
                                "active": False,
                                "integrationID": "stitch",
                                "label": "Stitch Model Sync (previous)",
                                "value": {"type": "key", "key": old_key},
                            },
                            {
                                "id": "cred_user",
                                "active": False,
                                "integrationID": "stitch",
                                "label": "user row",
                                "value": {"type": "key", "key": "user-secret"},
                            },
                        ]
                    }
                )
            )
        if op == "credential.remove":
            assert argv[3:] == ["--param", "credentialID=cred_old"]
            return _Proc(json.dumps({"data": {"id": "cred_old"}}))
        raise AssertionError(f"unexpected op {op}")

    monkeypatch.setattr(oc.subprocess, "run", fake_run)
    result = oc.repair_stitch_credential(raw_key, config_path="C:/custom/opencode.json", timeout=1)

    assert result["ok"] is True, result
    assert result["credentialId"] == "cred_new"
    assert result["removedCredentialIds"] == ["cred_old"]
    assert calls[0][:3] == [str(binary), "api", "credential.create"]
    assert calls[0][3] == "--data"
    assert calls[1][:3] == [str(binary), "api", "credential.list"]
    assert calls[2][:3] == [str(binary), "api", "credential.remove"]
    assert envs[0]["OPENCODE_CONFIG"] == "C:/custom/opencode.json"
    blob = json.dumps(result)
    assert raw_key not in blob
    assert old_key not in blob
    assert "user-secret" not in blob


def test_api_error_is_scrubbed(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    binary = tmp_path / "opencode2"
    binary.write_text("", encoding="utf-8")
    monkeypatch.setattr(oc, "find_opencode2_binary", lambda: binary)

    def fake_run(argv, **kwargs):
        return _Proc("", returncode=2, stderr='bad {"key":"super-secret"}')

    monkeypatch.setattr(oc.subprocess, "run", fake_run)
    result = oc.repair_stitch_credential("new-secret", timeout=1)
    assert result["ok"] is False
    assert "super-secret" not in json.dumps(result)
    assert "********" in result["error"]


def test_scrub_secret_values() -> None:
    text = '{"value":{"type":"key","key":"abc"},"token":"def"}'
    scrubbed = oc.scrub_secret_values(text)
    assert "abc" not in scrubbed
    assert "def" not in scrubbed
    assert "********" in scrubbed
