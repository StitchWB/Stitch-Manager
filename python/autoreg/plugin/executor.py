"""Plugin scenario executor (plan §4.3, §4.4).

Runs a parsed :class:`~autoreg.scenario.schema.ScenarioV2` against a
duck-typed DrissionPage-style browser (``.get``, ``.ele``, ``.url``,
``.cookies``, ``.run_js``).  Capability handlers live in :mod:`capabilities`.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from ..scenario.schema import ScenarioStep, ScenarioV2
from .capabilities import (
    ExecutorError,
    StepResult,
    account_save_capability,
    branch_capability,
    captcha_solve_capability,
    extract_capability,
    imap_otp_capability,
    resolve_selector,
    stripe_fill_checkout_capability,
    totp_register_capability,
)

logger = logging.getLogger(__name__)


@dataclass
class ExecutorResult:
    """Top-level result of running a scenario."""

    success: bool
    outputs: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    steps_completed: int = 0
    human_pause: bool = False
    human_pause_reason: str | None = None
    completed: bool = False
    step_results: list[StepResult] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)


class ScenarioExecutor:
    """Execute a :class:`ScenarioV2` against a duck-typed browser."""

    def __init__(
        self,
        scenario: ScenarioV2,
        browser: Any,
        *,
        store: dict[str, Any] | None = None,
        imap_config: dict[str, Any] | None = None,
        imap_factory: Callable[[dict[str, Any]], Any] | None = None,
    ) -> None:
        self._scenario = scenario
        self._browser = browser
        self._store = store if store is not None else {}
        self._imap_config = imap_config
        self._imap_factory = imap_factory
        self._steps_by_id = {s.id: i for i, s in enumerate(scenario.steps)}

    # ── public ─────────────────────────────────────────────────────────

    def run(self) -> ExecutorResult:
        result = ExecutorResult(success=True)
        skipped_noop = 0
        i = 0
        max_iter = len(self._scenario.steps) * 2 + 4
        while i < len(self._scenario.steps):
            if result.steps_completed > max_iter:
                result.success = False
                result.error = "executor: max iterations exceeded (possible branch loop)"
                break
            step = self._scenario.steps[i]
            if step.sensitive:
                logger.debug("executing step %s kind=%s (sensitive)", step.id, step.kind)
            else:
                logger.debug("executing step %s kind=%s value=%s", step.id, step.kind, step.value)
            try:
                sr = self._dispatch(step)
            except ExecutorError as e:
                result.success = False
                result.error = str(e)
                break

            result.step_results.append(sr)
            result.steps_completed += 1
            if sr.skipped and step.kind == "noop":
                skipped_noop += 1
            if sr.terminal:
                result.completed = True
                result.outputs = sr.meta.get("outputs", {})
                break
            if sr.human_pause:
                result.human_pause = True
                result.human_pause_reason = sr.human_pause_reason
                break
            if not sr.success and not sr.skipped:
                result.success = False
                result.error = sr.error
                break
            if sr.next_step_id:
                target = self._steps_by_id.get(sr.next_step_id)
                if target is not None:
                    i = target
                    continue
            i += 1
        result.meta["skipped_noop"] = skipped_noop
        return result

    # ── dispatch ────────────────────────────────────────────────────────

    def _dispatch(self, step: ScenarioStep) -> StepResult:
        method_name = _KIND_TO_METHOD.get(step.kind)
        if method_name is None:
            return StepResult(
                step.id, step.kind, True, skipped=True,
                skip_reason=f"unknown kind: {step.kind}",
            )
        handler = getattr(self, method_name)
        try:
            result = handler(step)
            if result.error and step.sensitive and step.value:
                result.error = result.error.replace(step.value, "***")
            return result
        except ExecutorError:
            raise
        except Exception as e:  # noqa: BLE001
            error = str(e)
            if step.sensitive and step.value:
                error = error.replace(step.value, "***")
            return StepResult(step.id, step.kind, False, error=error)

    def _timeout_s(self, step: ScenarioStep) -> float:
        return max(step.timeout_ms / 1000.0, 0.1)

    # ── basic step handlers ────────────────────────────────────────────

    def _goto(self, step: ScenarioStep) -> StepResult:
        if not step.url:
            return StepResult(step.id, step.kind, False, error="goto: no url")
        self._browser.get(step.url)
        return StepResult(step.id, step.kind, True)

    def _click(self, step: ScenarioStep) -> StepResult:
        elem, idx = resolve_selector(self._browser, step, self._timeout_s(step))
        if elem is None:
            return StepResult(
                step.id, step.kind, False,
                error="click: element not found", matched_candidate=idx,
            )
        elem.click()
        return StepResult(step.id, step.kind, True, matched_candidate=idx)

    def _fill(self, step: ScenarioStep) -> StepResult:
        elem, idx = resolve_selector(self._browser, step, self._timeout_s(step))
        if elem is None:
            return StepResult(
                step.id, step.kind, False,
                error="fill: element not found", matched_candidate=idx,
            )
        try:
            elem.clear()
        except Exception:  # noqa: BLE001
            pass
        elem.input(step.value or "")
        return StepResult(step.id, step.kind, True, matched_candidate=idx)

    def _press(self, step: ScenarioStep) -> StepResult:
        key = step.value or "Enter"
        if step.selector_candidates:
            elem, idx = resolve_selector(self._browser, step, self._timeout_s(step))
            if elem is not None:
                elem.press(key)
                return StepResult(step.id, step.kind, True, matched_candidate=idx)
        if hasattr(self._browser, "press"):
            self._browser.press(key)
            return StepResult(step.id, step.kind, True)
        return StepResult(
            step.id, step.kind, False,
            error="press: no element found and browser has no press()",
        )

    def _wait_for(self, step: ScenarioStep) -> StepResult:
        meta = step.meta or {}
        url_contains = meta.get("url_contains")
        if url_contains:
            deadline = time.time() + self._timeout_s(step)
            while time.time() < deadline:
                if url_contains in (self._browser.url or ""):
                    return StepResult(step.id, step.kind, True)
                time.sleep(0.3)
            return StepResult(
                step.id, step.kind, False,
                error=f"waitFor: url does not contain '{url_contains}'",
            )
        elem, idx = resolve_selector(self._browser, step, self._timeout_s(step))
        if elem is None:
            return StepResult(
                step.id, step.kind, False,
                error="waitFor: element not found", matched_candidate=idx,
            )
        return StepResult(step.id, step.kind, True, matched_candidate=idx)

    def _assert(self, step: ScenarioStep) -> StepResult:
        meta = step.meta or {}
        url_contains = meta.get("url_contains")
        if url_contains:
            if url_contains in (self._browser.url or ""):
                return StepResult(step.id, step.kind, True)
            return StepResult(
                step.id, step.kind, False,
                error=f"assert: url does not contain '{url_contains}'",
            )
        elem, idx = resolve_selector(self._browser, step, self._timeout_s(step))
        if elem is None:
            return StepResult(
                step.id, step.kind, False,
                error="assert: element not found", matched_candidate=idx,
            )
        return StepResult(step.id, step.kind, True, matched_candidate=idx)

    def _manual_pause(self, step: ScenarioStep) -> StepResult:
        reason = (step.meta or {}).get("reason", "manual.pause")
        return StepResult(
            step.id, step.kind, True, human_pause=True, human_pause_reason=reason,
        )

    def _proxy_switch(self, step: ScenarioStep) -> StepResult:
        meta = step.meta or {}
        return StepResult(
            step.id, step.kind, True,
            meta={"session_restart": True, "proxy_id": meta.get("proxy_id")},
        )

    def _noop(self, step: ScenarioStep) -> StepResult:
        return StepResult(
            step.id, step.kind, True, skipped=True, skip_reason="noop",
        )

    # ── capability dispatchers ─────────────────────────────────────────

    def _extract(self, step: ScenarioStep) -> StepResult:
        return extract_capability(step, self._browser, self._store)

    def _branch(self, step: ScenarioStep) -> StepResult:
        return branch_capability(step, self._browser, self._store)

    def _imap_otp(self, step: ScenarioStep) -> StepResult:
        return imap_otp_capability(
            step, self._imap_config, self._imap_factory, self._store
        )

    def _captcha_solve(self, step: ScenarioStep) -> StepResult:
        return captcha_solve_capability(step, self._browser)

    def _stripe_fill_checkout(self, step: ScenarioStep) -> StepResult:
        return stripe_fill_checkout_capability(step, self._browser, self._store)

    def _totp_register(self, step: ScenarioStep) -> StepResult:
        return totp_register_capability(step)

    def _account_save(self, step: ScenarioStep) -> StepResult:
        return account_save_capability(step, self._store)


_KIND_TO_METHOD: dict[str, str] = {
    "goto": "_goto",
    "click": "_click",
    "fill": "_fill",
    "press": "_press",
    "waitFor": "_wait_for",
    "assert": "_assert",
    "manual.pause": "_manual_pause",
    "proxy.switch": "_proxy_switch",
    "noop": "_noop",
    "extract": "_extract",
    "branch": "_branch",
    "imap.otp": "_imap_otp",
    "captcha.solve": "_captcha_solve",
    "stripe.fill_checkout": "_stripe_fill_checkout",
    "totp.register": "_totp_register",
    "account.save": "_account_save",
}
