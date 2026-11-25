"""Model Sync orchestration: status, preview, apply, restore.

Multi-file apply protocol (NEVER claimed to be fully atomic):

1. read ALL snapshots and validate ALL expected sha256 — any mismatch →
   structured 409 conflict, nothing written and no key rows created
2. resolve/reuse/provision per-target install keys (purpose ``model-sync``)
3. for opencode v2, repair the stored credential before file writes when it
   mismatches the configured managed key
4. write in documented order: omp models.yml → omp config.yml →
   opencode secondary purge → opencode primary
5. verify final bytes, then revoke superseded install keys only after success
6. on failure, best-effort rollback from in-memory original bytes and revoke
   newly-created keys that were never activated

Credential handling: target configs receive per-target install keys, never the
legacy local chat token.  Keys are redacted as ``********`` in every preview,
diff, response and log.  Persistent backups are created only by
``write_text_atomic`` for files actually written; backups may contain secrets
and their contents must never be logged.
"""

from __future__ import annotations

import difflib
import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from stitch_backend.domains.ai_proxy.model_sync import key_material as key_material_layer
from stitch_backend.domains.ai_proxy.model_sync import omp as omp_layer
from stitch_backend.domains.ai_proxy.model_sync import opencode as oc_layer
from stitch_backend.domains.ai_proxy.model_sync import opencode_credentials
from stitch_backend.domains.ai_proxy.model_sync.catalog import load_catalog, select_models
from stitch_backend.domains.ai_proxy.model_sync.detection import (
    check_stitch_credential,
    detect_opencode_version,
    probe_omp_binary,
    resolve_opencode_layout,
    resolve_schema,
)
from stitch_backend.domains.ai_proxy.model_sync.opencode_credentials import scrub_secret_values
from stitch_backend.domains.opencode_config.service import (
    _backup_path,
    read_snapshot,
    write_text_atomic,
)

MASK = "********"
KEY_SENTINEL = key_material_layer.KEY_SENTINEL

# documented write order for multi-file apply
WRITE_ORDER = ("omp-models", "omp-config", "opencode-secondary", "opencode-primary")

_JSON_SECRET_RE = re.compile(
    r"(?i)(\"(?:apiKey|api_key|token|secret|password)\"\s*:\s*\")[^\"]*(\")"
)
_YAML_SECRET_RE = re.compile(
    r"(?im)^([+-]?[ \t]*(?:apiKey|api_key|token|secret|password)[ \t]*:[ \t]*)([^\s#][^\n#]*)"
)


def gateway_base_url() -> str:
    from stitch_backend.config import get_settings

    settings = get_settings()
    return f"http://127.0.0.1:{settings.port}{settings.litellm_gateway_model_prefix}"


def gateway_token() -> str | None:
    """Legacy local chat token — used only to detect legacy installs.

    Model Sync no longer provisions this token into target configs.  Per-target
    install keys are the only newly written credential material.
    """
    from stitch_backend.domains.ai_proxy.local_auth import get_cached_local_chat_token

    return get_cached_local_chat_token()


def _redact(text: str, token: str | None, extra_secrets: list[str] | None = None) -> str:
    """Redact exact known keys plus generic JSON/YAML secret assignments."""
    secrets = [value for value in [token, *(extra_secrets or []), KEY_SENTINEL] if value]
    for value in dict.fromkeys(secrets):
        text = text.replace(value, MASK)
    text = _JSON_SECRET_RE.sub(r"\1" + MASK + r"\2", text)
    text = _YAML_SECRET_RE.sub(r"\1" + MASK, text)
    return scrub_secret_values(text)


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

    def diff(self, token: str | None, extra_secrets: list[str] | None = None) -> str:
        old = _redact(self.old_text, token, extra_secrets).splitlines(keepends=True)
        new = _redact(self.new_text, token, extra_secrets).splitlines(keepends=True)
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
    key_materials: dict[str, key_material_layer.KeyMaterial] = field(default_factory=dict)
    configured_keys: dict[str, str | None] = field(default_factory=dict)

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


def extract_target_configured_key(target: str, params: dict[str, Any]) -> str | None:
    """Extract the current stitch apiKey from a target config (internal only)."""
    try:
        if target == "opencode":
            layout = resolve_opencode_layout(
                config_path=params.get("opencodeConfigPath"),
                config_dir=params.get("opencodeConfigDir"),
            )
            if not layout.write_target.exists():
                return None
            return oc_layer.extract_stitch_api_key(read_snapshot(layout.write_target).data)
        if target == "omp":
            profile = omp_layer.resolve_profile(params.get("ompProfile"))
            models_path = (
                Path(params["ompModelsPath"])
                if params.get("ompModelsPath")
                else profile.models_path
            )
            if not models_path.exists():
                return None
            return omp_layer.extract_stitch_api_key_omp(omp_layer.load_yaml_rt(models_path))
    except Exception:
        return None
    return None


async def resolve_key_materials(
    targets: list[str],
    params: dict[str, Any],
    *,
    provision: bool,
) -> tuple[dict[str, key_material_layer.KeyMaterial], dict[str, str | None]]:
    """Plan (readonly) or provision (apply) per-target install keys."""
    legacy_token = gateway_token()
    materials: dict[str, key_material_layer.KeyMaterial] = {}
    configured: dict[str, str | None] = {}
    for target in targets:
        extracted = extract_target_configured_key(target, params)
        configured[target] = extracted
        if provision:
            try:
                materials[target] = await key_material_layer.provision_key_material(
                    target, extracted, legacy_local_token=legacy_token
                )
            except Exception:
                # Provisioning is sequential across targets.  If a later target
                # fails, earlier newly-created keys have never been activated;
                # revoke them best-effort rather than leaking enabled keys.
                created = [
                    material.created_key_id
                    for material in materials.values()
                    if material.created_key_id
                ]
                await key_material_layer.revoke_install_keys(created)
                raise
        else:
            materials[target] = await key_material_layer.plan_key_material(
                target, extracted, legacy_local_token=legacy_token
            )
    return materials, configured


def key_plan_metadata(materials: dict[str, key_material_layer.KeyMaterial]) -> dict[str, Any]:
    return {target: material.public_plan() for target, material in materials.items()}


def build_plan(params: dict[str, Any], catalog: list[dict[str, Any]]) -> SyncPlan:
    """Build the full sync plan shared by preview and apply."""
    key_materials = params.get("_keyMaterials") or {}
    configured_keys = params.get("_configuredKeys") or {}
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
        oc_material = key_materials.get("opencode")
        oc_key = (oc_material.raw if oc_material is not None else None) or KEY_SENTINEL
        oc_plans, oc_warnings, oc_diff = _opencode_file_plans(
            entries,
            base_url,
            oc_key,
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
        omp_material = key_materials.get("omp")
        omp_key = (omp_material.raw if omp_material is not None else None) or KEY_SENTINEL
        omp_plans, omp_warnings, omp_errors, omp_diff = _omp_file_plans(
            entries,
            base_url,
            omp_key,
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
        key_materials=dict(key_materials),
        configured_keys=dict(configured_keys),
    )


# ── command-facing operations ───────────────────────────────────────────────


def _isoformat(value: Any) -> str | None:
    return value.isoformat() if hasattr(value, "isoformat") else None


async def security_key_status(
    params: dict[str, Any],
    materials: dict[str, key_material_layer.KeyMaterial],
    configured_keys: dict[str, str | None],
) -> dict[str, Any]:
    """Metadata-only per-target install-key state for the status surface."""
    keys: dict[str, Any] = {}
    for target in ("opencode", "omp"):
        material = materials.get(target)
        configured = configured_keys.get(target)
        try:
            rows = await key_material_layer.list_key_rows_readonly(target)
        except key_material_layer.KeyMaterialUnavailable:
            rows = []
        selected: Any | None = None
        if material is not None and material.key_id:
            selected = next(
                (row for row in rows if key_material_layer._row_attr(row, "id") == material.key_id),
                None,
            )
        if selected is None:
            enabled_rows = [row for row in rows if key_material_layer._row_attr(row, "enabled")]
            selected = enabled_rows[-1] if enabled_rows else (rows[-1] if rows else None)

        if material is not None and material.action == "reuse":
            configured_state = "managed-install-key"
        elif material is not None and material.legacy_local_token_detected:
            configured_state = "legacy-local-token"
        elif configured:
            configured_state = "unmanaged-key"
        else:
            configured_state = "missing"

        if selected is None:
            info: dict[str, Any] = {
                "state": "missing" if not rows else "unknown",
                "configuredSecretState": configured_state,
                "legacyLocalTokenDetected": bool(material and material.legacy_local_token_detected),
            }
        else:
            token_hash = key_material_layer._row_attr(selected, "token_hash")
            fingerprint = key_material_layer._row_attr(selected, "fingerprint")
            if not isinstance(fingerprint, str) and isinstance(token_hash, str):
                fingerprint = token_hash[:8]
            enabled = bool(key_material_layer._row_attr(selected, "enabled"))
            info = {
                "state": "active" if enabled else "disabled",
                "keyId": key_material_layer._row_attr(selected, "id"),
                "fingerprint": fingerprint,
                "enabled": enabled,
                "createdAt": _isoformat(key_material_layer._row_attr(selected, "created_at")),
                "lastUsedAt": _isoformat(key_material_layer._row_attr(selected, "last_used_at")),
                "configuredSecretState": configured_state,
                "legacyLocalTokenDetected": bool(material and material.legacy_local_token_detected),
            }
        keys[target] = info
    return {"keys": keys}


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

    materials, configured_keys = await resolve_key_materials(
        ["opencode", "omp"], params, provision=False
    )
    configured_key = configured_keys.get("opencode")
    oc_material = materials.get("opencode")
    compare_key = (oc_material.raw if oc_material is not None else None) or configured_key
    credential = await asyncio.to_thread(check_stitch_credential, compare_key)
    if credential["status"] == "credential-mismatch":
        opencode_info["warnings"].append(credential["detail"])
    opencode_info["credential"] = credential
    opencode_info["keyPlan"] = key_plan_metadata(materials).get("opencode")

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
        "security": await security_key_status(params, materials, configured_keys),
    }


async def preview(params: dict[str, Any]) -> dict[str, Any]:
    import asyncio

    catalog, detected = await asyncio.gather(
        load_catalog(), asyncio.to_thread(detect_opencode_version)
    )
    targets = params.get("targets") or ["opencode", "omp"]
    if isinstance(targets, str):
        targets = [targets]
    materials, configured_keys = await resolve_key_materials(list(targets), params, provision=False)
    params = {
        **params,
        "_detectedVersion": detected,
        "_keyMaterials": materials,
        "_configuredKeys": configured_keys,
    }
    plan = build_plan(params, catalog)
    legacy_token = gateway_token()
    exact_secrets = [value for value in configured_keys.values() if value]
    exact_secrets.extend(m.raw for m in materials.values() if m.raw)

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
                "diff": file_plan.diff(legacy_token, exact_secrets),
            }
        )

    warnings = list(plan.warnings)
    if any(f.path.suffix.lower() == ".jsonc" for f in plan.files if f.exists):
        warnings.append("JSONC comments may be dropped on write")
    if "opencode" in targets:
        oc_material = materials.get("opencode")
        compare_key = (oc_material.raw if oc_material is not None else None) or configured_keys.get(
            "opencode"
        )
        credential = await asyncio.to_thread(check_stitch_credential, compare_key)
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
        "keyPlan": key_plan_metadata(materials),
        # never the full generated config — diffs only, keys redacted
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
    """Apply model sync with install-key provisioning and ordered repair.

    Ordering is deliberate: validate every expected sha first, provision/reuse
    install keys second, repair the opencode v2 credential before file writes
    when it mismatches, write files, verify final bytes, and only then revoke
    superseded install keys.  Multi-file rollback remains best-effort, never a
    claim of atomicity.
    """
    # Presence of the legacy local token is still the practical "gateway is up"
    # signal in this codebase, but it is never provisioned into targets anymore.
    if not gateway_token():
        return {"ok": False, "error": "gateway is not running — start the AI proxy first"}

    expected = params.get("expectedSha256")
    if not isinstance(expected, dict) or not expected:
        return {
            "ok": False,
            "error": "expectedSha256 map required — obtain it from model_sync_preview",
        }

    import asyncio

    targets = params.get("targets") or ["opencode", "omp"]
    if isinstance(targets, str):
        targets = [targets]
    targets = list(targets)

    detected = await asyncio.to_thread(detect_opencode_version)
    base_params = {**params, "_detectedVersion": detected}
    catalog = await load_catalog()

    # Build once with read-only key material solely to establish the file set
    # and validate input hashes.  Preview/validation never creates key rows.
    planned_materials, configured_keys = await resolve_key_materials(
        targets, base_params, provision=False
    )
    planning_params = {
        **base_params,
        "_keyMaterials": planned_materials,
        "_configuredKeys": configured_keys,
    }
    validation_plan = build_plan(planning_params, catalog)
    if validation_plan.errors:
        return {"ok": False, "errors": validation_plan.errors, "warnings": validation_plan.warnings}
    if not validation_plan.files:
        return {"ok": False, "error": "nothing to write"}

    # 1. validate ALL expected sha256 before provisioning or writing anything
    mismatches = _validate_expected_sha(validation_plan, expected)
    if mismatches:
        return {
            "ok": False,
            "error": "conflict",
            "status": 409,
            "mismatches": mismatches,
        }

    # 2. resolve/reuse/provision per-target install keys (DB writes happen only now)
    try:
        materials, configured_keys = await resolve_key_materials(
            targets, base_params, provision=True
        )
    except key_material_layer.KeyMaterialUnavailable as exc:
        return {"ok": False, "error": str(exc), "code": "key-provisioning-unavailable"}

    missing = [target for target, material in materials.items() if not material.raw]
    if missing:
        return {
            "ok": False,
            "error": "install key provisioning did not return key material for: "
            + ", ".join(missing),
            "code": "key-provisioning-incomplete",
        }

    final_params = {
        **base_params,
        "_keyMaterials": materials,
        "_configuredKeys": configured_keys,
    }
    plan = build_plan(final_params, catalog)
    if plan.errors:
        return {"ok": False, "errors": plan.errors, "warnings": plan.warnings}

    # Files are not supposed to change during provisioning.  Re-check before
    # using the rebuilt snapshots; a conflict here activates nothing, so any
    # just-created keys are safe to revoke.
    mismatches = _validate_expected_sha(plan, expected)
    if mismatches:
        created_ids = [m.created_key_id for m in materials.values() if m.created_key_id]
        revoke_errors = await key_material_layer.revoke_install_keys(created_ids)
        out: dict[str, Any] = {
            "ok": False,
            "error": "conflict",
            "status": 409,
            "mismatches": mismatches,
            "revokedCreatedKeyIds": created_ids,
        }
        if revoke_errors:
            out["warnings"] = revoke_errors
        return out

    warnings = list(plan.warnings)
    credential_repair: dict[str, Any] | None = None
    credential_activated = False

    # 3. opencode v2 credential repair precedes file writes when mismatched.
    if "opencode" in targets and plan.schema == "v2":
        oc_material = materials["opencode"]
        assert oc_material.raw is not None  # guaranteed by the missing check above
        prior = await asyncio.to_thread(check_stitch_credential, oc_material.raw)
        if prior.get("status") in {"credential-mismatch", "no-credential", "no-database"}:
            repair = await asyncio.to_thread(
                opencode_credentials.repair_stitch_credential,
                oc_material.raw,
                config_path=params.get("opencodeConfigPath"),
                stale_key_hashes=set(oc_material.stale_key_hashes),
            )
            credential_repair = repair
            if repair.get("ok"):
                credential_activated = True
            elif prior.get("status") == "credential-mismatch":
                # A mismatch means the target would authenticate with the wrong
                # credential even if files were written — hard failure by policy.
                created_ids = [m.created_key_id for m in materials.values() if m.created_key_id]
                revoke_errors = await key_material_layer.revoke_install_keys(created_ids)
                out = {
                    "ok": False,
                    "error": "opencode credential repair failed: "
                    + str(repair.get("error", "unknown"))[:220],
                    "code": repair.get("code") or "credential-repair-failed",
                    "credentialRepair": repair,
                    "revokedCreatedKeyIds": created_ids,
                    "partialState": {"filesWritten": False, "credentialActivated": False},
                }
                if revoke_errors:
                    out["warnings"] = revoke_errors
                return out
            else:
                # no-credential/no-database is a partial warning when the CLI is
                # absent or cannot help; file sync can still be useful for v1
                # fallback/normalization flows.
                warnings.append(
                    "opencode credential repair incomplete: "
                    + str(repair.get("error", "unknown"))[:180]
                )

    # Keep original bytes in memory for rollback.  Do NOT create physical
    # up-front copies: write_text_atomic creates exactly one persistent backup
    # for each file it actually writes.
    original_bytes: dict[str, bytes] = {}
    for file_plan in plan.files:
        key = str(file_plan.path)
        if file_plan.path.exists():
            original_bytes[key] = file_plan.path.read_bytes()

    # 4. write in documented order; 5. verify final state; rollback on failure
    results: list[dict[str, Any]] = []
    written: list[FilePlan] = []
    failure: str | None = None
    for file_plan in plan.files:
        key = str(file_plan.path)
        entry: dict[str, Any] = {
            "path": key,
            "kind": file_plan.kind,
            "written": False,
            "backupPath": None,
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

    if failure is None:
        for file_plan in written:
            try:
                final_text = file_plan.path.read_text(encoding="utf-8")
            except OSError as exc:
                failure = f"{file_plan.path}: final verification read failed: {exc!r}"[:300]
                break
            if final_text != file_plan.new_text:
                failure = f"{file_plan.path}: final verification mismatch"[:300]
                break

    if failure is not None:
        # best-effort rollback of already-written files — NEVER full atomicity
        rollback_complete = True
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
                rollback_complete = False
                for entry in results:
                    if entry["path"] == key:
                        entry["rollbackError"] = str(exc)[:200]

        # Revoke newly-created keys only when they were never activated.  A
        # successful credential repair activates the opencode key even if file
        # rollback later succeeds; a rollback error means file activation is
        # uncertain and the key is retained rather than breaking the target.
        uncertain_targets = {
            file_plan.target
            for file_plan in written
            if any(
                entry["path"] == str(file_plan.path) and entry.get("rollbackError")
                for entry in results
            )
        }
        if credential_activated:
            uncertain_targets.add("opencode")
        created_ids = [
            m.created_key_id
            for target, m in materials.items()
            if m.created_key_id and target not in uncertain_targets
        ]
        revoke_errors = await key_material_layer.revoke_install_keys(created_ids)
        out = {
            "ok": False,
            "error": f"apply failed, rolled back written files (best-effort): {failure}",
            "files": results,
            "warnings": warnings,
            "partialState": {
                "filesLeftBehind": not rollback_complete,
                "credentialActivated": credential_activated,
                "uncertainTargets": sorted(uncertain_targets),
            },
            "revokedCreatedKeyIds": created_ids,
        }
        if credential_repair is not None:
            out["credentialRepair"] = credential_repair
        if revoke_errors:
            out["warnings"] = [*warnings, *revoke_errors]
        return out

    # 6. only after verified final state, revoke superseded install keys
    superseded = sorted(
        {key_id for material in materials.values() for key_id in material.superseded_key_ids}
    )
    revoke_errors = await key_material_layer.revoke_install_keys(superseded)
    if revoke_errors:
        warnings.extend(revoke_errors)

    key_results = {
        target: {
            "action": material.action,
            "fingerprint": material.fingerprint[:8] if material.fingerprint else None,
            "created": bool(material.created_key_id),
        }
        for target, material in materials.items()
    }
    out = {
        "ok": True,
        "files": results,
        "warnings": warnings,
        "schema": plan.schema,
        "modelDiffs": plan.model_diffs,
        "keys": key_results,
        "revokedSupersededKeyIds": superseded,
    }
    if credential_repair is not None:
        out["credentialRepair"] = credential_repair
    return out


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
