"""captcha.solve capability for StepKind v2 (plan §4.3)."""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from ..scenario.schema import ScenarioStep
from .capabilities_base import StepResult, resolve_selector

logger = logging.getLogger(__name__)


def _resolve_turnstile_solver() -> type:
    """Resolve TurnstileSolver: engine-pack first, autoreg.captcha fallback."""
    from .engine_pack import get_solver_class

    cls = get_solver_class("turnstile", "TurnstileSolver")
    if cls is not None:
        return cls
    from ..captcha.turnstile import TurnstileSolver

    return TurnstileSolver


def _resolve_aliyun_solver() -> type:
    """Resolve AliyunSliderSolver: engine-pack first, autoreg.captcha fallback."""
    from .engine_pack import get_solver_class

    cls = get_solver_class("aliyun_slider", "AliyunSliderSolver")
    if cls is not None:
        return cls
    from ..captcha.aliyun_slider import AliyunSliderSolver

    return AliyunSliderSolver


def _solve_turnstile(
    browser: Any,
    step: ScenarioStep,
    *,
    resolve_solver: Callable[[], type] | None = None,
) -> bool:
    timeout = int((step.meta or {}).get("timeout", 60))
    # Engine-pack unified solver (handles the D3-vin HTTP service) first, then autoreg.captcha fallback.
    solver_cls = (resolve_solver or _resolve_turnstile_solver)()
    return bool(
        solver_cls(browser, log_callback=logger.info).solve(method="auto", timeout=timeout)
    )


def _solve_aliyun(browser: Any, step: ScenarioStep) -> bool:
    solver_cls = _resolve_aliyun_solver()
    max_attempts = int((step.meta or {}).get("max_attempts", 5))
    return bool(
        solver_cls(browser, log_callback=logger.info).solve(max_attempts=max_attempts)
    )


def _solve_im_human(browser: Any, step: ScenarioStep) -> bool:
    timeout = int((step.meta or {}).get("timeout", 60))
    click_fn = getattr(browser, "click_im_human_checkbox", None)
    if click_fn is not None:
        return bool(click_fn(timeout=timeout))
    # Bare ChromiumPage: click via the step's own selector candidates.
    elem, _idx = resolve_selector(browser, step, 3.0)
    if elem is None:
        return False
    try:
        elem.click()
    except Exception:  # noqa: BLE001
        return False
    return True


_CAPTCHA_SOLVERS: dict[str, Callable[[Any, ScenarioStep], bool]] = {
    "turnstile": _solve_turnstile,
    "aliyun": _solve_aliyun,
    "im_human": _solve_im_human,
}


def captcha_solve_capability(step: ScenarioStep, browser: Any) -> StepResult:
    """Dispatch to a captcha solver (plan §4.3 captcha.solve)."""
    meta = step.meta or {}
    provider = meta.get("provider", "")
    optional = bool(meta.get("optional", False))
    solver = _CAPTCHA_SOLVERS.get(provider)

    if solver is None:
        if optional:
            return StepResult(
                step.id, step.kind, True, skipped=True,
                skip_reason=f"no solver for provider '{provider}' (optional)",
            )
        return StepResult(
            step.id, step.kind, False,
            error=f"captcha.solve: no solver for provider '{provider}'",
        )
    try:
        ok = solver(browser, step)
        if not ok and optional:
            return StepResult(
                step.id, step.kind, True, skipped=True,
                skip_reason=f"solver '{provider}' failed (optional)",
                meta={"provider": provider},
            )
        if not ok:
            return StepResult(
                step.id, step.kind, False,
                error=f"captcha.solve: solver '{provider}' failed",
            )
        return StepResult(step.id, step.kind, True, meta={"provider": provider})
    except Exception as e:  # noqa: BLE001
        if optional:
            return StepResult(
                step.id, step.kind, True, skipped=True,
                skip_reason=f"solver '{provider}' error (optional)",
            )
        return StepResult(step.id, step.kind, False, error=f"captcha.solve: {e}")
