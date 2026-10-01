"""extract capability for StepKind v2 (plan §4.3)."""

from __future__ import annotations

from typing import Any
from urllib.parse import parse_qs, urlsplit

from ..scenario.schema import ScenarioStep
from .capabilities_base import StepResult, resolve_selector


def _cookie_value(browser: Any, name: str) -> str:
    for c in browser.cookies() or []:
        cn = c.get("name") if isinstance(c, dict) else getattr(c, "name", None)
        if cn == name:
            return c.get("value", "") if isinstance(c, dict) else getattr(c, "value", "")
    return ""


def extract_capability(
    step: ScenarioStep, browser: Any, store: dict[str, Any]
) -> StepResult:
    """Extract a value into the store (plan §4.3 extract)."""
    meta = step.meta or {}
    source = meta.get("from", "")
    name = meta.get("name", "")
    to_key = meta.get("to", "")
    if not source or not to_key:
        return StepResult(
            step.id, step.kind, False, error="extract: 'from' and 'to' required"
        )

    idx: int | None = None
    try:
        if source == "url_param":
            value = parse_qs(urlsplit(browser.url).query).get(name, [""])[0]
        elif source == "cookie":
            value = _cookie_value(browser, name)
        elif source in ("text", "attribute"):
            elem, idx = resolve_selector(browser, step, step.timeout_ms / 1000.0)
            if elem is None:
                return StepResult(
                    step.id, step.kind, False,
                    error="extract: element not found", matched_candidate=idx,
                )
            if source == "text":
                value = getattr(elem, "text", "") or ""
            else:
                value = elem.attr(meta.get("attr", "")) if hasattr(elem, "attr") else ""
        else:
            return StepResult(
                step.id, step.kind, False, error=f"extract: unknown source '{source}'"
            )
        store[to_key] = value
        return StepResult(step.id, step.kind, True, matched_candidate=idx, meta={"to": to_key})
    except Exception as e:  # noqa: BLE001
        return StepResult(step.id, step.kind, False, error=f"extract: {e}")
