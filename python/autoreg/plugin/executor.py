"""Plugin scenario executor (plan §4.3, §4.4).

Runs a parsed :class:`~autoreg.scenario.schema.ScenarioV2` against a
duck-typed DrissionPage-style browser (``.get``, ``.ele``, ``.url``,
``.cookies``, ``.run_js``).  Capability handlers live in :mod:`capabilities`.
"""

from __future__ import annotations

import base64
import logging
import os
import tempfile
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
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
    resolve_all_selectors,
    resolve_selector,
    resolve_template,
    stripe_fill_checkout_capability,
    totp_register_capability,
)

logger = logging.getLogger(__name__)


def _read_back_value(elem: Any) -> str | None:
    """Read back an element's current value for fill verification.

    DrissionPage ChromiumElement exposes value via ``attr("value")`` (the
    pattern used throughout the repo — see kiro_v2/browser.py:1049,
    kiro/browser.py:1132).  Falls back to a ``.value`` property if the
    element lacks ``attr``.  Returns ``None`` when no read-back mechanism
    is available (caller treats ``None`` as "trust the input").
    """
    attr_fn = getattr(elem, "attr", None)
    if callable(attr_fn):
        try:
            return str(attr_fn("value") or "")
        except Exception:  # noqa: BLE001 — best-effort read-back
            return None
    val = getattr(elem, "value", None)
    if val is not None and not callable(val):
        return str(val)
    return None


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
    artifacts: dict[str, Any] = field(default_factory=dict)


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
                # Convert to a failed StepResult so on_failure applies uniformly
                # (plan §4.3(b) — exception-caused failures are subject to
                # on_failure=continue just like ordinary failed results).
                sr = StepResult(step.id, step.kind, False, error=str(e))

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
                on_failure = (step.meta or {}).get("on_failure", "abort")
                if on_failure in ("continue", "skip"):
                    # Non-fatal: mark skipped so downstream sees it, keep
                    # success=False on the StepResult itself.  No artifacts
                    # captured (keep bundles small); error stays in sr.error
                    # and skip_reason for the step event/log.
                    sr.skipped = True
                    sr.skip_reason = f"on_failure=continue: {sr.error or 'failed'}"
                    logger.info(
                        "step %s failed but on_failure=continue — proceeding",
                        step.id,
                    )
                else:
                    if on_failure != "abort":
                        logger.warning(
                            "step %s has unknown on_failure=%r — treating as abort",
                            step.id, on_failure,
                        )
                    result.success = False
                    result.error = sr.error
                    result.artifacts[step.id] = self._capture_failure_artifacts(step)
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
                result.error = self._scrub_sensitive(step, result.error)
            return result
        except ExecutorError:
            raise
        except Exception as e:  # noqa: BLE001
            error = str(e)
            if step.sensitive and step.value:
                error = self._scrub_sensitive(step, error)
            return StepResult(step.id, step.kind, False, error=error)

    def _scrub_sensitive(self, step: ScenarioStep, error: str) -> str:
        """Scrub ``step.value`` and its resolved form from ``error``.

        Templated sensitive values (``${account.password}``) must scrub both
        the template literal and the resolved secret, since the resolved
        value is what reaches the browser and may appear in exceptions.
        """
        error = error.replace(step.value or "", "***")
        if step.value and "${" in step.value:
            resolved = self._resolve_value(step.value, warn=False)
            if resolved and resolved != step.value:
                error = error.replace(resolved, "***")
        return error

    def _timeout_s(self, step: ScenarioStep) -> float:
        return max(step.timeout_ms / 1000.0, 0.1)

    # ── failure artifact capture (plan §3.4) ───────────────────────────

    _MAX_HTML_CHARS: int = 200_000

    def _capture_failure_artifacts(self, step: ScenarioStep) -> dict[str, Any]:
        """Capture screenshot + HTML of the current page for a failed step.

        Sensitive steps return ``{}`` — their DOM may contain typed passwords
        (privacy by construction).  Best-effort: browsers without
        ``get_screenshot`` / ``html`` are skipped silently with a debug log.
        """
        if step.sensitive:
            return {}
        artifacts: dict[str, Any] = {}
        tmp_path: str | None = None
        try:
            get_screenshot = getattr(self._browser, "get_screenshot", None)
            if get_screenshot is not None:
                with tempfile.NamedTemporaryFile(
                    suffix=".png", delete=False
                ) as f:
                    tmp_path = f.name
                get_screenshot(path=tmp_path)
                data = Path(tmp_path).read_bytes()
                if data:
                    artifacts["screenshot_b64"] = base64.b64encode(data).decode(
                        "ascii"
                    )
                    artifacts["screenshot_bytes"] = len(data)
        except Exception as exc:  # noqa: BLE001 — best-effort capture
            logger.debug(
                "executor: screenshot capture failed for %s: %s", step.id, exc
            )
        finally:
            if tmp_path is not None:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
        try:
            html = getattr(self._browser, "html", None)
            if html is not None:
                artifacts["html"] = str(html)[: self._MAX_HTML_CHARS]
        except Exception as exc:  # noqa: BLE001 — best-effort capture
            logger.debug(
                "executor: html capture failed for %s: %s", step.id, exc
            )
        return artifacts

    # ── value templating ───────────────────────────────────────────────

    def _resolve_value(self, value: str | None, *, warn: bool = True) -> str:
        """Resolve ``${key}`` placeholders against ``self._store``.

        Delegates to the shared :func:`resolve_template` helper so
        capability handlers can resolve ``${config.*}`` references with
        the same logic without duplicating the regex.
        """
        return resolve_template(value, self._store, warn=warn)

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
        meta = step.meta or {}
        split_chars = bool(meta.get("split_chars"))
        js_set_value = bool(meta.get("js_set_value"))
        resolved_value = self._resolve_value(step.value)

        # split_chars + multiple elements → distribute one char per element.
        if split_chars:
            elems, idx = resolve_all_selectors(
                self._browser, step, self._timeout_s(step)
            )
            if not elems:
                # Fall back to single-element resolution; tolerant of empty.
                elem, idx = resolve_selector(
                    self._browser, step, self._timeout_s(step)
                )
                if elem is None:
                    return StepResult(
                        step.id, step.kind, False,
                        error="fill: element not found", matched_candidate=idx,
                    )
                # Single element → type whole value (tolerant).
                return self._fill_single(
                    step, elem, idx, resolved_value, js_set_value
                )
            if len(resolved_value) != len(elems):
                return StepResult(
                    step.id, step.kind, False,
                    error=(
                        f"fill: split_chars value length {len(resolved_value)} "
                        f"!= element count {len(elems)}"
                    ),
                    matched_candidate=idx,
                )
            for char, elem in zip(resolved_value, elems, strict=True):
                try:
                    elem.clear()
                except Exception:  # noqa: BLE001
                    pass
                elem.input(char)
            return StepResult(step.id, step.kind, True, matched_candidate=idx)

        # Non-split path: single element.
        elem, idx = resolve_selector(self._browser, step, self._timeout_s(step))
        if elem is None:
            return StepResult(
                step.id, step.kind, False,
                error="fill: element not found", matched_candidate=idx,
            )
        return self._fill_single(step, elem, idx, resolved_value, js_set_value)

    def _fill_single(
        self,
        step: ScenarioStep,
        elem: Any,
        idx: int | None,
        resolved_value: str,
        js_set_value: bool,
    ) -> StepResult:
        """Fill a single element with read-back verification.

        When ``js_set_value`` is truthy, set the value via browser JS using
        the native setter pattern (Object.getOwnPropertyDescriptor +
        dispatch input/change events) instead of native typing — needed for
        hidden inputs that cannot be typed into directly (openai birthday).
        Then run the normal read-back verification.
        """
        if js_set_value:
            self._js_set_value(elem, resolved_value)
        else:
            try:
                elem.clear()
            except Exception:  # noqa: BLE001
                pass
            elem.input(resolved_value)

        # Read-back verification: AWS signin remounts the form while the
        # Shortbread cookie banner script loads, silently losing the typed
        # value.  Re-input up to 2 more times if the value isn't reflected.
        if resolved_value == "":
            return StepResult(step.id, step.kind, True, matched_candidate=idx)

        max_attempts = 3  # initial input + 2 retries
        for attempt in range(max_attempts):
            current = _read_back_value(elem)
            if current is None:
                logger.debug(
                    "fill: step %s element has no value read-back; "
                    "skipping verification",
                    step.id,
                )
                return StepResult(step.id, step.kind, True, matched_candidate=idx)
            if current == resolved_value:
                return StepResult(step.id, step.kind, True, matched_candidate=idx)
            if attempt < max_attempts - 1:
                logger.debug(
                    "fill: step %s value not reflected (attempt %d/%d); "
                    "re-inputting after page remount",
                    step.id, attempt + 1, max_attempts - 1,
                )
                time.sleep(0.7)
                elem, idx = resolve_selector(
                    self._browser, step, self._timeout_s(step)
                )
                if elem is None:
                    return StepResult(
                        step.id, step.kind, False,
                        error="fill: element disappeared during read-back retry",
                        matched_candidate=idx,
                    )
                if js_set_value:
                    self._js_set_value(elem, resolved_value)
                else:
                    try:
                        elem.clear()
                    except Exception:  # noqa: BLE001
                        pass
                    elem.input(resolved_value)

        return StepResult(
            step.id, step.kind, False,
            error=(
                f"fill: typed value not reflected after {max_attempts} attempts "
                f"(page remount?)"
            ),
            matched_candidate=idx,
        )

    def _js_set_value(self, elem: Any, value: str) -> None:
        """Set ``value`` on ``elem`` via browser JS using the native setter.

        Uses the repo's established pattern (kiro_v2/browser.py:1430,
        openai/browser.py:661): ``Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value').set`` + dispatch input/change
        events.  Needed for hidden inputs that reject native typing.
        """
        # DrissionPage ChromiumElement exposes a str locator via .attr() or
        # a JS-evaluable selector.  We use the element's own JS context via
        # page.run_js when available; element.run_js as fallback.
        run_js = getattr(self._browser, "run_js", None)
        if run_js is None:
            # No JS channel — fall back to native input (best-effort).
            try:
                elem.clear()
            except Exception:  # noqa: BLE001
                pass
            elem.input(value)
            return
        # Escape single quotes for safe JS string interpolation.
        safe_value = value.replace("\\", "\\\\").replace("'", "\\'")
        script = (
            "const el = arguments[0];"
            "if (el) {"
            "  const setter = Object.getOwnPropertyDescriptor("
            "    window.HTMLInputElement.prototype, 'value').set;"
            f"  setter.call(el, '{safe_value}');"
            "  el.dispatchEvent(new Event('input', {bubbles:true}));"
            "  el.dispatchEvent(new Event('change', {bubbles:true}));"
            "}"
        )
        try:
            run_js(script, elem)
        except Exception:  # noqa: BLE001 — best-effort JS set
            # Fallback: page-level querySelector if element arg unsupported.
            try:
                run_js(
                    "const el = document.querySelector(arguments[0]);"
                    "if (el) {"
                    "  const setter = Object.getOwnPropertyDescriptor("
                    "    window.HTMLInputElement.prototype, 'value').set;"
                    f"  setter.call(el, '{safe_value}');"
                    "  el.dispatchEvent(new Event('input', {bubbles:true}));"
                    "  el.dispatchEvent(new Event('change', {bubbles:true}));"
                    "}"
                )
            except Exception:  # noqa: BLE001
                try:
                    elem.clear()
                except Exception:  # noqa: BLE001
                    pass
                elem.input(value)

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
        # Mode resolution — tolerant of both encodings:
        #   new:    meta={"assert": "url_contains", "poll": true}  (kiro scenario)
        #   legacy: meta={"url_contains": "<substring>"}           (old tests)
        mode = meta.get("assert") or (
            "url_contains" if "url_contains" in meta else "selector_exists"
        )
        if mode not in ("url_contains", "selector_exists"):
            logger.warning(
                "assert: step %s has unknown mode %r — falling back to selector_exists",
                step.id, mode,
            )
            mode = "selector_exists"

        poll = bool(meta.get("poll"))
        deadline = time.time() + self._timeout_s(step)

        if mode == "url_contains":
            # Target substring: step.url first (kiro scenario encodes the
            # expected OAuth callback URL there), then legacy meta keys.
            target = step.url or meta.get("url") or meta.get("url_contains") or ""
            if not target:
                return StepResult(
                    step.id, step.kind, False,
                    error="assert: url_contains mode requires step.url or meta.url/url_contains",
                )
            while True:
                if target in (self._browser.url or ""):
                    return StepResult(step.id, step.kind, True)
                if not poll or time.time() >= deadline:
                    return StepResult(
                        step.id, step.kind, False,
                        error=f"assert: url does not contain '{target}'"
                        + (" (poll timeout)" if poll else ""),
                    )
                time.sleep(1.0)

        # selector_exists (default + unknown-mode fallback)
        while True:
            elem, idx = resolve_selector(self._browser, step, self._timeout_s(step))
            if elem is not None:
                return StepResult(step.id, step.kind, True, matched_candidate=idx)
            if not poll or time.time() >= deadline:
                return StepResult(
                    step.id, step.kind, False,
                    error="assert: element not found"
                    + (" (poll timeout)" if poll else ""),
                    matched_candidate=idx,
                )
            time.sleep(1.0)

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
        return totp_register_capability(step, self._browser, self._store)

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
