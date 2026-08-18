"""Failure-report builder for plugin telemetry (plan §3.4 item 12, §7 Phase 4).

Builds a scrubbed report bundle from a failed :class:`ScenarioExecutor` run.
Sensitive steps (``ScenarioStep.sensitive=True``) are excluded — their
values are replaced with ``***`` in error strings, and their artifacts
(screenshot/HTML) are dropped.  No bundle is built without explicit consent.

The bundle is the sole payload sent to the server — the reporter never
logs bundle contents at info level (error context may be present).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from ..scenario.schema import ENGINE_API

if TYPE_CHECKING:
    from ..scenario.schema import ScenarioV2
    from .executor import ExecutorResult

logger = logging.getLogger(__name__)

_SCHEMA = "stitch.report/v1"
_SCRUBBED_VALUE = "***"


def build_report_bundle(
    plugin_id: str,
    plugin_version: str,
    scenario: ScenarioV2,
    result: ExecutorResult,
    artifacts: dict[str, Any] | None = None,
    *,
    consent: bool = False,
) -> dict[str, Any] | None:
    """Build a scrubbed failure-report bundle.

    Returns ``None`` when ``consent`` is False (nothing sent without
    consent) or when the run succeeded (no failure to report).
    """
    if not consent:
        return None

    failed = _find_failed_step(scenario, result)
    if failed is None:
        return None

    step_id, step_kind, matched_candidate = failed

    sensitive_values = _collect_sensitive_values(scenario)
    scrubbed = bool(sensitive_values)

    error = _scrub_text(result.error or "", sensitive_values)

    bundle: dict[str, Any] = {
        "schema": _SCHEMA,
        "plugin_id": plugin_id,
        "version": plugin_version,
        "step": step_id,
        "step_kind": step_kind,
        "matched_candidate": matched_candidate,
        "error": error,
        "engine_api": ENGINE_API,
        "scrubbed": scrubbed,
    }

    if artifacts:
        safe_artifacts, dropped = _scrub_artifacts(artifacts, scenario)
        bundle["artifacts"] = safe_artifacts
        if dropped:
            bundle["scrubbed"] = True

    return bundle


def preview_bundle(bundle: dict[str, Any]) -> dict[str, Any]:
    """Return exactly what will be sent (UI pre-send preview).

    Returns a shallow copy so the caller cannot mutate the original.
    """
    return dict(bundle)


# ── internals ─────────────────────────────────────────────────────────────


def _find_failed_step(
    scenario: ScenarioV2, result: ExecutorResult
) -> tuple[str, str, int | None] | None:
    """Identify the failed step (id, kind, matched_candidate) or None."""
    if result.success:
        return None
    # Case 1: a step_result with success=False was appended before the break.
    for sr in reversed(result.step_results):
        if not sr.success and not sr.skipped:
            return sr.step_id, sr.kind, sr.matched_candidate
    # Case 2: ExecutorError / max-iterations — step was not appended.
    if result.error is not None:
        idx = result.steps_completed
        if 0 <= idx < len(scenario.steps):
            step = scenario.steps[idx]
            return step.id, step.kind, None
        return "", "", None
    return None


def _collect_sensitive_values(scenario: ScenarioV2) -> dict[str, str]:
    """Map step_id -> value for every sensitive step with a value."""
    return {
        step.id: step.value
        for step in scenario.steps
        if step.sensitive and step.value
    }


def _scrub_text(text: str, sensitive_values: dict[str, str]) -> str:
    """Replace every sensitive value occurrence with ``***``."""
    for value in sensitive_values.values():
        if value:
            text = text.replace(value, _SCRUBBED_VALUE)
    return text


def _scrub_artifacts(
    artifacts: dict[str, Any], scenario: ScenarioV2
) -> tuple[dict[str, Any], bool]:
    """Drop artifacts for sensitive steps. Returns (safe_artifacts, dropped)."""
    sensitive_ids = {step.id for step in scenario.steps if step.sensitive}
    safe: dict[str, Any] = {}
    dropped = False
    for key, value in artifacts.items():
        if key in sensitive_ids:
            dropped = True
            continue
        safe[key] = value
    return safe, dropped
