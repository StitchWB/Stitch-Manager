"""Turnstile Solver service — manages the D3-vin turnstile solver sidecar.

Thin domain wrapper over the :class:`SidecarSupervisor`. Keeps the domain
logic (locating the vendored service, choosing the Python interpreter and
port); the subprocess lifecycle itself lives in the supervisor.

The solver is a *sidecar* (a local helper process), not an AI provider. It is
consumed by ``autoreg.captcha.turnstile_api`` during account registration.
"""

from __future__ import annotations

import logging
import os
import sys
from typing import TYPE_CHECKING, Any

from stitch_backend.config import REPO_ROOT
from stitch_backend.domains.sidecar import LaunchPlan, SidecarSpec, get_supervisor

if TYPE_CHECKING:
    from pathlib import Path

logger = logging.getLogger(__name__)

SIDECAR_NAME = "turnstile_solver"
DEFAULT_PORT = 5072


def _resolve_service_dir() -> Path | None:
    """Locate the vendored D3-vin solver: engine-pack first, then dev repo."""
    try:
        from autoreg.plugin.engine_pack import locate_engine_pack

        pack = locate_engine_pack()
        if pack is not None:
            candidate = pack / "vendor" / "turnstile-solver"
            if (candidate / "api.py").is_file():
                return candidate
    except Exception:  # noqa: BLE001
        pass
    candidate = REPO_ROOT / "vendor" / "turnstile-solver"
    if (candidate / "api.py").is_file():
        return candidate
    return None


def _default_port() -> int:
    return int(os.environ.get("TURNSTILE_SOLVER_PORT", DEFAULT_PORT))


def _find_python() -> str:
    """Usable Python interpreter for the solver subprocess (frozen-aware)."""
    if not getattr(sys, "frozen", False):
        return sys.executable
    import shutil as _shutil

    for name in ("python", "python3"):
        found = _shutil.which(name)
        if found:
            return found
    return sys.executable


def _prepare(settings: dict | None) -> LaunchPlan:
    settings = settings or {}
    service_dir = _resolve_service_dir()
    if service_dir is None:
        raise RuntimeError("Turnstile solver not found (no engine-pack or vendor/)")
    port = int(settings.get("port", _default_port()))
    browser_type = (
        settings.get("browser_type")
        or os.environ.get("TURNSTILE_SOLVER_BROWSER", "chrome")
    )
    return LaunchPlan(
        command=[
            _find_python(),
            "api.py",
            "--port",
            str(port),
            "--browser_type",
            browser_type,
        ],
        cwd=str(service_dir),
        env={"PYTHONIOENCODING": "utf-8"},
        port=port,
        health_url=f"http://127.0.0.1:{port}/",
        health_ok=lambda code: code == 200,
        readiness_timeout=20.0,
        config={"port": port, "enabled": True},
    )


def _on_stop() -> None:
    """Also stop instances launched outside the supervisor.

    The registration path (autoreg) can start the solver on its own via
    the unified TurnstileSolver's _launch_service().  This hook makes
    stop/stop_all clean those up too, so nothing orphans.
    """
    # Old path: autoreg.captcha.turnstile_api (kept for backward compat).
    try:
        from autoreg.captcha.turnstile_api import shutdown_service
        shutdown_service()
    except Exception:  # noqa: BLE001
        pass
    # New path: unified solver in engine-pack.
    try:
        from autoreg.plugin.engine_pack import load_solver_module
        mod = load_solver_module("turnstile")
        if mod is not None and hasattr(mod, "shutdown_service"):
            mod.shutdown_service()
    except Exception:  # noqa: BLE001
        pass


def register_sidecar() -> None:
    """Register the turnstile solver spec with the supervisor (idempotent)."""
    sup = get_supervisor()
    if not sup.is_registered(SIDECAR_NAME):
        sup.register(
            SidecarSpec(
                name=SIDECAR_NAME,
                display_name="Turnstile Solver",
                prepare=_prepare,
                on_stop=_on_stop,
            )
        )


class TurnstileSolverService:
    """Backward-compatible facade over the :class:`SidecarSupervisor`."""

    @staticmethod
    async def start(settings: dict[str, Any] | None = None) -> dict[str, Any]:
        register_sidecar()
        # Idempotent: starting an already-running solver is a no-op.
        return await get_supervisor().start(SIDECAR_NAME, settings)

    @staticmethod
    async def stop() -> dict[str, Any]:
        register_sidecar()
        return await get_supervisor().stop(SIDECAR_NAME)

    @staticmethod
    def status() -> dict[str, Any]:
        register_sidecar()
        return get_supervisor().status(SIDECAR_NAME)
