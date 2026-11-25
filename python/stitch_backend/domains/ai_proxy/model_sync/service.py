"""Model Sync orchestration: status, preview, apply, restore.

Multi-file apply protocol (NEVER claimed to be fully atomic):

1. read ALL snapshots
2. validate ALL expected sha256 — any mismatch → structured 409 conflict,
   nothing written
3. generate all payloads
4. backup all files (unique sibling copies)
5. write in documented order: omp models.yml → omp config.yml →
   opencode secondary purge → opencode primary
6. on failure, best-effort rollback of already-written files from the
   pre-write backups
7. report per-file written/backup/rolled-back status

Token handling: the literal local chat token is written into configs
(status-quo behaviour) but redacted as ``********`` in every preview diff,
response and log.  Backups DO contain the token — never log their contents.
"""

from __future__ import annotations

import difflib
import hashlib
import json
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from stitch_backend.domains.ai_proxy.model_sync import omp as omp_layer
from stitch_backend.domains.ai_proxy.model_sync import opencode as oc_layer
from stitch_backend.domains.ai_proxy.model_sync.catalog import load_catalog, select_models
from stitch_backend.domains.ai_proxy.model_sync.detection import (
    check_stitch_credential,
    detect_opencode_version,
    probe_omp_binary,
    resolve_opencode_layout,
    resolve_schema,
)
from stitch_backend.domains.opencode_config.service import (
    _backup_path,
    read_snapshot,
    write_text_atomic,
)

MASK = "********"

# documented write order for multi-file apply
WRITE_ORDER = ("omp-models", "omp-config", "opencode-secondary", "opencode-primary")


def gateway_base_url() -> str:
    from stitch_backend.config import get_settings

    settings = get_settings()
    return f"http://127.0.0.1:{settings.port}{settings.litellm_gateway_model_prefix}"


def gateway_token() -> str | None:
    from stitch_backend.domains.ai_proxy.local_auth import get_cached_local_chat_token

    return get_cached_local_chat_token()


def _redact(text: str, token: str | None) -> str:
    if token:
        text = text.replace(token, MASK)
    return text


def _sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


@dataclass
class FilePlan:
    """One file participating in a sync operation."""

    kind: str  # see WRITE_ORDER
    target: str  # "opencode" | "omp"
    path: Path
    old_text: str
    new_text: str
    sha256: str | None  # current on-disk hash, None when absent
    exists: bool
    warnings: list[str] = field(default_factory=list)

    def diff(self, token: str | None) -> str:
        old = _redact(self.old_text, token).splitlines(keepends=True)
        new = _redact(self.new_text, token).splitlines(keepends=True)
        return "".join(
            difflib.unified_diff(
                old, new, fromfile=f"a/{self.path.name}", tofile=f"b/{self.path.name}"
            )
        )


@dataclass
class SyncPlan:
    files: list[FilePlan]
    warnings: list[str]
    errors: list[str]
    model_diffs: dict[str, Any]
    schema: str | None = None
    detected_version: dict[str, Any] | None = None
    unknown_model_ids: list[str] = field(default_factory=list)

    def sha_map(self) -> dict[str, str | None]:
        return {str(f.path): f.sha256 for f in self.files}


# ── payload generation ──────────────────────────────────────────────────────


def _opencode_file_plans(
    entries: list[dict[str, Any]],
    base_url: str,
    token: str,
    schema: str,
    *,
    config_path: str | None,
    config_dir: str | None,
    default_model: str | None,
    small_model: str | None,
) -> tuple[list[FilePlan], list[str], dict[str, Any]]:
    warnings: list[str] = []
    layout = resolve_opencode_layout(config_path=config_path, config_dir=config_dir)
    warnings.extend(layout.warnings)

    plans: list[FilePlan] = []
    model_diff: dict[str, Any] = {
        "added": [],
        "removed": [],
        "updated": [],
        "unchanged": [],
    }

    primary = read_snapshot(layout.write_target)
    merged = oc_layer.merge_stitch_block(
        primary.data,
        entries,
        base_url,
        token,
        schema,
        default_model=default_model,
        small_model=small_model,
    )
    new_text = json.dumps(merged, indent=2, ensure_ascii=False) + "\n"
    old_text = primary.path.read_text(encoding="utf-8-sig") if primary.exists else ""
    if primary.is_jsonc and primary.exists:
        warnings.append(f"{primary.path.name}: JSONC comments may be dropped on write")
    plans.append(
        FilePlan(
            kind="opencode-primary",
            target="opencode",
            path=layout.write_target,
            old_text=old_text,
            new_text=new_text,
            sha256=primary.sha256,
            exists=primary.exists,
        )
    )

    # per-model diff against existing stitch entries
    existing_ids = oc_layer.existing_stitch_model_ids(primary.data)
    selected_ids = {e["id"] for e in entries}
    providers_key = "providers" if schema == "v2" else "provider"
    existing_models = (primary.data.get(providers_key) or {}).get(
        oc_layer.STITCH_PROVIDER_ID, {}
    ) or {}
    if not isinstance(existing_models, dict):
        existing_models = {}
    existing_entries = existing_models.get("models")
    existing_entries = existing_entries if isinstance(existing_entries, dict) else {}
    builder = oc_layer.build_v2_model_entry if schema == "v2" else oc_layer.build_v1_model_entry
    for entry in entries:
        if entry["id"] not in existing_ids:
            model_diff["added"].append(entry["id"])
        else:
            generated = builder(entry)
            if existing_entries.get(entry["id"]) == generated:
                model_diff["unchanged"].append(entry["id"])
            else:
                model_diff["updated"].append(entry["id"])
    for old_id in sorted(existing_ids - selected_ids):
        model_diff["removed"].append(old_id)

    # split-file purge: both json+jsonc exist → strip stitch from the lower one
    if layout.secondary_path is not None:
        secondary = read_snapshot(layout.secondary_path)
        purged, removed = oc_layer.purge_stitch_entries(secondary.data)
        sec_old = secondary.path.read_text(encoding="utf-8-sig") if secondary.exists else ""
        if removed:
            sec_new = json.dumps(purged, indent=2, ensure_ascii=False) + "\n"
        else:
            sec_new = sec_old  # nothing to purge — content unchanged
        plans.append(
            FilePlan(
                kind="opencode-secondary",
                target="opencode",
                path=layout.secondary_path,
                old_text=sec_old,
                new_text=sec_new,
                sha256=secondary.sha256,
                exists=secondary.exists,
            )
        )

    return plans, warnings, model_diff


def _omp_file_plans(
    entries: list[dict[str, Any]],
    base_url: str,
    token: str,
    *,
    profile_name: str | None,
    prune_unselected: bool,
    roles: list[dict[str, Any]] | None,
    ensure_enabled: bool,
    models_path_override: str | None = None,
    config_path_override: str | None = None,
) -> tuple[list[FilePlan], list[str], list[str], dict[str, Any]]:
    warnings: list[str] = []
    errors: list[str] = []
    profile = omp_layer.resolve_profile(profile_name)

    models_path = Path(models_path_override) if models_path_override else profile.models_path
    config_path = Path(config_path_override) if config_path_override else profile.config_path

    models_data = omp_layer.load_yaml_rt(models_path)
    config_data = omp_layer.load_yaml_rt(config_path)

    selected_ids = [e["id"] for e in entries]
    existing_ids = omp_layer.existing_stitch_model_ids_omp(models_data)
    pruned_ids = sorted(existing_ids - set(selected_ids)) if prune_unselected else []

    models_data, diff = omp_layer.update_models_yaml(
        models_data, entries, base_url, token, prune_unselected=prune_unselected
    )
    config_data, cfg_warnings, cfg_errors = omp_layer.update_config_yaml(
        config_data,
        roles=roles,
        selected_ids=selected_ids,
        pruned_ids=pruned_ids,
        ensure_enabled=ensure_enabled,
    )
    warnings.extend(cfg_warnings)
    errors.extend(cfg_errors)

    plans: list[FilePlan] = []
    # skip creating a brand-new empty config.yml when there is nothing to put
    # in it (no roles requested, no stitch-relevant keys) — noise-free writes
    config_needed = bool(config_data) or (config_path.exists())
    file_specs = [("omp-models", models_path, models_data)]
    if config_needed:
        file_specs.append(("omp-config", config_path, config_data))
    for kind, path, data in file_specs:
        exists = path.exists()
        old_text = path.read_text(encoding="utf-8") if exists else ""
        sha = _sha256_bytes(path.read_bytes()) if exists else None
        plans.append(
            FilePlan(
                kind=kind,
                target="omp",
                path=path,
                old_text=old_text,
                new_text=omp_layer.dump_yaml_rt(data),
                sha256=sha,
                exists=exists,
            )
        )
    return plans, warnings, errors, diff


def build_plan(params: dict[str, Any], catalog: list[dict[str, Any]]) -> SyncPlan:
    """Build the full sync plan shared by preview and apply."""
    token = gateway_token()
    base_url = gateway_base_url()

    targets = params.get("targets")
    if not targets:
        targets = ["opencode", "omp"]
    if isinstance(targets, str):
        targets = [targets]

    entries, unknown_ids = select_models(catalog, params.get("models"))
    entries = [dict(e) for e in entries]

    warnings: list[str] = []
    errors: list[str] = []
    files: list[FilePlan] = []
    model_diffs: dict[str, Any] = {}
    schema_out: str | None = None
    detected: dict[str, Any] | None = None

    if "opencode" in targets:
        detected = params.get("_detectedVersion") or detect_opencode_version()
        schema_out = resolve_schema(params.get("schema"), detected["version"])
        oc_plans, oc_warnings, oc_diff = _opencode_file_plans(
            entries,
            base_url,
            token or "",
            schema_out,
            config_path=params.get("opencodeConfigPath"),
            config_dir=params.get("opencodeConfigDir"),
            default_model=params.get("defaultModel"),
            small_model=params.get("smallModel"),
        )
        files.extend(oc_plans)
        warnings.extend(oc_warnings)
        model_diffs["opencode"] = oc_diff

    if "omp" in targets:
        omp_plans, omp_warnings, omp_errors, omp_diff = _omp_file_plans(
            entries,
            base_url,
            token or "",
            profile_name=params.get("ompProfile"),
            prune_unselected=bool(params.get("pruneUnselected")),
            roles=params.get("roles"),
            ensure_enabled=bool(params.get("ensureEnabled")),
            models_path_override=params.get("ompModelsPath"),
            config_path_override=params.get("ompConfigPath"),
        )
        files.extend(omp_plans)
        warnings.extend(omp_warnings)
        errors.extend(omp_errors)
        model_diffs["omp"] = omp_diff

    # stable write order
    order_index = {kind: idx for idx, kind in enumerate(WRITE_ORDER)}
    files.sort(key=lambda f: order_index.get(f.kind, len(WRITE_ORDER)))

    return SyncPlan(
        files=files,
        warnings=warnings,
        errors=errors,
        model_diffs=model_diffs,
        schema=schema_out,
        detected_version=detected,
        unknown_model_ids=unknown_ids,
    )


# ── command-facing operations ───────────────────────────────────────────────


async def status(params: dict[str, Any]) -> dict[str, Any]:
    import asyncio

    token = gateway_token()
    detected, omp_binary = await asyncio.gather(
        asyncio.to_thread(detect_opencode_version),
        asyncio.to_thread(probe_omp_binary),
    )
    layout = resolve_opencode_layout(
        config_path=params.get("opencodeConfigPath"),
        config_dir=params.get("opencodeConfigDir"),
    )

    opencode_info: dict[str, Any] = {
        "detectedVersion": detected,
        "writeTarget": str(layout.write_target),
        "writeTargetExists": layout.write_target.exists(),
        "secondaryPath": str(layout.secondary_path) if layout.secondary_path else None,
        "configJsonPresent": layout.config_json_path is not None,
        "warnings": list(layout.warnings),
        "stitchModels": [],
    }
    if layout.write_target.exists():
        try:
            snapshot = read_snapshot(layout.write_target)
            opencode_info["stitchModels"] = sorted(
                oc_layer.existing_stitch_model_ids(snapshot.data)
            )
            opencode_info["sha256"] = snapshot.sha256
            # current top-level selectors — the pickers initialize from these
            for key, out_key in (("model", "defaultModel"), ("small_model", "smallModel")):
                value = snapshot.data.get(key)
                if isinstance(value, str) and value:
                    opencode_info[out_key] = value
        except Exception as exc:
            opencode_info["warnings"].append(f"cannot parse config: {exc!r}"[:200])

    credential = check_stitch_credential(token)
    if credential["status"] == "credential-mismatch":
        opencode_info["warnings"].append(credential["detail"])
    opencode_info["credential"] = credential

    profiles = []
    for profile in omp_layer.discover_profiles():
        entry: dict[str, Any] = {
            "name": profile.name,
            "agentDir": str(profile.agent_dir),
            "exists": profile.exists,
            "modelsPath": str(profile.models_path),
            "configPath": str(profile.config_path),
            "isDefault": profile.is_default,
            "stitchModels": [],
        }
        if profile.models_path.exists():
            try:
                data = omp_layer.load_yaml_rt(profile.models_path)
                entry["stitchModels"] = sorted(omp_layer.existing_stitch_model_ids_omp(data))
            except Exception as exc:
                entry["parseError"] = str(exc)[:200]
        profiles.append(entry)

    return {
        "ok": True,
        "gatewayRunning": token is not None,
        "baseUrl": gateway_base_url(),
        "opencode": opencode_info,
        "omp": {
            "profiles": profiles,
            "profileHint": omp_layer.profile_hint(),
            "binaryPath": omp_binary["binaryPath"],
            "version": omp_binary["version"],
        },
    }


async def preview(params: dict[str, Any]) -> dict[str, Any]:
    import asyncio

    catalog, detected = await asyncio.gather(
        load_catalog(), asyncio.to_thread(detect_opencode_version)
    )
    params = {**params, "_detectedVersion": detected}
    plan = build_plan(params, catalog)
    token = gateway_token()

    files = []
    for file_plan in plan.files:
        files.append(
            {
                "path": str(file_plan.path),
                "kind": file_plan.kind,
                "target": file_plan.target,
                "exists": file_plan.exists,
                "sha256": file_plan.sha256,
                "changed": file_plan.old_text != file_plan.new_text,
                "diff": _redact(file_plan.diff(token), token),
            }
        )

    warnings = list(plan.warnings)
    if any(f.path.suffix.lower() == ".jsonc" for f in plan.files if f.exists):
        warnings.append("JSONC comments may be dropped on write")
    if "opencode" in (params.get("targets") or ["opencode", "omp"]):
        credential = await asyncio.to_thread(check_stitch_credential, token)
        if credential["status"] == "credential-mismatch":
            warnings.append(credential["detail"])

    return {
        "ok": not plan.errors,
        "errors": plan.errors,
        "warnings": warnings,
        "schema": plan.schema,
        "detectedVersion": plan.detected_version,
        "modelDiffs": plan.model_diffs,
        "unknownModelIds": plan.unknown_model_ids,
        "files": files,
        "expectedSha256": plan.sha_map(),
        # never the full generated config — diffs only, token redacted
    }


def _validate_expected_sha(plan: SyncPlan, expected: dict[str, Any]) -> list[dict[str, Any]]:
    mismatches: list[dict[str, Any]] = []
    for file_plan in plan.files:
        key = str(file_plan.path)
        if key not in expected:
            mismatches.append(
                {
                    "path": key,
                    "error": "missing expected sha256 — re-run preview",
                    "expected": None,
                    "actual": file_plan.sha256,
                }
            )
            continue
        want = expected[key]
        # re-read the live file: the snapshot in the plan is stale by now
        if file_plan.path.exists():
            actual = _sha256_bytes(file_plan.path.read_bytes())
        else:
            actual = None
        if want != actual:
            mismatches.append(
                {
                    "path": key,
                    "error": "sha256 mismatch — file changed since preview",
                    "expected": want,
                    "actual": actual,
                }
            )
    return mismatches


async def apply(params: dict[str, Any]) -> dict[str, Any]:
    token = gateway_token()
    if not token:
        return {"ok": False, "error": "gateway is not running — start the AI proxy first"}

    expected = params.get("expectedSha256")
    if not isinstance(expected, dict) or not expected:
        return {
            "ok": False,
            "error": "expectedSha256 map required — obtain it from model_sync_preview",
        }

    import asyncio

    detected = await asyncio.to_thread(detect_opencode_version)
    params = {**params, "_detectedVersion": detected}
    catalog = await load_catalog()
    plan = build_plan(params, catalog)
    if plan.errors:
        return {"ok": False, "errors": plan.errors, "warnings": plan.warnings}
    if not plan.files:
        return {"ok": False, "error": "nothing to write"}

    # 1-2. validate ALL expected sha256 before writing anything
    mismatches = _validate_expected_sha(plan, expected)
    if mismatches:
        return {
            "ok": False,
            "error": "conflict",
            "status": 409,
            "mismatches": mismatches,
        }

    # 3. backup ALL files up-front (backups contain secrets — never log contents)
    backups: dict[str, str] = {}
    original_bytes: dict[str, bytes] = {}
    for file_plan in plan.files:
        key = str(file_plan.path)
        if file_plan.path.exists():
            backup = _backup_path(file_plan.path)
            shutil.copy2(file_plan.path, backup)
            backups[key] = str(backup)
            original_bytes[key] = file_plan.path.read_bytes()

    # 4. write in documented order; 5. best-effort rollback on failure
    results: list[dict[str, Any]] = []
    written: list[FilePlan] = []
    failure: str | None = None
    for file_plan in plan.files:
        key = str(file_plan.path)
        entry: dict[str, Any] = {
            "path": key,
            "kind": file_plan.kind,
            "written": False,
            "backupPath": backups.get(key),
            "rolledBack": False,
        }
        if failure is not None:
            entry["skipped"] = True
            results.append(entry)
            continue
        if file_plan.old_text == file_plan.new_text and file_plan.exists:
            entry["unchanged"] = True
            results.append(entry)
            continue
        try:
            write_result = write_text_atomic(
                file_plan.path, file_plan.new_text, expected_sha256=file_plan.sha256
            )
        except Exception as exc:
            failure = f"{key}: {exc!r}"[:300]
            entry["error"] = failure
            results.append(entry)
            break
        if not write_result.get("ok"):
            failure = f"{key}: {write_result.get('error', 'write failed')}"
            entry["error"] = failure
            results.append(entry)
            break
        entry["written"] = True
        if write_result.get("backupPath"):
            entry["backupPath"] = write_result["backupPath"]
        written.append(file_plan)
        results.append(entry)

    if failure is not None:
        # best-effort rollback of already-written files — NEVER full atomicity
        for file_plan in written:
            key = str(file_plan.path)
            try:
                if key in original_bytes:
                    file_plan.path.write_bytes(original_bytes[key])
                else:
                    file_plan.path.unlink(missing_ok=True)
                for entry in results:
                    if entry["path"] == key:
                        entry["rolledBack"] = True
            except OSError as exc:
                for entry in results:
                    if entry["path"] == key:
                        entry["rollbackError"] = str(exc)[:200]
        return {
            "ok": False,
            "error": f"apply failed, rolled back written files (best-effort): {failure}",
            "files": results,
            "warnings": plan.warnings,
        }

    return {
        "ok": True,
        "files": results,
        "warnings": plan.warnings,
        "schema": plan.schema,
        "modelDiffs": plan.model_diffs,
    }


def restore_file_raw(
    path: str | Path, backup_path: str | Path, *, expected_sha256: str | None
) -> dict[str, Any]:
    """Restore raw bytes from a backup with sha256 conflict protection.

    Keeps a safety copy of the current live file.  Works for JSON and YAML
    alike — no parsing, the backup is trusted as-is.
    """
    resolved = Path(path)
    backup = Path(backup_path)
    if not backup.exists():
        return {"ok": False, "error": "backup not found", "path": str(resolved)}
    raw = backup.read_bytes()

    if resolved.exists():
        if expected_sha256 is not None:
            current = _sha256_bytes(resolved.read_bytes())
            if current != expected_sha256:
                return {"ok": False, "error": "conflict", "path": str(resolved)}
        safety = _backup_path(resolved)
        safety.write_bytes(resolved.read_bytes())
        safety_path: str | None = str(safety)
    elif expected_sha256 is not None:
        return {"ok": False, "error": "conflict", "path": str(resolved)}
    else:
        safety_path = None

    # raw-bytes atomic write: decoding to text would corrupt newlines on
    # Windows (text mode translates \n → \r\n), so write bytes directly
    import os
    import tempfile

    from stitch_backend.domains.opencode_config.service import _replace_with_retry

    resolved.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=str(resolved.parent), prefix=f"{resolved.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        _replace_with_retry(tmp_name, resolved)
    except BaseException as exc:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        return {"ok": False, "error": f"restore write failed: {exc!r}"[:200], "path": str(resolved)}
    return {
        "ok": True,
        "path": str(resolved),
        "restoredFrom": str(backup),
        "safetyBackupPath": safety_path,
    }


async def restore(params: dict[str, Any]) -> dict[str, Any]:
    entries = params.get("entries")
    if not entries:
        single_path = params.get("path")
        single_backup = params.get("backupPath")
        if single_path and single_backup:
            entries = [
                {
                    "path": single_path,
                    "backupPath": single_backup,
                    "expectedSha256": params.get("expectedSha256"),
                }
            ]
        else:
            return {"ok": False, "error": "entries[] or path+backupPath required"}

    results = []
    ok = True
    for entry in entries:
        result = restore_file_raw(
            entry["path"],
            entry["backupPath"],
            expected_sha256=entry.get("expectedSha256"),
        )
        results.append(result)
        ok = ok and bool(result.get("ok"))
    return {"ok": ok, "files": results}
