"""OAuth domain command handlers."""

from __future__ import annotations

import logging

import httpx

from stitch_backend.core.command_registry import register_command

logger = logging.getLogger(__name__)


@register_command("start_oauth_pkce")
async def cmd_start_oauth_pkce(params: dict) -> dict:
    """Start a PKCE OAuth flow — returns the authorization URL."""
    from stitch_backend.domains.oauth.pkce import PKCEFlow

    flow = PKCEFlow(
        authorize_url=params.get("authorizeUrl", ""),
        token_url=params.get("tokenUrl", ""),
        client_id=params.get("clientId", ""),
        redirect_uri=params.get("redirectUri", "http://localhost:25584/api/oauth/callback"),
        scope=params.get("scope", "openid profile email"),
    )
    auth_url = flow.get_authorization_url(state=params.get("state"))
    return {"authorizationUrl": auth_url, "codeVerifier": flow.code_verifier}


@register_command("exchange_oauth_code")
async def cmd_exchange_oauth_code(params: dict) -> dict:
    """Exchange an authorization code for tokens."""
    from stitch_backend.domains.oauth.pkce import PKCEFlow

    flow = PKCEFlow(
        authorize_url=params.get("authorizeUrl", ""),
        token_url=params.get("tokenUrl", ""),
        client_id=params.get("clientId", ""),
    )
    flow.code_verifier = params.get("codeVerifier", "")
    tokens = await flow.exchange_code(params.get("code", ""))
    return tokens


@register_command("start_device_flow")
async def cmd_start_device_flow(params: dict) -> dict:
    """Start a device authorization flow."""
    from stitch_backend.domains.oauth.device_flow import DeviceFlow

    flow = DeviceFlow(
        device_auth_url=params.get("deviceAuthUrl", ""),
        token_url=params.get("tokenUrl", ""),
        client_id=params.get("clientId", ""),
        scope=params.get("scope", ""),
    )
    device_data = await flow.request_device_code()
    return {
        "userCode": device_data.get("user_code"),
        "verificationUri": device_data.get("verification_uri"),
        "deviceCode": device_data.get("device_code"),
        "expiresIn": device_data.get("expires_in", 900),
        "interval": device_data.get("interval", 5),
    }


@register_command("poll_device_flow")
async def cmd_poll_device_flow(params: dict) -> dict:
    """Poll the token endpoint for a device flow until the user authorizes or timeout."""
    from stitch_backend.domains.oauth.device_flow import DeviceFlow

    flow = DeviceFlow(
        device_auth_url=params.get("deviceAuthUrl", ""),
        token_url=params.get("tokenUrl", ""),
        client_id=params.get("clientId", ""),
        scope=params.get("scope", ""),
    )
    device_code = params.get("deviceCode", "")
    interval = int(params.get("interval", 5))
    expires_in = int(params.get("expiresIn", 900))

    tokens = await flow.poll_for_token(device_code, interval=interval, expires_in=expires_in)
    return {
        "accessToken": tokens.get("access_token"),
        "refreshToken": tokens.get("refresh_token"),
        "tokenType": tokens.get("token_type", "Bearer"),
        "expiresIn": tokens.get("expires_in"),
    }


@register_command("refresh_oauth_token")
async def cmd_refresh_oauth_token(params: dict) -> dict:
    """Refresh an access token using a refresh token.

    Sends a ``grant_type=refresh_token`` request to the token endpoint.
    Mirrors the Rust ``refresh_oauth_token`` command.
    """
    token_url = params.get("tokenUrl", "")
    refresh_token = params.get("refreshToken", params.get("refresh_token", ""))
    client_id = params.get("clientId", params.get("client_id", ""))
    client_secret = params.get("clientSecret", params.get("client_secret", ""))

    if not token_url or not refresh_token or not client_id:
        return {"success": False, "error": "tokenUrl, refreshToken, and clientId are required"}

    payload = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
    }
    if client_secret:
        payload["client_secret"] = client_secret

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(token_url, data=payload)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPStatusError as exc:
        logger.error("[OAuth] Token refresh failed: %s", exc.response.text)
        return {"success": False, "error": f"HTTP {exc.response.status_code}: {exc.response.text}"}
    except Exception as exc:
        logger.error("[OAuth] Token refresh failed: %s", exc)
        return {"success": False, "error": str(exc)}

    logger.info("[OAuth] Token refreshed, expires_in: %s", data.get("expires_in"))
    return {
        "accessToken": data.get("access_token"),
        "refreshToken": data.get("refresh_token", refresh_token),
        "expiresIn": data.get("expires_in"),
        "tokenType": data.get("token_type", "Bearer"),
        "success": True,
    }
