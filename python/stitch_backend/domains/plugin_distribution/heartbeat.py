"""Heartbeat client — revocation check at startup (plan §3.2 item 8).

POST /heartbeat with Bearer token.  200 → not revoked; 403 → revoked;
network error → offline grace: if the last successful heartbeat is within
``STITCH_OFFLINE_GRACE_DAYS`` (default 7), cached plugins keep working;
otherwise the client enters degraded mode.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import httpx

from .config import offline_grace_days, server_url

if TYPE_CHECKING:
    from .activation import ActivationService, ActivationState

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    """Current timezone-aware UTC datetime (module-level for test monkeypatching)."""
    return datetime.now(UTC)


def _parse_iso(ts: str) -> datetime | None:
    """Parse an ISO-8601 timestamp; return None if empty or unparseable."""
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(ts)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


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
            self._apply_offline_grace(state)
            return None

        if resp.status_code == 200:
            revoked = bool(resp.json().get("revoked", False))
            self._activation.set_degraded(revoked)
            self._activation.record_heartbeat_success(_utc_now().isoformat())
            return revoked

        if resp.status_code == 403:
            logger.warning("Token revoked — entering degraded mode")
            self._activation.set_degraded(True)
            return True

        logger.warning("Heartbeat unexpected status %d", resp.status_code)
        return None

    def _apply_offline_grace(self, state: ActivationState) -> None:
        """Enter degraded mode if the offline grace period has been exceeded."""
        grace_days = offline_grace_days()
        last = _parse_iso(state.last_successful_heartbeat)
        if last is None:
            logger.warning(
                "Offline with no prior heartbeat — entering degraded mode"
            )
            self._activation.set_degraded(True)
            return
        now = _utc_now()
        if (now - last) > timedelta(days=grace_days):
            logger.warning(
                "Offline beyond %d-day grace period — entering degraded mode",
                grace_days,
            )
            self._activation.set_degraded(True)
            return
        logger.info(
            "Offline within %d-day grace period — cached plugins active",
            grace_days,
        )
