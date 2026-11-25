"""OpenCode v2 credential repair through the ``opencode2 api`` CLI.

The v2 API can rotate credentials atomically: creating a credential with
``activate:true`` deactivates the other rows of the same integration.  The
CLI's ``credential.list`` output contains plaintext secrets, so every output
is parsed in memory, reduced to metadata immediately, and error text is passed
through explicit redaction.  Raw CLI stdout/stderr is never returned or logged.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pathlib import Path

from stitch_backend.domains.ai_proxy.model_sync.detection import (
    check_stitch_credential,
    opencode_binary_candidates,
)

STITCH_INTEGRATION_ID = "stitch"
STITCH_CREDENTIAL_LABEL = "Stitch Model Sync"
MANAGED_LABEL_PREFIX = "Stitch Model Sync"
DEFAULT_TIMEOUT = 30.0

_SECRET_ASSIGNMENT_RE = re.compile(
    r"(?i)(\"(?:key|apiKey|api_key|token|secret|password)\"\s*:\s*\")[^\"]*(\")"
)


def scrub_secret_values(text: str | None) -> str:
    """Redact JSON key/token assignments from CLI output before reuse."""
    if not text:
        return ""
    return _SECRET_ASSIGNMENT_RE.sub(r"\1********\2", text)


def sha256_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()


def find_opencode2_binary() -> Path | None:
    """Find the first launchable ``opencode2`` shim candidate."""
    for candidate in opencode_binary_candidates("opencode2"):
        try:
            if candidate.exists():
                return candidate
        except OSError:
            continue
    return None


def _extract_json_payload(output: str) -> Any:
    """Parse the first/outermost JSON payload from CLI stdout."""
    text = output.strip()
    if not text:
        raise ValueError("empty CLI output")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return json.loads(text[start : end + 1])
    start = text.find("[")
    end = text.rfind("]")
    if start >= 0 and end > start:
        return json.loads(text[start : end + 1])
    raise ValueError("CLI output did not contain JSON")


def _run_api(
    binary: Path,
    args: list[str],
    *,
    timeout: float,
    config_path: str | None = None,
) -> tuple[bool, Any | None, str | None]:
    """Run one fixed-argv API call.  Returned errors are already redacted."""
    env = os.environ.copy()
    if config_path:
        env["OPENCODE_CONFIG"] = config_path
    try:
        proc = subprocess.run(  # noqa: S603 — fixed argv array, no shell
            [str(binary), *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            env=env,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return False, None, f"opencode2 api launch failed: {type(exc).__name__}: {str(exc)[:160]}"

    combined = scrub_secret_values((proc.stdout or "") + "\n" + (proc.stderr or ""))
    if proc.returncode != 0:
        detail = " ".join(combined.split())[:240] or f"exit code {proc.returncode}"
        return False, None, f"opencode2 api {' '.join(args[:1])} failed: {detail}"
    try:
        return True, _extract_json_payload(proc.stdout or ""), None
    except Exception as exc:
        return False, None, f"opencode2 api returned unparseable output: {type(exc).__name__}"


def _data_payload(payload: Any) -> Any:
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


def _row_integration(row: dict[str, Any]) -> str | None:
    for key in ("integrationID", "integration_id", "integrationId", "integration", "provider"):
        value = row.get(key)
        if isinstance(value, str):
            return value
    return None


def _credential_rows(payload: Any) -> list[dict[str, Any]]:
    """Extract metadata-only rows; plaintext keys stay inside this function."""
    data = _data_payload(payload)
    if isinstance(data, dict):
        for key in ("credentials", "items", "rows"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
    if isinstance(data, dict):
        data = [data]
    if not isinstance(data, list):
        return []

    rows: list[dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        secret: str | None = None
        value = item.get("value")
        if isinstance(value, dict) and isinstance(value.get("key"), str):
            secret = value["key"]
        elif isinstance(item.get("key"), str):
            secret = item["key"]
        row_id = item.get("id") or item.get("credentialID") or item.get("credential_id")
        rows.append(
            {
                "id": row_id,
                "active": bool(item.get("active")),
                "integrationID": _row_integration(item),
                "label": item.get("label") if isinstance(item.get("label"), str) else None,
                "_keyHash": sha256_key(secret) if secret else None,
            }
        )
    return rows


def _list_credential_rows(
    binary: Path,
    *,
    timeout: float,
    config_path: str | None,
) -> tuple[list[dict[str, Any]], str | None]:
    ok, payload, error = _run_api(
        binary,
        ["api", "credential.list"],
        timeout=timeout,
        config_path=config_path,
    )
    if not ok:
        return [], error
    return _credential_rows(payload), None


def _remove_credential(
    binary: Path,
    credential_id: str,
    *,
    timeout: float,
    config_path: str | None,
) -> bool:
    ok, _payload, _error = _run_api(
        binary,
        ["api", "credential.remove", "--param", f"credentialID={credential_id}"],
        timeout=timeout,
        config_path=config_path,
    )
    return ok


def repair_stitch_credential(
    raw_key: str,
    *,
    config_path: str | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    stale_key_hashes: set[str] | None = None,
) -> dict[str, Any]:
    """Create+activate the stitch credential and conservatively remove stale rows.

    Only rows that are provably stitch-managed are removed: rows carrying the
    ``Stitch Model Sync`` label prefix, or inactive stitch rows whose plaintext
    key hash is explicitly supplied in ``stale_key_hashes``.  User-created rows
    are never touched.  The result is metadata-only.
    """
    if not raw_key:
        return {"ok": False, "error": "raw key required", "code": "missing-key"}

    binary = find_opencode2_binary()
    if binary is None:
        return {
            "ok": False,
            "error": "opencode2 binary not found",
            "code": "cli-missing",
            "binaryPath": None,
        }

    payload = {
        "integrationID": STITCH_INTEGRATION_ID,
        "label": STITCH_CREDENTIAL_LABEL,
        "activate": True,
        "value": {"type": "key", "key": raw_key},
    }
    ok, create_payload, error = _run_api(
        binary,
        ["api", "credential.create", "--data", json.dumps(payload, separators=(",", ":"))],
        timeout=timeout,
        config_path=config_path,
    )
    if not ok:
        return {
            "ok": False,
            "error": error or "credential.create failed",
            "code": "create-failed",
            "binaryPath": str(binary),
        }

    created = _data_payload(create_payload)
    credential_id = created.get("id") if isinstance(created, dict) else None
    if not isinstance(credential_id, str) or not credential_id:
        return {
            "ok": False,
            "error": "credential.create response did not include an id",
            "code": "create-no-id",
            "binaryPath": str(binary),
        }

    probe = check_stitch_credential(raw_key)
    verified = probe.get("status") == "credential-match" and probe.get("credentialId") in (
        credential_id,
        None,  # older db schemas do not expose a stable credential id column
    )

    warnings: list[str] = []
    removed: list[str] = []
    rows, list_error = _list_credential_rows(binary, timeout=timeout, config_path=config_path)
    if list_error:
        warnings.append(f"stale credential cleanup skipped: {list_error}")
    else:
        stale_key_hashes = stale_key_hashes or set()
        for row in rows:
            row_id = row.get("id")
            if not isinstance(row_id, str) or row_id == credential_id:
                continue
            if row.get("integrationID") != STITCH_INTEGRATION_ID:
                continue
            label = row.get("label")
            managed_label = isinstance(label, str) and label.startswith(MANAGED_LABEL_PREFIX)
            known_stale = (
                not row.get("active")
                and isinstance(row.get("_keyHash"), str)
                and row["_keyHash"] in stale_key_hashes
            )
            if not (managed_label or known_stale):
                continue
            if _remove_credential(binary, row_id, timeout=timeout, config_path=config_path):
                removed.append(row_id)
            else:
                warnings.append(f"could not remove stale stitch credential {row_id}")

    result: dict[str, Any] = {
        "ok": bool(verified),
        "credentialId": credential_id,
        "verified": bool(verified),
        "binaryPath": str(binary),
        "removedCredentialIds": removed,
        "warnings": warnings,
        "probe": {k: v for k, v in probe.items() if k != "detail"}
        | {"detail": probe.get("detail")},
    }
    if not verified:
        result["error"] = "credential created but verification probe did not match the active row"
        result["code"] = "verify-failed"
    return result
