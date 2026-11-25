"""OpenCode config writer — v1 and v2 schema shapes for the stitch provider."""

from __future__ import annotations

import copy
from typing import Any, cast

STITCH_PROVIDER_ID = "stitch"
STITCH_PROVIDER_NAME = "Stitch Gateway"
V1_NPM = "@ai-sdk/openai-compatible"
V2_PACKAGE = "@opencode/ai/providers/openai-compatible"


def build_v1_model_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """v1 model shape: name/limit/tool_call/attachment/modalities/temperature.

    ``attachment`` is true only when image is among the input modalities.
    ``reasoning`` is emitted ONLY when explicitly known — never fabricated.
    """
    input_modalities = list(entry.get("inputModalities") or ["text"])
    output_modalities = list(entry.get("outputModalities") or ["text"])
    out: dict[str, Any] = {
        "name": entry["name"],
        "limit": {
            "context": entry["contextTokens"],
            "output": entry["outputTokens"],
        },
        "tool_call": bool(entry.get("tools", True)),
        "attachment": "image" in input_modalities,
        "modalities": {"input": input_modalities, "output": output_modalities},
        "temperature": True,
    }
    if entry.get("reasoning") is not None:
        out["reasoning"] = bool(entry["reasoning"])
    return out


def build_v1_provider_block(
    entries: list[dict[str, Any]], base_url: str, api_key: str
) -> dict[str, Any]:
    return {
        "npm": V1_NPM,
        "name": STITCH_PROVIDER_NAME,
        "options": {"baseURL": base_url, "apiKey": api_key},
        "models": {e["id"]: build_v1_model_entry(e) for e in entries},
    }


def build_v2_model_entry(entry: dict[str, Any]) -> dict[str, Any]:
    """v2 model shape: name/capabilities/limit — no modelID when key==upstream id."""
    out: dict[str, Any] = {
        "name": entry["name"],
        "capabilities": {
            "tools": bool(entry.get("tools", True)),
            "input": list(entry.get("inputModalities") or ["text"]),
            "output": list(entry.get("outputModalities") or ["text"]),
        },
        "limit": {
            "context": entry["contextTokens"],
            "output": entry["outputTokens"],
        },
    }
    if entry.get("reasoning") is not None:
        out["capabilities"]["reasoning"] = bool(entry["reasoning"])
    return out


def build_v2_provider_block(
    entries: list[dict[str, Any]], base_url: str, api_key: str
) -> dict[str, Any]:
    return {
        "name": STITCH_PROVIDER_NAME,
        "package": V2_PACKAGE,
        "settings": {"baseURL": base_url, "apiKey": api_key},
        "models": {e["id"]: build_v2_model_entry(e) for e in entries},
    }


def _pop_stitch(container: dict[str, Any], key: str) -> bool:
    """Remove ONLY the stitch entry from a provider container key.

    Returns True when something was removed.  Never migrates or touches
    unrelated providers; drops the container key when it becomes empty.
    """
    providers = container.get(key)
    if not isinstance(providers, dict) or STITCH_PROVIDER_ID not in providers:
        return False
    del providers[STITCH_PROVIDER_ID]
    if not providers:
        del container[key]
    return True


def merge_stitch_block(
    data: dict[str, Any],
    entries: list[dict[str, Any]],
    base_url: str,
    api_key: str,
    schema: str,
    *,
    default_model: str | None = None,
    small_model: str | None = None,
) -> dict[str, Any]:
    """Return a copy of *data* with the stitch provider merged per *schema*.

    v1: singular ``provider.stitch`` + top-level ``model``/``small_model``.
    Both follow the same no-clobber rule: an explicit request value always
    wins, otherwise the key is written ONLY when absent — a user-set value
    is never overwritten implicitly.  Any legacy v2-style ``providers.stitch``
    entry is removed — never the other entries.

    v2: plural ``providers.stitch``; legacy singular ``provider.stitch``
    removed; no ``small_model`` is written (v2 ignores the key entirely).
    """
    out = copy.deepcopy(data)
    if schema == "v2":
        block = build_v2_provider_block(entries, base_url, api_key)
        providers = out.setdefault("providers", {})
        if not isinstance(providers, dict):
            providers = {}
            out["providers"] = providers
        providers[STITCH_PROVIDER_ID] = block
        _pop_stitch(out, "provider")
    else:
        block = build_v1_provider_block(entries, base_url, api_key)
        providers = out.setdefault("provider", {})
        if not isinstance(providers, dict):
            providers = {}
            out["provider"] = providers
        providers[STITCH_PROVIDER_ID] = block
        _pop_stitch(out, "providers")
        first = f"{STITCH_PROVIDER_ID}/{entries[0]['id']}" if entries else None
        chosen = default_model or first
        if chosen:
            if default_model or not out.get("model"):
                out["model"] = default_model or chosen
            small_chosen = small_model or chosen
            if small_model or not out.get("small_model"):
                out["small_model"] = small_chosen
    return out


def purge_stitch_entries(data: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Remove stitch entries (both dialects) from a copy of *data*.

    Used for the lower-precedence file in a json+jsonc split write.  Only the
    stitch entry is touched — unrelated providers are never migrated.
    """
    out = copy.deepcopy(data)
    removed = _pop_stitch(out, "provider")
    removed = _pop_stitch(out, "providers") or removed
    # top-level model/small_model pointing at stitch are dangling after purge
    for key in ("model", "small_model"):
        value = out.get(key)
        if isinstance(value, str) and value.startswith(f"{STITCH_PROVIDER_ID}/"):
            del out[key]
            removed = True
    return out, removed


def existing_stitch_model_ids(data: dict[str, Any]) -> set[str]:
    ids: set[str] = set()
    for key in ("provider", "providers"):
        providers = data.get(key)
        if isinstance(providers, dict):
            stitch = providers.get(STITCH_PROVIDER_ID)
            if isinstance(stitch, dict) and isinstance(stitch.get("models"), dict):
                ids.update(stitch["models"].keys())
    return ids


def extract_stitch_api_key(data: dict[str, Any]) -> str | None:
    """Return the currently configured stitch apiKey (v1 or v2 dialect).

    This is internal key material: callers may hash/compare it and use it for
    a rewrite, but must never include it in responses, logs or diffs.
    """
    for container_key in ("providers", "provider"):
        providers = data.get(container_key)
        if not isinstance(providers, dict):
            continue
        stitch = providers.get(STITCH_PROVIDER_ID)
        if not isinstance(stitch, dict):
            continue
        for settings_key in ("settings", "options"):
            settings = stitch.get(settings_key)
            if isinstance(settings, dict) and isinstance(settings.get("apiKey"), str):
                value = settings["apiKey"]
                if value:
                    return cast("str", value)
    return None
