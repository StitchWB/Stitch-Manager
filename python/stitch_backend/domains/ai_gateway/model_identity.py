"""Canonical model identity — provider-independent model keys and contract reconciliation.

The same model (e.g. ``qwen2.8``) can be exposed by several provider endpoints
under slightly different ids (``qwen2.8``, ``qwen2.8-instruct``,
``qwen2.8-2024-07-18``).  :func:`canonical_model_key` collapses those ids to a
single identity key so discovery can group them into one public model with
several route targets.

Both functions here are pure (no DB, no I/O) so they are unit-testable in
isolation.
"""

from __future__ import annotations

import re
from typing import Any

# Anchored at the end so mid-id digits survive.
_DATE_SUFFIX = re.compile(r"[-_.]?\d{4}(?:[-_.]?\d{2}){0,2}$")

_VARIANT_SUFFIXES = frozenset({"turbo", "preview", "latest", "instruct", "chat", "hf"})

_SEPARATORS = re.compile(r"[-_]+")

_SLUG_RE = re.compile(r"[A-Za-z0-9._-]+")


def canonical_model_key(model_id: str) -> str:
    """Normalize an upstream model id to a provider-independent identity key.

    Lowercases, drops the org/path prefix and any ``:tag`` suffix, strips a
    trailing date marker and known packaging/variant suffixes, then collapses
    ``-``/``_`` runs.  Two ids that normalize to the same key are treated as
    the same model across providers.  Returns ``""`` for an empty input.
    """
    if not model_id:
        return ""
    key = model_id.strip().lower()
    key = key.rsplit("/", 1)[-1]
    key = key.split(":", 1)[0]
    stripped = _DATE_SUFFIX.sub("", key)
    parts = [p for p in _SEPARATORS.split(stripped) if p]
    while parts and parts[-1] in _VARIANT_SUFFIXES:
        parts.pop()
    normalized = "-".join(parts)
    return normalized or key


def is_valid_public_slug(value: str) -> bool:
    """Whether *value* is usable as a ``PublicModel.id`` slug."""
    return bool(value) and _SLUG_RE.fullmatch(value) is not None


def reconcile_contract(models: list[Any]) -> dict[str, Any]:
    """Derive the guarantees a public model can promise across its live targets.

    ``inputModalities`` is the intersection (``image`` only when every target
    explicitly supports vision); ``tools``/``streaming`` are denied only when a
    target explicitly reports ``False`` (unknown stays optimistic, matching the
    routing engine); ``minContextTokens`` is the minimum known input window.
    """
    modalities: set[str] | None = None
    tools = True
    streaming = True
    min_ctx: int | None = None

    for model in models:
        caps = getattr(model, "capabilities", None) or {}
        mods = {"text"}
        if caps.get("supports_vision") is True:
            mods.add("image")
        modalities = mods if modalities is None else (modalities & mods)

        if caps.get("supports_function_calling") is False or caps.get("supports_tools") is False:
            tools = False
        if caps.get("supports_streaming") is False:
            streaming = False

        ctx = caps.get("max_input_tokens")
        if isinstance(ctx, int) and not isinstance(ctx, bool):
            min_ctx = ctx if min_ctx is None else min(min_ctx, ctx)

    contract: dict[str, Any] = {
        "inputModalities": sorted(modalities or {"text"}),
        "tools": tools,
        "streaming": streaming,
    }
    if min_ctx is not None:
        contract["minContextTokens"] = min_ctx
    return contract
