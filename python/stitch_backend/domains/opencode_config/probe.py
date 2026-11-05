"""Network layer for opencode model reporting and provider balance.

Kept apart from service.py (which stays a pure file layer) so every HTTP call
sits in one place and every error passes through a single key sanitizer.
"""

from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

from stitch_backend.domains.ai_gateway.adapters.utils import _sanitize_error

if TYPE_CHECKING:
    import httpx

DEFAULT_PROBE_PROMPT = "ping"

# 1x1 PNG: self-contained vision probe payload, no outbound fetch.
VISION_PROBE_IMAGE = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)

# host fragment -> balance endpoint path, relative to the URL origin
BALANCE_PATHS: tuple[tuple[str, str], ...] = (
    ("openrouter.ai", "/api/v1/key"),
    ("api.deepseek.com", "/user/balance"),
)


def auth_headers(api_key: str | None) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}"} if api_key else {}


def parse_model_ids(payload: Any) -> list[str]:
    items = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        return []
    return [item["id"] for item in items if isinstance(item, dict) and item.get("id")]


def _chat_body(model: str, prompt: str | None, image_url: str | None) -> dict[str, Any]:
    text = prompt or DEFAULT_PROBE_PROMPT
    if image_url:
        content: Any = [
            {"type": "text", "text": text},
            {"type": "image_url", "image_url": {"url": image_url}},
        ]
    else:
        content = text
    return {"model": model, "messages": [{"role": "user", "content": content}]}


async def probe_model(
    client: httpx.AsyncClient,
    base_url: str,
    api_key: str | None,
    model: str,
    *,
    prompt: str | None,
    image_url: str | None,
    timeout: float,
) -> dict[str, Any]:
    """One chat request for a model; never raises, always returns a status dict."""
    start = time.monotonic()
    try:
        resp = await client.post(
            f"{base_url}/chat/completions",
            headers=auth_headers(api_key),
            json=_chat_body(model, prompt, image_url),
            timeout=timeout,
        )
    except Exception as exc:
        out: dict[str, Any] = {
            "probed": True,
            "chatOk": False,
            "latencyMs": int((time.monotonic() - start) * 1000),
            "error": _sanitize_error(exc, api_key or ""),
        }
        if image_url:
            out["multimodalOk"] = False
        return out

    ok = resp.status_code == 200
    out = {
        "probed": True,
        "chatOk": ok,
        "latencyMs": int((time.monotonic() - start) * 1000),
    }
    if image_url:
        out["multimodalOk"] = ok
    if not ok:
        out["error"] = f"HTTP {resp.status_code}"
    return out


async def live_model_ids(
    client: httpx.AsyncClient, base_url: str, api_key: str | None, timeout: float
) -> tuple[list[str] | None, str | None]:
    """Fetch ``GET /models``; returns ``(ids, None)`` or ``(None, error)``."""
    try:
        resp = await client.get(
            f"{base_url}/models", headers=auth_headers(api_key), timeout=timeout
        )
    except Exception as exc:
        return None, _sanitize_error(exc, api_key or "")
    if resp.status_code != 200:
        return None, f"HTTP {resp.status_code}"
    try:
        return parse_model_ids(resp.json()), None
    except ValueError:
        return [], None


async def report_models(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    api_key: str | None,
    mode: str,
    limit: int,
    concurrency: int,
    timeout: float,
    budget: float,
    vision_shortlist: list[str] | None,
    prompt: str | None,
) -> dict[str, Any]:
    """Catalog plus, in ``probe`` mode, parallel per-model chat probes."""
    result: dict[str, Any] = {
        "mode": mode,
        "baseUrl": base_url,
        "authOk": None,
        "statusCode": None,
        "catalogLatencyMs": None,
        "modelCount": 0,
        "models": [],
        "probedCount": 0,
        "unprobedCount": 0,
        "truncated": False,
        "error": None,
    }

    start = time.monotonic()
    try:
        resp = await client.get(
            f"{base_url}/models", headers=auth_headers(api_key), timeout=timeout
        )
    except Exception as exc:
        result["catalogLatencyMs"] = int((time.monotonic() - start) * 1000)
        result["error"] = _sanitize_error(exc, api_key or "")
        return result

    result["catalogLatencyMs"] = int((time.monotonic() - start) * 1000)
    result["statusCode"] = resp.status_code
    if resp.status_code in (401, 403):
        result["authOk"] = False
        return result
    if resp.status_code != 200:
        result["error"] = f"HTTP {resp.status_code}"
        return result

    result["authOk"] = True
    try:
        ids = parse_model_ids(resp.json())
    except ValueError:
        ids = []
    result["modelCount"] = len(ids)

    entries: list[dict[str, Any]] = [{"id": m, "probed": False} for m in ids]
    to_probe = ids[:limit] if (mode == "probe" and limit > 0) else []
    result["truncated"] = bool(to_probe) and len(ids) > len(to_probe)

    if to_probe:
        vision = set(vision_shortlist or ())
        semaphore = asyncio.Semaphore(concurrency)
        deadline = time.monotonic() + budget

        async def _one(model: str) -> dict[str, Any]:
            async with semaphore:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return {"id": model, "probed": False, "skippedReason": "budget"}
                info = await probe_model(
                    client,
                    base_url,
                    api_key,
                    model,
                    prompt=prompt,
                    image_url=VISION_PROBE_IMAGE if model in vision else None,
                    timeout=min(timeout, remaining),
                )
                return {"id": model, **info}

        outcomes = await asyncio.gather(
            *(_one(m) for m in to_probe), return_exceptions=True
        )
        probed: dict[str, dict[str, Any]] = {}
        for model, outcome in zip(to_probe, outcomes, strict=True):
            if isinstance(outcome, BaseException):
                probed[model] = {
                    "id": model,
                    "probed": False,
                    "error": _sanitize_error(outcome, api_key or ""),
                }
            else:
                probed[model] = outcome
        entries = [probed.get(entry["id"], entry) for entry in entries]

    result["models"] = entries
    result["probedCount"] = sum(1 for entry in entries if entry.get("probed"))
    result["unprobedCount"] = len(entries) - result["probedCount"]
    return result


def _balance_target(base_url: str) -> tuple[str, str] | None:
    parsed = urlparse(base_url)
    host = parsed.hostname or ""
    for needle, path in BALANCE_PATHS:
        if host == needle or host.endswith(f".{needle}"):
            return f"{parsed.scheme}://{parsed.netloc}{path}", needle
    return None


async def fetch_balance(
    client: httpx.AsyncClient, base_url: str, api_key: str | None, timeout: float
) -> dict[str, Any]:
    """Best-effort balance for a known vendor; ``supported=False`` otherwise."""
    target = _balance_target(base_url)
    if target is None:
        return {
            "supported": False,
            "vendor": None,
            "statusCode": None,
            "balance": None,
            "error": None,
        }
    url, vendor = target
    try:
        resp = await client.get(url, headers=auth_headers(api_key), timeout=timeout)
    except Exception as exc:
        return {
            "supported": True,
            "vendor": vendor,
            "statusCode": None,
            "balance": None,
            "error": _sanitize_error(exc, api_key or ""),
        }

    balance = None
    if resp.status_code == 200:
        try:
            payload = resp.json()
        except ValueError:
            payload = None
        if isinstance(payload, dict):
            data = payload.get("data")
            balance = data if data is not None else payload
    return {
        "supported": True,
        "vendor": vendor,
        "statusCode": resp.status_code,
        "balance": balance,
        "error": None if resp.status_code == 200 else f"HTTP {resp.status_code}",
    }
