"""Turnstile Solver command handlers."""

from __future__ import annotations

from stitch_backend.core.command_registry import register_command


@register_command("start_turnstile_solver")
async def cmd_start_turnstile_solver(params: dict) -> dict:
    """Start the D3-vin turnstile solver subprocess."""
    from stitch_backend.domains.turnstile_solver.service import TurnstileSolverService

    return await TurnstileSolverService.start(params.get("settings", params))


@register_command("stop_turnstile_solver")
async def cmd_stop_turnstile_solver(params: dict) -> dict:
    """Stop the D3-vin turnstile solver subprocess."""
    from stitch_backend.domains.turnstile_solver.service import TurnstileSolverService

    return await TurnstileSolverService.stop()


@register_command("get_turnstile_solver_status")
async def cmd_get_turnstile_solver_status(params: dict) -> dict:
    """Get current turnstile solver process status."""
    from stitch_backend.domains.turnstile_solver.service import TurnstileSolverService

    try:
        return TurnstileSolverService.status()
    except Exception:  # noqa: BLE001
        return {
            "status": "stopped", "port": 0, "pid": None,
            "uptimeSeconds": None, "error": None,
        }
