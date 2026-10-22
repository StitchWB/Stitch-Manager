"""Captcha solver resolution seam (Zone-1 provider kit).

Engine-pack first (signed, gated distribution channel), autoreg.captcha
fallback (host-private Zone-2). Both imports are function-level on
purpose: open-core builds ship without ``autoreg.captcha``, so a
module-level import would break the Zone-1 export, and the engine-pack
loader pulls the plugin crypto stack which providers should not pay for
at import time.
"""

from __future__ import annotations

import importlib


def resolve_solver_class(name: str, class_name: str | None = None) -> type | None:
    """Resolve a captcha solver class; ``None`` when nothing is available.

    ``name`` is the solver module name (``"turnstile"``,
    ``"aliyun_slider"``). ``class_name`` defaults to the module's
    CamelCase form plus ``"Solver"`` (``turnstile`` ->
    ``TurnstileSolver``); pass it explicitly for names that do not follow
    the convention (``"hcaptcha"`` -> ``"HCaptchaSolver"``). Never raises.
    """
    if class_name is None:
        class_name = "".join(part.capitalize() for part in name.split("_")) + "Solver"
    try:
        from ..plugin.engine_pack import get_solver_class

        cls = get_solver_class(name, class_name)
        if cls is not None:
            return cls
    except Exception:  # noqa: BLE001 - degrade to the captcha fallback
        pass
    try:
        module = importlib.import_module(f"autoreg.captcha.{name}")
        cls = getattr(module, class_name, None)
        return cls if isinstance(cls, type) else None
    except Exception:  # noqa: BLE001 - no solver available
        return None


__all__ = ["resolve_solver_class"]
