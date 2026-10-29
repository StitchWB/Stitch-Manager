"""Report client — POST scrubbed failure bundles to the server (plan §3.4, §7 Phase 4).

Mirrors :class:`HeartbeatClient` structure: reads activation state, POSTs
with Bearer token, silent on failure (telemetry must never break a run or
startup).  The bundle is already scrubbed by :mod:`autoreg.plugin.reporter`
before upload — the server does not inspect contents.
"""

from __future__ import annotations

import base64
import json
import logging
from typing import TYPE_CHECKING, Any

import httpx

from .config import server_url

if TYPE_CHECKING:
    from .activation import ActivationService

logger = logging.getLogger(__name__)


class ReportClient:
    """Send scrubbed failure-report bundles to the distribution server."""

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

    async def send(self, bundle: dict[str, Any]) -> bool:
        """POST a scrubbed bundle to ``/reports/json``.

        Returns True on 2xx, False on network error / 4xx / 5xx / no
        activation.  Never raises — telemetry must not break a run.
        """
        state = self._activation.load()
        if state is None:
            return False

        url = f"{server_url()}/reports/json"
        body = {
            "plugin_id": bundle.get("plugin_id", ""),
            "version": bundle.get("version", ""),
            "step": bundle.get("step", ""),
            "bundle": base64.b64encode(
                json.dumps(bundle).encode("utf-8")
            ).decode("ascii"),
        }
        client = self._ensure_client()
        try:
            resp = await client.post(
                url,
                json=body,
                headers={"Authorization": f"Bearer {state.token}"},
            )
        except httpx.HTTPError as exc:
            logger.info("Report send network error (silent): %s", exc)
            return False

        if 200 <= resp.status_code < 300:
            return True

        logger.info("Report send non-2xx status %d (silent)", resp.status_code)
        return False
