from __future__ import annotations

from typing import Literal, TypedDict

JsonScalar = str | int | float | bool | None
JsonValue = JsonScalar | dict[str, JsonScalar] | list[JsonScalar | dict[str, JsonScalar]]
JsonObject = dict[str, JsonValue]


class ThinkingConfig(TypedDict):
    schema_path: Literal["output_config", "reasoning"]
    efforts: list[str]
    default_effort: str | None


def build_thinking_fields(
    thinking: JsonObject | None,
    reasoning_effort: str | None,
    thinking_config: ThinkingConfig | None = None,
) -> JsonObject:
    """Map OpenAI/Claude thinking params to Kiro additionalModelRequestFields.

    Args:
        thinking: Client-side thinking param (OpenAI: {type, budget_tokens},
                  Claude: {type: "enabled", budget_tokens}).
        reasoning_effort: OpenAI reasoning_effort string (low/medium/high/xhigh).
        thinking_config: Model thinking capability metadata from ListAvailableModels.

    Returns:
        Kiro additionalModelRequestFields dict, or empty dict if thinking is disabled.
    """
    # Client explicitly disabled thinking
    if isinstance(thinking, dict) and thinking.get("type") == "disabled":
        return {}

    # No model metadata → fallback to legacy adaptive thinking
    if thinking_config is None:
        if isinstance(thinking, dict) and thinking.get("type") != "disabled":
            return {"thinking": {"type": "adaptive"}}
        if reasoning_effort:
            return {"thinking": {"type": "adaptive"}}
        return {}

    # Client didn't request thinking or reasoning_effort → don't enable
    wants_thinking = bool(
        (isinstance(thinking, dict) and thinking.get("type") != "disabled")
        or reasoning_effort
    )
    if not wants_thinking:
        return {}

    # Map effort level
    effort = _resolve_effort(thinking, reasoning_effort, thinking_config)

    # Ensure effort is in available range, otherwise take closest
    if effort not in thinking_config["efforts"]:
        effort = thinking_config["efforts"][-1] if thinking_config["efforts"] else "high"

    schema_path = thinking_config["schema_path"]
    if schema_path == "output_config":
        return {
            "thinking": {"type": "adaptive", "display": "summarized"},
            "output_config": {"effort": effort},
        }
    if schema_path == "reasoning":
        return {"reasoning": {"effort": effort}}

    return {"thinking": {"type": "adaptive"}}


def _resolve_effort(
    thinking: JsonObject | None,
    reasoning_effort: str | None,
    thinking_config: ThinkingConfig,
) -> str:
    """Resolve the effort level from client params."""
    if reasoning_effort:
        return reasoning_effort.lower()

    if isinstance(thinking, dict) and thinking.get("type") == "enabled":
        budget = thinking.get("budget_tokens")
        if isinstance(budget, (int, float)):
            b = int(budget)
            if b <= 4000:
                return "low"
            if b <= 16000:
                return "medium"
            if b <= 64000:
                return "high"
            return "xhigh"

    return thinking_config.get("default_effort") or "high"
