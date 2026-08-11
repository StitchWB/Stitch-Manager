"""Heartbeat client — revocation check at startup (plan §3.2 item 8).

POST /heartbeat with Bearer token.  200 → not revoked; 403 → revoked;
network error → silent (offline grace, never hard-fail startup).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import httpx

from .config import server_url

if TYPE_CHECKING:
    from .activation import ActivationService

logger = logging.getLogger(__name__)


class HeartbeatClient:
    """Check token revocation status against the server."""

    def __init__(
        self,
        activation: ActivationService,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._activation = activation
        self._client = client

    def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=15.0)
        return self._client

    async def ping(self) -> bool | None:
        """Ping the server.

        Returns:
            True  — token is revoked (degraded flag set in activation state).
            False — token is active (degraded flag cleared).
            None  — network error or unexpected status (offline grace).
        """
        state = self._activation.load()
        if state is None:
            return None

        url = f"{server_url()}/heartbeat"
        client = self._ensure_client()
        try:
            resp = await client.post(
                url, headers={"Authorization": f"Bearer {state.token}"}
            )
        except httpx.HTTPError as exc:
            logger.info("Heartbeat network error (offline grace): %s", exc)
            return None

        if resp.status_code == 200:
            revoked = bool(resp.json().get("revoked", False))
            self._activation.set_degraded(revoked)
            return revoked

        if resp.status_code == 403:
            logger.warning("Token revoked — entering degraded mode")
            self._activation.set_degraded(True)
            return True

        logger.warning("Heartbeat unexpected status %d", resp.status_code)
        return None
