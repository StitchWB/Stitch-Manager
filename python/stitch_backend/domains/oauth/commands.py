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


# ── AWS OIDC / PKCE session management ─────────────────────────────────────────

import asyncio
import hashlib
import os
import secrets
import time
import uuid
from typing import Any

# In-memory session store (mirrors Rust OAUTH_SESSIONS lazy_static)
_OAUTH_SESSIONS: dict[str, dict[str, Any]] = {}
_SESSION_TIMEOUT_SECS = 600  # 10 minutes


def _cleanup_expired_sessions() -> None:
    now = time.monotonic()
    expired = [sid for sid, s in _OAUTH_SESSIONS.items()
               if now - s["_created_mono"] >= _SESSION_TIMEOUT_SECS]
    for sid in expired:
        _OAUTH_SESSIONS.pop(sid, None)
        logger.info("[OAuth] Cleaned up expired session: %s", sid)


@register_command("generate_pkce_challenge")
async def cmd_generate_pkce_challenge(params: dict) -> dict:
    """Generate a PKCE code_verifier / code_challenge / state triple."""
    code_verifier = secrets.token_urlsafe(64)[:128]
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    import base64
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    state = str(uuid.uuid4())
    return {
        "codeVerifier": code_verifier,
        "codeChallenge": code_challenge,
        "state": state,
    }


@register_command("start_oauth_session")
async def cmd_start_oauth_session(params: dict) -> dict:
    """Start a new AWS OIDC PKCE session.

    Mirrors Rust ``start_oauth_session`` — generates PKCE, returns auth URL.
    """
    _cleanup_expired_sessions()

    account_name = params.get("accountName", params.get("account_name", ""))
    port = int(params.get("port", 25584))

    # Generate PKCE challenge
    code_verifier = secrets.token_urlsafe(64)[:128]
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    import base64
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    state = str(uuid.uuid4())
    session_id = str(uuid.uuid4())
    client_id = f"stitch-{account_name}-{session_id[:8]}"
    redirect_uri = f"http://localhost:{port}/oauth/callback"
    auth_url = (
        f"https://oidc.us-east-1.amazonaws.com/authorize?"
        f"client_id={client_id}&response_type=code&redirect_uri={redirect_uri}"
        f"&state={state}&code_challenge={code_challenge}&code_challenge_method=S256"
        f"&scope=openid+profile+email"
    )

    _OAUTH_SESSIONS[session_id] = {
        "sessionId": session_id,
        "clientId": client_id,
        "clientSecret": secrets.token_urlsafe(32),
        "codeVerifier": code_verifier,
        "authUrl": auth_url,
        "redirectUri": redirect_uri,
        "state": state,
        "accountName": account_name,
        "_created_mono": time.monotonic(),
    }

    logger.info("[OAuth] Session %s started for %s", session_id, account_name)
    return {
        "sessionId": session_id,
        "clientId": client_id,
        "authUrl": auth_url,
        "redirectUri": redirect_uri,
        "state": state,
    }


@register_command("cancel_oauth_session")
async def cmd_cancel_oauth_session(params: dict) -> dict:
    """Cancel/cleanup an OAuth session."""
    session_id = params.get("sessionId", params.get("session_id", ""))
    removed = _OAUTH_SESSIONS.pop(session_id, None) is not None
    if removed:
        logger.info("[OAuth] Session %s cancelled", session_id)
    return {"success": True}


@register_command("get_oauth_sessions_count")
async def cmd_get_oauth_sessions_count(params: dict) -> int:
    """Return the number of active OAuth sessions."""
    return len(_OAUTH_SESSIONS)



