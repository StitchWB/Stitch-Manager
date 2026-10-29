"""Model ID mapping and Kiro model fetching.

map_model_id: (model: str) -> str, used by translators via `from ...upstream.models import map_model_id`.
fetch_kiro_models: async httpx for ListAvailableModels, with capability detection.
"""

from __future__ import annotations

import re
from typing import Any, TypedDict, cast

import httpx

# ── Model ID map ─────────────────────────────────────────────────────────────

_MODEL_ID_MAP: dict[str, str] = {
    "claude-sonnet-4-5": "claude-sonnet-4.5",
    "claude-sonnet-4.5": "claude-sonnet-4.5",
    "claude-haiku-4-5": "claude-haiku-4.5",
    "claude-haiku-4.5": "claude-haiku-4.5",
    "claude-opus-4-5": "claude-opus-4.5",
    "claude-opus-4.5": "claude-opus-4.5",
    "claude-sonnet-4": "claude-sonnet-4",
    "claude-sonnet-4-20250514": "claude-sonnet-4",
    "claude-3-5-sonnet": "claude-sonnet-4.5",
    "claude-3-opus": "claude-sonnet-4.5",
    "claude-3-sonnet": "claude-sonnet-4",
    "claude-3-haiku": "claude-haiku-4.5",
    "gpt-4": "claude-sonnet-4.5",
    "gpt-4o": "claude-sonnet-4.5",
    "gpt-4-turbo": "claude-sonnet-4.5",
    "gpt-3.5-turbo": "claude-sonnet-4.5",
    "default": "claude-sonnet-4.5",
}

_DEFAULT_MODEL = _MODEL_ID_MAP["default"]


def _is_codewhisperer_id(model_id: str) -> bool:
    return bool(re.match(r"^[A-Z0-9_]+$", model_id) and "_" in model_id)


def _normalize_claude_version(model_id: str) -> str:
    """Convert claude-{family}-{major}-{minor} to claude-{family}-{major}.{minor}."""
    return re.sub(
        r"^(claude-(?:sonnet|haiku|opus))-(\d+)-(\d{1,2})(?=$|[^\d])",
        r"\1-\2.\3",
        model_id,
        flags=re.IGNORECASE,
    )


def map_model_id(model: str) -> str:
    """Map an incoming model string to a Kiro-compatible model ID.

    Exact alias → fuzzy sonnet/haiku/opus/keyword → default fallback.
    """
    model_id = model.strip()
    if not model_id:
        return _DEFAULT_MODEL
    if _is_codewhisperer_id(model_id):
        return model_id

    model_id = _normalize_claude_version(model_id)
    lower = model_id.lower()

    # Exact alias match
    if lower in _MODEL_ID_MAP:
        mapped = _MODEL_ID_MAP[lower]
        return mapped if mapped != "default" else _DEFAULT_MODEL

    # Claude-like pattern → pass through as-is
    if re.match(r"^claude-(sonnet|haiku|opus)-", lower):
        return model_id

    # Unknown → fallback
    return _DEFAULT_MODEL


# ── Kiro model fetching ──────────────────────────────────────────────────────


class KiroModel(TypedDict, total=False):
    modelId: str
    modelName: str
    description: str
    modelProvider: str | None
    rateMultiplier: float
    rateUnit: str
    status: str | None
    supportedInputTypes: list[str]
    tokenLimits: dict[str, int | None]
    promptCaching: dict[str, bool | int | None] | None
    additionalModelRequestFieldsSchema: dict[str, object] | None
    availableOrigins: list[str] | None


class ProxyAccount(TypedDict, total=False):
    """Minimal shape for Kiro proxy account — matches reference ProxyAccount."""

    id: str
    accessToken: str
    region: str
    provider: str
    authMethod: str
    profileArn: str | None
    machineId: str | None


def _get_q_service_endpoint(region: str | None) -> str:
    if region and region.startswith("eu-"):
        return "https://q.eu-central-1.amazonaws.com"
    return "https://q.us-east-1.amazonaws.com"


def _make_headers(account: ProxyAccount) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {account['accessToken']}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "aws-sdk-js/1.0.34 ua/2.1 os/win32#10.0.19043 lang/js md/nodejs#22.22.0 api/codewhispererstreaming#1.0.34 m/E KiroIDE-0.12.155",
        "x-amz-user-agent": "aws-sdk-js/1.0.34 KiroIDE 0.12.155",
        "x-amzn-codewhisperer-optout": "true",
    }


async def fetch_kiro_models(
    account: ProxyAccount,
    client: httpx.AsyncClient | None = None,
) -> list[KiroModel]:
    """Fetch available Kiro models via ListAvailableModels (paginated)."""
    base_url = _get_q_service_endpoint(account.get("region"))
    headers = _make_headers(account)

    all_models: list[KiroModel] = []
    next_token: str | None = None
    if client is None:
        from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy
        proxy_url = _get_outbound_proxy()
        resolved_client = httpx.AsyncClient(proxy=proxy_url)
    else:
        resolved_client = client

    async def _do_request() -> list[KiroModel]:
        nonlocal next_token
        try:
            while True:
                params: dict[str, str] = {"origin": "AI_EDITOR", "maxResults": "50"}
                if account.get("profileArn"):
                    params["profileArn"] = cast("str", account["profileArn"])
                if next_token:
                    params["nextToken"] = next_token

                url = f"{base_url}/ListAvailableModels"
                resp = await resolved_client.get(url, params=params, headers=headers)
                if resp.status_code != 200:
                    break
                data = resp.json()
                all_models.extend(data.get("models") or [])
                next_token = data.get("nextToken")
                if not next_token:
                    break
            return all_models
        finally:
            if client is None:
                await resolved_client.aclose()

    return await _do_request()


def detect_model_capabilities(
    model: KiroModel,
) -> dict[str, bool]:
    """Detect thinking/caching capabilities from additionalModelRequestFieldsSchema."""
    schema = model.get("additionalModelRequestFieldsSchema")
    caps: dict[str, bool] = {"thinking": False, "caching": False}

    if isinstance(schema, dict):
        props = cast("Any", schema).get("properties") or cast("Any", schema).get("additionalModelRequestFields", {}).get("properties")
        if isinstance(props, dict):
            caps["thinking"] = "thinking" in props or "output_config" in props or "reasoning" in props

    pc = model.get("promptCaching")
    if isinstance(pc, dict):
        caps["caching"] = bool(pc.get("supportsPromptCaching"))

    return caps
