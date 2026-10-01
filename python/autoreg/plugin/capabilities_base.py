"""Shared types and helpers for the plugin capability handlers (plan §4.3)."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from ..scenario.schema import ScenarioStep, SelectorCandidate

logger = logging.getLogger(__name__)


class ExecutorError(Exception):
    """Raised when the executor cannot proceed (e.g. totp.register v1.1)."""


# ── shared templating helper ────────────────────────────────────────────────

_TEMPLATE_RE = re.compile(r"\$\{([^}]+)\}")


def resolve_template(value: str | None, store: dict[str, Any], *, warn: bool = True) -> str:
    """Resolve ``${key}`` placeholders against ``store``.

    Shared by :meth:`ScenarioExecutor._resolve_value` and capability
    handlers (e.g. ``stripe.fill_checkout`` resolving ``${config.*}``).
    Plain keys (``account.email``, ``config.card_number``, ...).  Missing
    keys interpolate to empty string and emit a single warning per key
    when ``warn`` is True.  Values without placeholders pass through
    unchanged.  ``None`` -> ``""``.
    """
    if not value:
        return ""
    if "${" not in value:
        return value

    def _replace(match: re.Match[str]) -> str:
        key = match.group(1)
        if key in store:
            return str(store[key])
        if warn:
            logger.warning("template: missing store key %r", key)
        return ""

    return _TEMPLATE_RE.sub(_replace, value)


@dataclass
class StepResult:
    """Result of executing one step."""

    step_id: str
    kind: str
    success: bool
    matched_candidate: int | None = None
    human_pause: bool = False
    human_pause_reason: str | None = None
    error: str | None = None
    skipped: bool = False
    skip_reason: str | None = None
    next_step_id: str | None = None
    terminal: bool = False
    meta: dict[str, Any] = field(default_factory=dict)


# ── selector helpers (shared with executor.py) ──────────────────────────


def build_selector(candidate: SelectorCandidate) -> str:
    """Build a DrissionPage selector string from kind + value.

    Conversion table (prepared_area/plugin_packages/README.md):
      css    → verbatim (DrissionPage auto-detects bare CSS)
      text   → text:{value}
      aria   → aria:{value}        (DrissionPage aria: prefix)
      testid → css:[data-testid="{value}"]
      attr   → @{value}            (e.g. @placeholder=..., @data-id=...)
      xpath  → verbatim (DrissionPage auto-detects bare XPath)
      role   → @:{value}          (legacy, not in README table)
    """
    k = candidate.kind.lower()
    v = candidate.value
    if k == "text":
        return f"text:{v}"
    if k == "testid":
        return f'css:[data-testid="{v}"]'
    if k == "attr":
        return f"@{v}"
    if k == "aria":
        return f"aria:{v}"
    if k == "role":
        return f"@:{v}"
    return v


def resolve_selector(
    browser: Any, step: ScenarioStep, timeout_s: float = 5.0
) -> tuple[Any, int | None]:
    """Try ``selector_candidates`` by weight desc.

    Returns ``(element, matched_index)`` where *matched_index* is the original
    position in ``step.selector_candidates`` (the ``matched_candidate`` sensor
    from plan §3.4), or ``(None, None)``.
    """
    indexed = list(enumerate(step.selector_candidates))
    indexed.sort(key=lambda pair: pair[1].weight, reverse=True)
    for original_index, candidate in indexed:
        try:
            elem = browser.ele(build_selector(candidate), timeout=timeout_s)
            if elem:
                return elem, original_index
        except Exception:  # noqa: BLE001
            continue
    return None, None


def resolve_all_selectors(
    browser: Any, step: ScenarioStep, timeout_s: float = 5.0
) -> tuple[list[Any], int | None]:
    """Resolve ALL elements matching the first successful candidate.

    Used by ``split_chars`` fill (multi-input OTP distribution).  Tries
    candidates by weight desc; the first candidate that matches at least one
    element via ``browser.eles()`` (DrissionPage plural form) wins, and ALL
    elements matched by that candidate are returned in DOM order.

    Returns ``(elements, matched_index)`` or ``([], None)``.
    """
    indexed = list(enumerate(step.selector_candidates))
    indexed.sort(key=lambda pair: pair[1].weight, reverse=True)
    for original_index, candidate in indexed:
        try:
            elems = browser.eles(build_selector(candidate), timeout=timeout_s)
            if elems:
                return list(elems), original_index
        except Exception:  # noqa: BLE001
            continue
    return [], None
