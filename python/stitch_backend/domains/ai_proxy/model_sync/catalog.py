"""Catalog extraction: public gateway models -> tool-agnostic model entries."""

from __future__ import annotations

from typing import Any

DEFAULT_CONTEXT_TOKENS = 128000
DEFAULT_OUTPUT_TOKENS = 8192


def catalog_entry_from_public_model(model: Any) -> dict[str, Any]:
    """Build a tool-agnostic catalog entry from a ``PublicModel`` row.

    Fallbacks (per contract): context 128000, output 8192, input modalities
    ``["text"]``, output modalities ``["text"]``, tools True.  ``reasoning``
    is ``None`` unless the contract states it explicitly — never fabricated.
    """
    contract = model.contract or {}
    if not isinstance(contract, dict):
        contract = {}

    context = contract.get("minContextTokens")
    if not isinstance(context, int) or context <= 0:
        context = DEFAULT_CONTEXT_TOKENS

    output = contract.get("maxOutputTokens")
    output_explicit = isinstance(output, int) and output > 0
    if not output_explicit:
        output = DEFAULT_OUTPUT_TOKENS

    input_modalities = contract.get("inputModalities")
    if not isinstance(input_modalities, list) or not input_modalities:
        input_modalities = ["text"]
    input_modalities = [str(m) for m in input_modalities]

    output_modalities = contract.get("outputModalities")
    if not isinstance(output_modalities, list) or not output_modalities:
        output_modalities = ["text"]
    output_modalities = [str(m) for m in output_modalities]

    tools = contract.get("tools")
    if not isinstance(tools, bool):
        tools = True

    reasoning = contract.get("reasoning")
    if not isinstance(reasoning, bool):
        reasoning = None

    return {
        "id": model.id,
        "name": model.display_name or model.id,
        "contextTokens": context,
        "outputTokens": output,
        "outputTokensExplicit": output_explicit,
        "inputModalities": input_modalities,
        "outputModalities": output_modalities,
        "tools": tools,
        "reasoning": reasoning,
    }


def catalog_from_public_models(models: list[Any]) -> list[dict[str, Any]]:
    return [catalog_entry_from_public_model(m) for m in models]


async def load_catalog() -> list[dict[str, Any]]:
    """Read-side catalog: enabled public models visible to the shared pool."""
    from stitch_backend.database import run_in_read_session
    from stitch_backend.domains.ai_gateway.routing_engine import PoolScope, RoutingEngine

    async def _load(session):
        return await RoutingEngine().get_available_public_models(session, pool=PoolScope(None))

    models = await run_in_read_session(_load)
    return catalog_from_public_models(models)


def select_models(
    catalog: list[dict[str, Any]], selected_ids: list[str] | None
) -> tuple[list[dict[str, Any]], list[str]]:
    """Filter the catalog by explicit ids (None = all).

    Returns ``(entries, unknown_ids)`` preserving catalog order.
    """
    if selected_ids is None:
        return list(catalog), []
    wanted = set(selected_ids)
    entries = [e for e in catalog if e["id"] in wanted]
    unknown = [mid for mid in selected_ids if mid not in {e["id"] for e in catalog}]
    return entries, unknown
