"""Addy.io (AnonAddy) API client.

Ported from Rust ``settings.rs`` — test_addyio_connection, get_addyio_account,
get_addyio_domains, get_addyio_recipients.

Uses httpx for async HTTP calls to https://app.addy.io/api/v1/.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_ADDY_BASE = "https://app.addy.io/api/v1"
_TIMEOUT = 15.0


def _headers(api_token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_token}",
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json",
    }


async def test_connection(api_token: str) -> dict[str, Any]:
    """Test Addy.io token — returns token details.

    Equivalent to Rust ``test_addyio_connection``.
    """
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            f"{_ADDY_BASE}/api-token-details",
            headers=_headers(api_token),
        )
        resp.raise_for_status()
        return resp.json()


async def get_account(api_token: str) -> dict[str, Any]:
    """Get Addy.io account details.

    Equivalent to Rust ``get_addyio_account``.
    """
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            f"{_ADDY_BASE}/account-details",
            headers=_headers(api_token),
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", data)


async def get_domains(api_token: str) -> dict[str, Any]:
    """Get Addy.io domain options.

    Equivalent to Rust ``get_addyio_domains``.
    """
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            f"{_ADDY_BASE}/domain-options",
            headers=_headers(api_token),
        )
        resp.raise_for_status()
        return resp.json()


async def get_recipients(api_token: str) -> list[dict[str, Any]]:
    """Get verified Addy.io recipients.

    Equivalent to Rust ``get_addyio_recipients``.
    """
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            f"{_ADDY_BASE}/recipients?filter[verified]=true",
            headers=_headers(api_token),
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", data if isinstance(data, list) else [])
