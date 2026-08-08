"""Z.AI session initialization — guest auth, JWT decode, fe_version scraping.

Python port of GLM-ZAI-2API zai.go session logic.
"""

from __future__ import annotations

import base64
import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Protocol, cast

logger = logging.getLogger(__name__)

ZAI_BASE_URL: str = "https://chat.z.ai"
DEFAULT_FE_VERSION: str = "prod-fe-1.0.185"

_FE_VERSION_RE = re.compile(rb"prod-fe-\d+\.\d+\.\d+")


class ZaiSessionHttpClient(Protocol):
    async def get(self, url: str, headers: dict[str, str] | None = None) -> tuple[int, str]: ...
    async def post(self, url: str, body: str, headers: dict[str, str] | None = None) -> tuple[int, str]: ...


class HttpxZaiSessionClient:
    def __init__(self, proxy: str | None = None):
        self._proxy = proxy

    async def get(self, url: str, headers: dict[str, str] | None = None) -> tuple[int, str]:
        import httpx
        async with httpx.AsyncClient(timeout=15.0, proxy=self._proxy) as client:
            resp = await client.get(url, headers=headers or {})
            return resp.status_code, resp.text

    async def post(self, url: str, body: str, headers: dict[str, str] | None = None) -> tuple[int, str]:
        import httpx
        async with httpx.AsyncClient(timeout=15.0, proxy=self._proxy) as client:
            resp = await client.post(url, content=body, headers=headers or {})
            return resp.status_code, resp.text


@dataclass(frozen=True, slots=True)
class ZaiSessionInfo:
    token: str
    user_id: str
    user_name: str
    fe_version: str


class ZaiSessionError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        super().__init__(message)


def decode_jwt_payload(token: str) -> dict[str, Any]:
    """Decode the payload section of a JWT (base64url, no padding)."""
    parts = token.split(".")
    if len(parts) < 2:
        raise ZaiSessionError("invalid_jwt", "Token is not a valid JWT")
    payload_bytes = base64.urlsafe_b64decode(parts[1] + "==")
    return cast("dict[str, Any]", json.loads(payload_bytes))


async def scrape_fe_version(client: ZaiSessionHttpClient) -> str:
    """Fetch chat.z.ai homepage and extract prod-fe-x.y.z version."""
    try:
        _, body = await client.get(ZAI_BASE_URL)
        match = _FE_VERSION_RE.search(body.encode("utf-8"))
        if match:
            version = match.group(0).decode("ascii")
            logger.debug("Scraped fe_version: %s", version)
            return version
    except Exception:
        logger.debug("Failed to scrape fe_version, using default")
    return DEFAULT_FE_VERSION


async def initialize_session(
    client: ZaiSessionHttpClient | None = None,
    zai_token: str = "",
) -> ZaiSessionInfo:
    """Initialize a Z.AI session.

    If *zai_token* is provided, use it directly (skip guest init).
    Otherwise, perform the guest auth flow:
      1. POST /api/v1/auths/guest (warm up)
      2. GET /api/v1/auths/
      3. Retry guest endpoint if needed
    """
    if client is None:
        from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy
        client = HttpxZaiSessionClient(proxy=_get_outbound_proxy())

    headers = {
        "Origin": ZAI_BASE_URL,
        "Referer": f"{ZAI_BASE_URL}/",
        "Content-Type": "application/json",
    }

    # Fast path: use provided JWT
    if zai_token:
        logger.debug("Using provided ZAI_TOKEN, skipping guest init")
        user_id = ""
        user_name = "Guest"
        try:
            payload = decode_jwt_payload(zai_token)
            user_id = str(payload.get("id", ""))
            email = str(payload.get("email", ""))
            if email:
                user_name = email.split("@")[0]
        except ZaiSessionError:
            logger.debug("Token decode failed, continuing with raw token")

        fe_version = await scrape_fe_version(client)
        return ZaiSessionInfo(
            token=zai_token,
            user_id=user_id,
            user_name=user_name,
            fe_version=fe_version,
        )

    # Guest flow
    logger.info("Initializing Z.AI guest session...")

    fe_version = await scrape_fe_version(client)

    # Warm up guest endpoint
    await client.post(f"{ZAI_BASE_URL}/api/v1/auths/guest", "{}", headers)

    # Try GET /api/v1/auths/
    status, body = await client.get(f"{ZAI_BASE_URL}/api/v1/auths/", headers)
    token = ""

    if status == 200:
        try:
            data = json.loads(body)
            token = str(data.get("token", ""))
        except (json.JSONDecodeError, TypeError):
            pass

    if not token:
        # Retry guest endpoint
        status, body = await client.post(f"{ZAI_BASE_URL}/api/v1/auths/guest", "{}", headers)
        try:
            data = json.loads(body)
            token = str(data.get("token", ""))
        except (json.JSONDecodeError, TypeError):
            pass

    if not token:
        raise ZaiSessionError("no_token", "No token received from Z.AI guest auth")

    user_id = ""
    user_name = "Guest"
    try:
        payload = decode_jwt_payload(token)
        user_id = str(payload.get("id", ""))
        email = str(payload.get("email", ""))
        if email:
            user_name = email.split("@")[0]
    except ZaiSessionError:
        logger.debug("Guest token decode failed, but continuing")

    logger.info("Z.AI guest session initialized: user=%s", user_name)
    return ZaiSessionInfo(
        token=token,
        user_id=user_id,
        user_name=user_name,
        fe_version=fe_version,
    )
