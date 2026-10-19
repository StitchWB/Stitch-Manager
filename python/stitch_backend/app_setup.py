"""App-local middleware (origin guard, cache control) and meta/static route registration.

Called from :func:`stitch_backend.main.create_app`; the call order there is
load-bearing (middleware wraps in reverse registration order, and /health must
be registered before the SPA catch-all).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from stitch_backend.config import REPO_ROOT

if TYPE_CHECKING:
    from fastapi import FastAPI

    from stitch_backend.config import Settings

logger = logging.getLogger(__name__)

# Raw-socket clients (curl/malware) send no Origin header; the renderer always sends one.
_NO_ORIGIN_SENSITIVE = {"/api/get_found_key_secret"}


def install_local_middleware(app: FastAPI, settings: Settings) -> None:
    # No auth layer (localhost desktop model): CORS is not enough, reject foreign Origins server-side.
    @app.middleware("http")
    async def origin_guard(request, call_next):
        if request.url.path.startswith("/api/"):
            origin = request.headers.get("origin")
            if origin is not None and origin not in settings.cors_origin_list:
                return JSONResponse(
                    status_code=403,
                    content={"error": {"message": "origin not allowed"}},
                )
            if origin is None and request.url.path in _NO_ORIGIN_SENSITIVE:
                return JSONResponse(
                    status_code=403,
                    content={"error": {"message": "origin required"}},
                )
        return await call_next(request)

    @app.middleware("http")
    async def cache_control(request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif response.headers.get("content-type", "").startswith("text/html"):
            response.headers["Cache-Control"] = "no-cache"
        return response


def register_meta_routes(app: FastAPI) -> None:
    dist_dir = REPO_ROOT / "dist"
    dist_index = dist_dir / "index.html"

    # Registered BEFORE any Mount("/") so it is not shadowed by the static catch-all.
    @app.get("/health", tags=["Meta"])
    async def health() -> dict:
        return {"status": "ok"}

    if dist_index.exists():
        logger.info("Static files found at %s — serving SPA with client-route fallback", dist_dir)
        # /assets gets proper static serving; StaticFiles(html=True) alone would 404 unknown paths.
        if (dist_dir / "assets").is_dir():
            app.mount(
                "/assets", StaticFiles(directory=str(dist_dir / "assets")), name="assets"
            )

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_fallback(full_path: str) -> FileResponse:
            """Serve real dist files; unknown paths get index.html (SPA routing)."""
            if full_path:
                candidate = (dist_dir / full_path).resolve()
                if candidate.is_file() and dist_dir in candidate.parents:
                    return FileResponse(candidate)
            return FileResponse(dist_index)
    else:
        logger.info("No dist/index.html — running in API-only mode")

        @app.get("/", tags=["Meta"])
        async def root() -> dict:
            return {
                "name": "Stitch Manager v2",
                "version": "0.2.0",
                "docs": "/docs",
                "health": "/health",
            }
