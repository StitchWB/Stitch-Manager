"""Generic probe for an arbitrary OpenAI-compatible endpoint."""

from __future__ import annotations

import time
from typing import Any

import httpx

from stitch_backend.core.command_registry import register_command
from stitch_backend.domains.ai_gateway.adapters.utils import _sanitize_error
from stitch_backend.domains.ai_gateway.schemas import ProbeEndpointRequest


def _auth_headers(api_key: str | None) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}"} if api_key else {}


def _parse_models(resp: httpx.Response) -> list[str]:
    try:
        data = resp.json()
    except ValueError:
        return []
    items = data.get("data", []) if isinstance(data, dict) else []
    return [item["id"] for item in items if isinstance(item, dict) and item.get("id")]


def _chat_body(model: str, prompt: str | None, image_url: str | None) -> dict[str, Any]:
    text = prompt or "ping"
    if image_url:
        content: Any = [
            {"type": "text", "text": text},
            {"type": "image_url", "image_url": {"url": image_url}},
        ]
    else:
        content = text
    return {"model": model, "messages": [{"role": "user", "content": content}]}


async def _probe_chat(
    client: httpx.AsyncClient, req: ProbeEndpointRequest, result: dict[str, Any],
) -> None:
    start = time.monotonic()
    try:
        resp = await client.post(
            f"{req.base_url}/chat/completions",
            headers=_auth_headers(req.api_key),
            json=_chat_body(req.model or "", req.prompt, req.image_url),
        )
    except Exception as exc:
        result["chatLatencyMs"] = int((time.monotonic() - start) * 1000)
        result["chatOk"] = False
        if req.image_url:
            result["multimodalOk"] = False
        if result["error"] is None:
            result["error"] = _sanitize_error(exc, req.api_key or "")
        return

    result["chatLatencyMs"] = int((time.monotonic() - start) * 1000)
    ok = resp.status_code == 200
    result["chatOk"] = ok
    if req.image_url:
        result["multimodalOk"] = ok
    if not ok and result["error"] is None:
        result["error"] = f"HTTP {resp.status_code}"


# two sequential HTTP probes can exceed the dispatcher's 25s default; the client enforces its own timeout
@register_command("probe_endpoint", readonly=True, timeout=-1)
async def cmd_probe_endpoint(params: dict) -> dict:
    """Probe an arbitrary OpenAI-compatible endpoint: reachability, auth, models, latency."""
    req = ProbeEndpointRequest.model_validate(params)
    result: dict[str, Any] = {
        "reachable": False,
        "statusCode": None,
        "authOk": None,
        "latencyMs": None,
        "models": [],
        "error": None,
    }

    start = time.monotonic()
    try:
        async with httpx.AsyncClient(
            timeout=req.timeout_seconds, follow_redirects=False
        ) as client:
            resp = await client.get(
                f"{req.base_url}/models",
                headers=_auth_headers(req.api_key),
            )
            result["latencyMs"] = int((time.monotonic() - start) * 1000)
            result["statusCode"] = resp.status_code
            result["reachable"] = True
            if resp.status_code == 200:
                result["authOk"] = True
                result["models"] = _parse_models(resp)
            elif resp.status_code in (401, 403):
                result["authOk"] = False
            else:
                result["error"] = f"HTTP {resp.status_code}"

            if req.model:
                await _probe_chat(client, req, result)
            elif req.image_url:
                result["multimodalOk"] = None
    except Exception as exc:
        if result["latencyMs"] is None:
            result["latencyMs"] = int((time.monotonic() - start) * 1000)
        if result["error"] is None:
            result["error"] = _sanitize_error(exc, req.api_key or "")

    return result
