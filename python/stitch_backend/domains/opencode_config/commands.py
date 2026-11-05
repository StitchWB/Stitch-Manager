"""opencode / OMO config commands: read, provider upsert, agent assign, models report, balance, reconcile."""

from __future__ import annotations

from typing import Any

import httpx

from stitch_backend.core.command_registry import register_command
from stitch_backend.domains.opencode_config import probe as probe_layer
from stitch_backend.domains.opencode_config.schemas import (
    OpenCodeAgentAssignRequest,
    OpenCodeConfigGetRequest,
    OpenCodeModelsReconcileRequest,
    OpenCodeModelsReportRequest,
    OpenCodeProviderUpsertRequest,
    ProviderBalanceRequest,
)
from stitch_backend.domains.opencode_config.service import (
    BUILTIN_AGENTS,
    OMO_SECTION,
    default_omo_path,
    default_opencode_path,
    normalize_omo,
    normalize_opencode,
    provider_model_ids,
    read_snapshot,
    resolve_provider_endpoint,
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


def _resolve_target(req: Any) -> tuple[str | None, str | None]:
    """Return ``(baseURL, apiKey)`` from explicit fields or the opencode config."""
    if req.base_url:
        return req.base_url.strip().rstrip("/"), req.api_key
    if not req.provider:
        return None, None
    snapshot = read_snapshot(req.opencode_path or default_opencode_path())
    base_url, api_key = resolve_provider_endpoint(snapshot, req.provider)
    return (base_url.rstrip("/") if base_url else None), (req.api_key or api_key)


@register_command("opencode_models_report", readonly=True, timeout=-1)
async def cmd_opencode_models_report(params: dict) -> dict:
    """Report a provider's models: catalog, plus optional parallel probes."""
    try:
        req = OpenCodeModelsReportRequest.model_validate(params)
        base_url, api_key = _resolve_target(req)
        if not base_url:
            return {"ok": False, "error": "no endpoint: pass baseUrl or an existing provider"}
        async with httpx.AsyncClient(follow_redirects=False) as client:
            report = await probe_layer.report_models(
                client,
                base_url=base_url,
                api_key=api_key,
                mode=req.mode,
                limit=req.limit,
                concurrency=req.concurrency,
                timeout=req.timeout_seconds,
                budget=req.budget_seconds,
                vision_shortlist=req.vision_shortlist,
                prompt=req.prompt,
            )
        return {"ok": True, "provider": req.provider, **report}
    except Exception as exc:
        return {"ok": False, "error": _error(exc)}


@register_command("provider_balance", readonly=True, timeout=-1)
async def cmd_provider_balance(params: dict) -> dict:
    """Best-effort account balance for a known vendor (OpenRouter, DeepSeek)."""
    try:
        req = ProviderBalanceRequest.model_validate(params)
        base_url, api_key = _resolve_target(req)
        if not base_url:
            return {"ok": False, "error": "no endpoint: pass baseUrl or an existing provider"}
        async with httpx.AsyncClient(follow_redirects=False) as client:
            info = await probe_layer.fetch_balance(
                client, base_url, api_key, req.timeout_seconds
            )
        return {"ok": True, "provider": req.provider, "baseUrl": base_url, **info}
    except Exception as exc:
        return {"ok": False, "error": _error(exc)}


@register_command("opencode_models_reconcile", timeout=-1)
async def cmd_opencode_models_reconcile(params: dict) -> dict:
    """Diff a provider's configured models against its live catalog; write on apply."""
    try:
        req = OpenCodeModelsReconcileRequest.model_validate(params)
        path = req.opencode_path or default_opencode_path()
        snapshot = read_snapshot(path)
        if req.provider not in (snapshot.data.get("provider") or {}):
            return {"ok": False, "error": f"provider not in config: {req.provider}"}
        base_url, api_key = _resolve_target(req)
        if not base_url:
            return {"ok": False, "error": "no endpoint: pass baseUrl or an existing provider"}

        async with httpx.AsyncClient(follow_redirects=False) as client:
            live_ids, error = await probe_layer.live_model_ids(
                client, base_url, api_key, req.timeout_seconds
            )
        if live_ids is None:
            return {"ok": False, "error": error or "catalog unavailable"}

        current = provider_model_ids(snapshot, req.provider)
        live = set(live_ids)
        to_add = [m for m in live_ids if m not in current]
        to_remove = [m for m in current if m not in live] if req.prune else []
        diff = {
            "path": str(path),
            "provider": req.provider,
            "liveCount": len(live_ids),
            "configuredCount": len(current),
            "toAdd": to_add,
            "toRemove": to_remove,
            "unchanged": [m for m in current if m in live],
        }
        if not req.apply:
            return {"ok": True, "dryRun": True, **diff}

        data = dict(snapshot.data)
        providers = dict(data.get("provider") or {})
        entry = dict(providers.get(req.provider) or {})
        models = dict(entry.get("models") or {})
        for model_id in to_add:
            models.setdefault(model_id, {})
        for model_id in to_remove:
            models.pop(model_id, None)
        entry["models"] = models
        providers[req.provider] = entry
        data["provider"] = providers

        result = write_config(path, data, expected_sha256=snapshot.sha256)
        if not result.get("ok"):
            return result
        return {
            "ok": True,
            "dryRun": False,
            "provider": req.provider,
            "added": to_add,
            "removed": to_remove,
            "path": result["path"],
            "backupPath": result["backupPath"],
            "commentsMayBeDropped": result["commentsMayBeDropped"],
        }
    except Exception as exc:
        return {"ok": False, "error": _error(exc)}
