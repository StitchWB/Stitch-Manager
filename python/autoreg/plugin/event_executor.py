"""Step-event emitting ScenarioExecutor used by the plugin provider adapter."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .executor import ScenarioExecutor

if TYPE_CHECKING:
    from ..scenario.schema import ScenarioStep, ScenarioV2
    from .capabilities import StepResult


class _EventEmittingExecutor(ScenarioExecutor):
    """ScenarioExecutor subclass that emits step events via transport.

    Events: ``step_started``, ``step_completed``, ``step_failed`` — matching
    the event names built-in providers use through ``PipeTransport``.
    Transport failures are silently swallowed so they never crash the
    scenario execution.
    """

    def __init__(
        self,
        scenario: ScenarioV2,
        browser: Any,
        *,
        store: dict[str, Any] | None = None,
        imap_config: dict[str, Any] | None = None,
        transport: Any = None,
        proxy: str | None = None,
    ) -> None:
        super().__init__(
            scenario, browser, store=store, imap_config=imap_config, proxy=proxy
        )
        self._transport = transport

    def _dispatch(self, step: ScenarioStep) -> StepResult:
        if self._transport is not None:
            try:
                self._transport.emit("step_started", {
                    "step_id": step.id,
                    "kind": step.kind,
                })
            except Exception:
                pass
        result = super()._dispatch(step)
        if self._transport is not None:
            try:
                if result.success and not result.skipped:
                    self._transport.emit("step_completed", {
                        "step_id": step.id,
                        "kind": step.kind,
                        "matched_candidate": result.matched_candidate,
                    })
                elif not result.success:
                    self._transport.emit("step_failed", {
                        "step_id": step.id,
                        "kind": step.kind,
                        "error": result.error,
                    })
            except Exception:
                pass
        return result
