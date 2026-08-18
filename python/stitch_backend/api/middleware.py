"""Cross-cutting middleware: error handling, request timing, logging."""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any

from fastapi.responses import JSONResponse

from stitch_backend.core.exceptions import StitchError

if TYPE_CHECKING:
    from fastapi import FastAPI, Request

logger = logging.getLogger(__name__)

#: Paths polled frequently by the frontend UI — logged at DEBUG to keep
#: the INFO access log focused on meaningful user actions.
#: (Dashboard/scheduler heartbeats, registration & replenishment status,
#: background manager, proxy debug drawer, key health and metrics refresh.)
NOISY_PATHS: frozenset[str] = frozenset({
    "/api/holone/status",
    "/api/holone/findings",
    "/api/get_proxy_status",
    "/api/obs_ingest",
    "/api/get_scheduler_status",
    "/api/get_scheduled_tasks",
    "/api/get_task_executions",
    "/api/get_registration_jobs",
    "/api/get_registration_status",
    "/api/get_replenishment_status",
    "/api/get_background_manager_status",
    "/api/get_proxy_debug_logs",
    "/api/get_key_health",
    "/api/metrics/summary",
})


def install_middleware(app: FastAPI) -> None:
    """Attach all middleware to the FastAPI app.

    Middleware is applied in *reverse* order (FastAPI convention):
    the last ``add_middleware`` call runs first.
    """

    # ── Auth gate (no-op when auth_enabled is off) ──────────────────────────────
    # Mounted before timing/error middleware so unauthenticated requests are
    # rejected before any handler runs.  The dispatch function is a complete
    # no-op when ``auth_enabled`` is False, so desktop single-user mode is
    # unchanged.
    from stitch_backend.domains.auth.router import auth_middleware_dispatch

    app.middleware("http")(auth_middleware_dispatch)

    # ── Request timing + access log ────────────────────────────────────────────

    @app.middleware("http")
    async def timing_middleware(request: Request, call_next: Any) -> Any:
        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000

        # Skip logging for OPTIONS preflights and quiet endpoints
        if request.method != "OPTIONS" and request.url.path not in (
            "/health",
            "/api/events",
        ):
            # ASCII-only format: non-ASCII arrows crash Windows cp1251
            # console logging inside the middleware and 500 every request.
            if request.url.path in NOISY_PATHS:
                logger.debug(
                    "%s %s -> %d  (%.1f ms)",
                    request.method,
                    request.url.path,
                    response.status_code,
                    elapsed_ms,
                )
            else:
                logger.info(
                    "%s %s -> %d  (%.1f ms)",
                    request.method,
                    request.url.path,
                    response.status_code,
                    elapsed_ms,
                )

        response.headers["X-Response-Time-Ms"] = f"{elapsed_ms:.1f}"
        return response

    # ── Domain error → HTTP mapping ────────────────────────────────────────────

    @app.exception_handler(StitchError)
    async def stitch_error_handler(request: Request, exc: StitchError) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content={"error": type(exc).__name__, "detail": exc.detail},
        )
