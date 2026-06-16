"""Local HTTP callback server for OAuth redirect.

Runs a temporary HTTP server that listens for the OAuth callback
redirect, captures the authorization code, and shuts down.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse

logger = logging.getLogger(__name__)


class OAuthCallbackServer:
    """Temporary HTTP server to capture OAuth callback codes."""

    def __init__(self, port: int = 25585) -> None:
        self._port = port
        self._code: str | None = None
        self._state: str | None = None
        self._event = asyncio.Event()

    async def wait_for_callback(self, timeout: float = 300) -> dict[str, str]:
        """Start the callback server and wait for the OAuth redirect.

        Returns:
            Dict with ``code`` and ``state`` from the redirect.

        Raises:
            TimeoutError: If no callback received within timeout.
        """
        app = FastAPI()

        @app.get("/oauth/callback")
        async def callback(request: Request):
            self._code = request.query_params.get("code")
            self._state = request.query_params.get("state")
            self._event.set()
            return HTMLResponse(
                "<html><body><h1>Authorization successful!</h1>"
                "<p>You can close this window.</p></body></html>"
            )

        import uvicorn

        config = uvicorn.Config(app, host="127.0.0.1", port=self._port, log_level="error")
        server = uvicorn.Server(config)

        # Run server in background
        task = asyncio.create_task(server.serve())

        try:
            await asyncio.wait_for(self._event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            raise TimeoutError(f"OAuth callback not received within {timeout}s") from None
        finally:
            server.should_exit = True
            await task

        return {"code": self._code or "", "state": self._state or ""}

    @property
    def callback_url(self) -> str:
        return f"http://localhost:{self._port}/oauth/callback"
