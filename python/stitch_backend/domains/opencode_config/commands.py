"""opencode / OMO config commands: normalized read, provider upsert, agent assign."""

from __future__ import annotations

from typing import Any

from stitch_backend.core.command_registry import register_command
from stitch_backend.domains.opencode_config.schemas import (
    OpenCodeAgentAssignRequest,
    OpenCodeConfigGetRequest,
    OpenCodeProviderUpsertRequest,
)
from stitch_backend.domains.opencode_config.service import (
    BUILTIN_AGENTS,
    OMO_SECTION,
    default_omo_path,
    default_opencode_path,
    normalize_omo,
    normalize_opencode,
    read_snapshot,
    write_config,
)


def _error(exc: BaseException) -> str:
    return str(exc)[:200]


def _normalize_models(models: dict[str, Any] | list[str]) -> dict[str, Any]:
    if isinstance(models, dict):
        return models
    return {model_id: {} for model_id in models}


@register_command("opencode_config_get", readonly=True)
async def cmd_opencode_config_get(params: dict) -> dict:
    """Read both config stores, normalized and with api keys masked."""
    try:
        req = OpenCodeConfigGetRequest.model_validate(params)
        opencode = read_snapshot(req.opencode_path or default_opencode_path())
        omo = read_snapshot(req.omo_path or default_omo_path())
        return {
            "ok": True,
            "opencode": normalize_opencode(opencode),
            "omo": normalize_omo(omo),
        }
    except Exception as exc:
        return {"ok": False, "error": _error(exc)}


@register_command("opencode_provider_upsert")
async def cmd_opencode_provider_upsert(params: dict) -> dict:
    """Add or update a provider in the opencode config."""
    try:
        req = OpenCodeProviderUpsertRequest.model_validate(params)
        path = req.opencode_path or default_opencode_path()
        snapshot = read_snapshot(path)
        data = dict(snapshot.data)
        providers = dict(data.get("provider") or {})
        entry = dict(providers.get(req.id) or {})
        entry["name"] = req.name
        entry["npm"] = req.npm
        options = dict(entry.get("options") or {})
        options["baseURL"] = req.base_url
        if req.api_key is not None:
            options["apiKey"] = req.api_key
        if req.headers is not None:
            options["headers"] = req.headers
        entry["options"] = options
        if req.models is not None:
            entry["models"] = _normalize_models(req.models)
        providers[req.id] = entry
        data["provider"] = providers
        result = write_config(path, data, expected_sha256=snapshot.sha256)
        if not result.get("ok"):
            return result
        return {
            "ok": True,
            "providerId": req.id,
            "path": result["path"],
            "backupPath": result["backupPath"],
            "commentsMayBeDropped": result["commentsMayBeDropped"],
        }
    except Exception as exc:
        return {"ok": False, "error": _error(exc)}


@register_command("opencode_agent_assign")
async def cmd_opencode_agent_assign(params: dict) -> dict:
    """Set an agent's model in the store that wins for that agent."""
    try:
        req = OpenCodeAgentAssignRequest.model_validate(params)
        target = req.target
        if target == "auto":
            target = "omo" if req.agent in BUILTIN_AGENTS else "opencode"
        if target == "omo":
            path = req.omo_path or default_omo_path()
            snapshot = read_snapshot(path)
            data = dict(snapshot.data)
            section = dict(data.get(OMO_SECTION) or {})
            agents = dict(section.get("agents") or {})
            entry = dict(agents.get(req.agent) or {})
            entry["model"] = req.model
            if req.fallback_models is not None:
                entry["fallback_models"] = req.fallback_models
            agents[req.agent] = entry
            section["agents"] = agents
            data[OMO_SECTION] = section
        else:
            path = req.opencode_path or default_opencode_path()
            snapshot = read_snapshot(path)
            data = dict(snapshot.data)
            agents = dict(data.get("agent") or {})
            entry = dict(agents.get(req.agent) or {})
            entry["model"] = req.model
            agents[req.agent] = entry
            data["agent"] = agents
        result = write_config(path, data, expected_sha256=snapshot.sha256)
        if not result.get("ok"):
            return result
        return {
            "ok": True,
            "agent": req.agent,
            "target": target,
            "model": req.model,
            "path": result["path"],
            "backupPath": result["backupPath"],
            "commentsMayBeDropped": result["commentsMayBeDropped"],
        }
    except Exception as exc:
        return {"ok": False, "error": _error(exc)}
