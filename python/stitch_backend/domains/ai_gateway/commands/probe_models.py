"""Batch model probe for one endpoint or credential — one parallel sweep to a health table."""

from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING, Any

from stitch_backend.core.command_decorator import command
from stitch_backend.domains.ai_gateway.adapters.base import get_adapter
from stitch_backend.domains.ai_gateway.schemas.probe_models import (
    ProbeEndpointModelsRequest,
)
from stitch_backend.domains.ai_gateway.service import (
    CredentialService,
    ProviderEndpointService,
    UpstreamModelService,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from stitch_backend.domains.ai_gateway.adapters.base import ProviderAdapter

# 16x16 solid-red PNG: deterministic vision probe, no outbound fetch.
VISION_PROBE_IMAGE = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mP4z8BAEmIY1TCqYfhqAACQ+f8B8u7oVwAAAABJRU5ErkJggg=="
)
VISION_PROBE_PROMPT = "What color is this image? Reply with one word."
VISION_PROBE_ANSWER = "red"
DEFAULT_PROBE_PROMPT = "ping"
TEXT_CAP = 300


def _extract_text(data: Any) -> str | None:
    if not isinstance(data, dict):
        return None
    choices = data.get("choices")
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        message = choices[0].get("message")
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, str):
                return content
    return None


def _messages(prompt: str, image_url: str | None) -> list[dict[str, Any]]:
    if image_url:
        content: Any = [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": image_url}},
        ]
    else:
        content = prompt
    return [{"role": "user", "content": content}]


def _redact(text: str, secret: str) -> str:
    if secret and secret in text:
        text = text.replace(secret, "***REDACTED***")
    return text[:TEXT_CAP]


async def _probe_one(
    adapter: ProviderAdapter,
    *,
    base_url: str,
    secret: str,
    default_headers: dict[str, str] | None,
    model: str,
    max_tokens: int,
    prompt: str | None,
    image_url: str | None,
) -> dict[str, Any]:
    start = time.monotonic()
    question = VISION_PROBE_PROMPT if image_url else (prompt or DEFAULT_PROBE_PROMPT)
    try:
        data = await adapter.invoke(
            base_url=base_url,
            secret=secret,
            model=model,
            messages=_messages(question, image_url),
            stream=False,
            default_headers=default_headers,
            max_tokens=max_tokens,
        )
    except Exception as exc:
        classified = adapter.classify_error(exc)
        return {
            "model": model,
            "ok": False,
            "reason": classified.category,
            "latencyMs": int((time.monotonic() - start) * 1000),
            "multimodalOk": False if image_url else None,
            "text": None,
        }

    text = _extract_text(data)
    row: dict[str, Any] = {
        "model": model,
        "ok": True,
        "reason": "ok",
        "latencyMs": int((time.monotonic() - start) * 1000),
        "multimodalOk": None,
        "text": _redact(text, secret) if text else None,
    }
    if image_url:
        row["multimodalOk"] = text is not None and VISION_PROBE_ANSWER in text.lower()
    return row


async def probe_models(
    adapter: ProviderAdapter,
    *,
    base_url: str,
    secret: str,
    default_headers: dict[str, str] | None,
    models: list[str],
    concurrency: int,
    max_tokens: int,
    prompt: str | None,
    vision_models: list[str] | None,
    include_multimodal: bool,
    budget: float,
) -> list[dict[str, Any]]:
    """Probe every model in parallel (bounded) and return one health row each."""
    vision = set(vision_models or ())
    semaphore = asyncio.Semaphore(concurrency)
    deadline = time.monotonic() + budget

    async def _one(model: str) -> dict[str, Any]:
        async with semaphore:
            if time.monotonic() >= deadline:
                return {
                    "model": model,
                    "ok": False,
                    "reason": "budget_exhausted",
                    "latencyMs": None,
                    "multimodalOk": None,
                    "text": None,
                }
            wants_image = include_multimodal or model in vision
            return await _probe_one(
                adapter,
                base_url=base_url,
                secret=secret,
                default_headers=default_headers,
                model=model,
                max_tokens=max_tokens,
                prompt=prompt,
                image_url=VISION_PROBE_IMAGE if wants_image else None,
            )

    outcomes = await asyncio.gather(*(_one(m) for m in models), return_exceptions=True)
    rows: list[dict[str, Any]] = []
    for model, outcome in zip(models, outcomes, strict=True):
        if isinstance(outcome, BaseException):
            rows.append({
                "model": model,
                "ok": False,
                "reason": "unknown",
                "latencyMs": None,
                "multimodalOk": None,
                "text": None,
            })
        else:
            rows.append(outcome)
    return rows


def _endpoint_context(endpoint: Any, credential_id: str, secret: str) -> dict[str, Any]:
    return {
        "endpoint_id": endpoint.id,
        "credential_id": credential_id,
        "adapter_type": endpoint.adapter_type,
        "base_url": endpoint.base_url,
        "default_headers": endpoint.default_headers,
        "secret": secret,
    }


async def _resolve_target(
    db: AsyncSession, req: ProbeEndpointModelsRequest
) -> dict[str, Any] | None:
    endpoint_svc = ProviderEndpointService(db)
    cred_svc = CredentialService(db)

    if req.credential_id:
        credential = await cred_svc.get_by_pk(req.credential_id)
        if credential is None:
            return None
        endpoint = await endpoint_svc.get_by_pk(credential.provider_endpoint_id)
        secret = await cred_svc.get_secret_for_invocation(credential.id)
        if endpoint is None or not secret:
            return None
        return _endpoint_context(endpoint, credential.id, secret)

    if req.endpoint_id:
        endpoint = await endpoint_svc.get_by_pk(req.endpoint_id)
        if endpoint is None:
            return None
        credentials = await cred_svc.list_all_credentials(provider_endpoint_id=endpoint.id)
        usable = next(
            (c for c in credentials if c.enabled and c.runtime_status == "active"), None
        ) or next((c for c in credentials if c.enabled), None)
        if usable is None:
            return None
        secret = await cred_svc.get_secret_for_invocation(usable.id)
        if not secret:
            return None
        return _endpoint_context(endpoint, usable.id, secret)

    if not req.base_url:
        return None
    return {
        "endpoint_id": None,
        "credential_id": None,
        "adapter_type": req.adapter_type or "openai_compatible",
        "base_url": req.base_url.strip().rstrip("/"),
        "default_headers": None,
        "secret": req.api_key or "",
    }


async def _resolve_models(
    db: AsyncSession, req: ProbeEndpointModelsRequest, target: dict[str, Any]
) -> list[str]:
    if req.models:
        models = list(req.models)
    else:
        models = []
        if target["endpoint_id"]:
            rows = await UpstreamModelService(db).list_models(target["endpoint_id"])
            models = [row.upstream_model_id for row in rows if row.enabled]
        if not models:
            adapter = get_adapter(target["adapter_type"])
            try:
                models = await adapter.list_models(
                    base_url=target["base_url"],
                    secret=target["secret"],
                    default_headers=target["default_headers"],
                )
            except Exception:
                models = []
    if req.filter_prefix:
        models = [m for m in models if m.startswith(req.filter_prefix)]
    return models


@command(
    "probe_endpoint_models",
    readonly=True,
    request=ProbeEndpointModelsRequest,
    timeout=-1,
)
async def cmd_probe_endpoint_models(
    db: AsyncSession, req: ProbeEndpointModelsRequest
) -> dict:
    """Probe every (or filtered) model of an endpoint in a single parallel sweep."""
    target = await _resolve_target(db, req)
    if target is None:
        return {"ok": False, "error": "target not found or has no usable credential"}

    catalog = await _resolve_models(db, req, target)
    selected = catalog[: req.limit] if req.limit > 0 else list(catalog)
    rows = await probe_models(
        get_adapter(target["adapter_type"]),
        base_url=target["base_url"],
        secret=target["secret"],
        default_headers=target["default_headers"],
        models=selected,
        concurrency=req.concurrency,
        max_tokens=req.max_tokens,
        prompt=req.prompt,
        vision_models=req.vision_models,
        include_multimodal=req.include_multimodal,
        budget=req.budget_seconds,
    )
    return {
        "ok": True,
        "endpointId": target["endpoint_id"],
        "credentialId": target["credential_id"],
        "catalogCount": len(catalog),
        "probedCount": sum(1 for row in rows if row["ok"]),
        "truncated": len(catalog) > len(selected),
        "models": rows,
    }
