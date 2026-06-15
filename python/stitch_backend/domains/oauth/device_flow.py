"""OAuth 2.0 Device Authorization Flow (RFC 8628).

Used by GitHub and other providers where browser-based OAuth isn't
available (e.g. CLI/headless environments).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class DeviceFlow:
    """Manages the device authorization flow."""

    def __init__(
        self,
        device_auth_url: str,
        token_url: str,
        client_id: str,
        scope: str = "",
    ) -> None:
        self.device_auth_url = device_auth_url
        self.token_url = token_url
        self.client_id = client_id
        self.scope = scope

    async def request_device_code(self) -> dict[str, Any]:
        """Request a device code from the authorization server."""
        payload = {"client_id": self.client_id}
        if self.scope:
            payload["scope"] = self.scope

        async with httpx.AsyncClient() as client:
            resp = await client.post(self.device_auth_url, data=payload)
            resp.raise_for_status()
            data = resp.json()
            logger.info(
                "Device code obtained. User code: %s, verification URI: %s",
                data.get("user_code"), data.get("verification_uri"),
            )
            return data

    async def poll_for_token(
        self,
        device_code: str,
        interval: int = 5,
        expires_in: int = 900,
    ) -> dict[str, Any]:
        """Poll the token endpoint until the user authorizes or timeout."""
        elapsed = 0
        payload = {
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "device_code": device_code,
            "client_id": self.client_id,
        }

        async with httpx.AsyncClient() as client:
            while elapsed < expires_in:
                resp = await client.post(self.token_url, data=payload)
                data = resp.json()

                error = data.get("error")
                if error == "authorization_pending":
                    await asyncio.sleep(interval)
                    elapsed += interval
                    continue
                elif error == "slow_down":
                    interval += 5
                    await asyncio.sleep(interval)
                    elapsed += interval
                    continue
                elif error:
                    raise Exception(f"Device flow error: {error} — {data.get('error_description')}")

                logger.info("Device flow: token obtained successfully")
                return data

        raise TimeoutError(f"Device flow expired after {expires_in}s")
