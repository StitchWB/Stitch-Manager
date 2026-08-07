"""Cross-cutting middleware: error handling, request timing, logging."""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from stitch_backend.core.exceptions import StitchError

logger = logging.getLogger(__name__)

#: Paths polled frequently by the frontend UI — logged at DEBUG to keep
#: the INFO access log focused on meaningful user actions.
NOISY_PATHS: frozenset[str] = frozenset({
    "/api/holone/status",
    "/api/holone/findings",
    "/api/get_proxy_status",
    "/api/obs_ingest",
})


def install_middleware(app: FastAPI) -> None:
    """Attach all middleware to the FastAPI app.

    Middleware is applied in *reverse* order (FastAPI convention):
    the last ``add_middleware`` call runs first.
    """

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
            if request.url.path in NOISY_PATHS:
                logger.debug(
                    "%s %s → %d  (%.1f ms)",
                    request.method,
                    request.url.path,
                    response.status_code,
                    elapsed_ms,
                )
            else:
                logger.info(
                    "%s %s → %d  (%.1f ms)",
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
