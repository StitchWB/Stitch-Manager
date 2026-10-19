"""branch capability for StepKind v2 (plan §4.3)."""

from __future__ import annotations

from typing import Any

from ..scenario.schema import ScenarioStep
from .capabilities_base import StepResult, resolve_selector


def branch_capability(
    step: ScenarioStep, browser: Any, store: dict[str, Any]
) -> StepResult:
    """Branch on a condition (plan §4.3 branch)."""
    meta = step.meta or {}
    condition = meta.get("if", "")
    then_id = meta.get("then", "")
    else_id = meta.get("else", "")
    idx: int | None = None

    try:
        if condition == "selector_exists":
            elem, idx = resolve_selector(browser, step, step.timeout_ms / 1000.0)
            matched = elem is not None
        elif condition == "url_contains":
            matched = meta.get("value", "") in (browser.url or "")
        elif condition == "var_equals":
            # Tolerant key: scenarios write "var", older authors wrote "name".
            var_name = meta.get("name") or meta.get("var") or ""
            matched = store.get(var_name) == meta.get("value", "")
        else:
            return StepResult(
                step.id, step.kind, False, error=f"branch: unknown condition '{condition}'"
            )
        return StepResult(
            step.id, step.kind, True,
            next_step_id=then_id if matched else else_id,
            matched_candidate=idx if condition == "selector_exists" else None,
            meta={"condition": condition, "matched": matched},
        )
    except Exception as e:  # noqa: BLE001
        return StepResult(step.id, step.kind, False, error=f"branch: {e}")
