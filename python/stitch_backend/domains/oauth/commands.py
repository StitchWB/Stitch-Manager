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
    from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy
    from stitch_backend.domains.oauth.pkce import PKCEFlow

    flow = PKCEFlow(
        authorize_url=params.get("authorizeUrl", ""),
        token_url=params.get("tokenUrl", ""),
        client_id=params.get("clientId", ""),
    )
    flow.code_verifier = params.get("codeVerifier", "")
    proxy = _get_outbound_proxy()
    tokens = await flow.exchange_code(params.get("code", ""), proxy=proxy)
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

    With ``accountId`` the command is account-aware: the refresh token is
    read from the account row, outlook rows derive the Graph token
    endpoint/client id, and successful tokens are written back
    (``invalid_grant`` marks the account ``expired``).  Account-aware
    mode enforces ownership (shared/own/admin only) and never honors a
    caller-supplied ``tokenUrl`` for non-outlook providers when auth is
    enabled — the endpoint comes from the account's provider config.

    Without ``accountId`` (explicit params) the caller picks the token
    endpoint; when auth is enabled it must be in ``_ALLOWED_TOKEN_URLS``
    (desktop/no-auth mode is unrestricted).
    """
    account_id = str(params.get("accountId") or params.get("account_id") or "")
    if account_id:
        return await _refresh_account_token(account_id, params)

    token_url = params.get("tokenUrl", "")
    refresh_token = params.get("refreshToken", params.get("refresh_token", ""))
    client_id = params.get("clientId", params.get("client_id", ""))
    client_secret = params.get("clientSecret", params.get("client_secret", ""))

    if not token_url or not refresh_token or not client_id:
        return {"success": False, "error": "tokenUrl, refreshToken, and clientId are required"}

    if _auth_enabled() and token_url not in _ALLOWED_TOKEN_URLS:
        return {
            "success": False,
            "error": f"tokenUrl is not allowed: {token_url}",
            "reason": "token_url_not_allowed",
        }

    data = await _post_token_refresh(token_url, str(refresh_token), str(client_id), str(client_secret))
    if not data.get("success"):
        return {"success": False, "error": data.get("error")}

    logger.info("[OAuth] Token refreshed, expires_in: %s", data.get("expires_in"))
    return {
        "accessToken": data.get("access_token"),
        "refreshToken": data.get("refresh_token", refresh_token),
        "expiresIn": data.get("expires_in"),
        "tokenType": data.get("token_type", "Bearer"),
        "success": True,
    }


_GRAPH_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
_GRAPH_CLIENT_ID = "9e5f94bc-e8a4-4e73-b8be-63364c29d753"

#: refresh token must never be POSTed to an arbitrary caller-chosen URL
_ALLOWED_TOKEN_URLS: frozenset[str] = frozenset({
    _GRAPH_TOKEN_URL,
    "https://oauth2.googleapis.com/token",
    "https://securetoken.googleapis.com/v1/token",
    "https://github.com/login/oauth/access_token",
    "https://auth.x.ai/oauth2/token",
})


def _auth_enabled() -> bool:
    from stitch_backend.config import get_settings

    return get_settings().auth_enabled


def _graph_constants() -> tuple[str, str]:
    try:
        from autoreg.providers.outlook.config import CLIENT_ID, TOKEN_URL
        return TOKEN_URL, CLIENT_ID
    except ImportError:
        return _GRAPH_TOKEN_URL, _GRAPH_CLIENT_ID


def _oauth_error_detail(resp: httpx.Response) -> tuple[str, str]:
    try:
        body = resp.json()
    except Exception:
        return "", resp.text[:200]
    parts = [str(body.get(k)) for k in ("error", "error_description") if body.get(k)]
    return str(body.get("error") or ""), " ".join(parts) or resp.text[:200]


async def _post_token_refresh(
    token_url: str, refresh_token: str, client_id: str, client_secret: str = "",
) -> dict:
    """POST a ``grant_type=refresh_token`` request; never raises for HTTP errors."""
    payload = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "client_id": client_id,
    }
    if client_secret:
        payload["client_secret"] = client_secret

    proxy_url: str | None = None
    try:
        from stitch_backend.domains.kiro_proxy.server import _get_outbound_proxy
        proxy_url = _get_outbound_proxy()
    except Exception:
        pass

    try:
        async with httpx.AsyncClient(timeout=30, proxy=proxy_url) as client:
            resp = await client.post(token_url, data=payload)
    except Exception as exc:
        logger.error("[OAuth] Token refresh failed: %s", exc)
        return {"success": False, "error": str(exc)}

    if resp.status_code != 200:
        error_code, detail = _oauth_error_detail(resp)
        logger.error("[OAuth] Token refresh failed: %s", detail)
        out: dict = {"success": False, "error": f"HTTP {resp.status_code}: {detail}"}
        if error_code == "invalid_grant":
            out["invalid_grant"] = True
        return out

    try:
        data = resp.json()
    except Exception as exc:
        return {"success": False, "error": f"token response is not JSON: {exc}"}
    return {"success": True, **data}


async def _mark_account_expired(account_id: str, error: str) -> None:
    from sqlalchemy import update

    from stitch_backend.database import run_in_session
    from stitch_backend.domains.accounts.models import Account

    async def _op(db):
        await db.execute(
            update(Account).where(Account.id == account_id)
            .values(status="expired", last_error=error[:500])
        )

    await run_in_session(_op)


async def _refresh_account_token(account_id: str, params: dict) -> dict:
    from sqlalchemy import select

    from stitch_backend.database import run_in_read_session, run_in_session
    from stitch_backend.domains.accounts.models import Account
    from stitch_backend.domains.accounts.service import AccountService

    async def _load(session):
        row = (await session.execute(
            select(Account).where(Account.id == account_id)
        )).scalar_one_or_none()
        if row is None:
            return None
        return {
            "provider": row.provider,
            "refresh_token": row.refresh_token or row.token or row.api_key or "",
            "owner_id": row.owner_id,
            "provider_metadata": row.provider_metadata
            if isinstance(row.provider_metadata, dict)
            else {},
        }

    account = await run_in_read_session(_load)
    if account is None:
        return {"success": False, "error": f"account {account_id} not found"}

    caller_role = params.get("_caller_role")
    caller_user_id = params.get("_caller_user_id")
    if caller_role != "admin" and account["owner_id"] not in (None, caller_user_id):
        return {
            "success": False,
            "error": f"account {account_id} is not owned by the caller",
            "reason": "not_owned",
        }

    provider = str(account["provider"])
    metadata: dict = account["provider_metadata"]
    refresh_token = str(
        params.get("refreshToken") or params.get("refresh_token") or ""
    ) or str(account["refresh_token"] or "")
    client_secret = str(params.get("clientSecret") or params.get("client_secret") or "")

    if provider == "outlook":
        graph_url, graph_client = _graph_constants()
        token_url = graph_url
        client_id = str(metadata.get("client_id") or "") or graph_client
    else:
        token_url = str(metadata.get("token_url") or "")
        client_id = str(metadata.get("client_id") or "") or str(
            params.get("clientId") or params.get("client_id") or ""
        )
        if not token_url:
            if _auth_enabled():
                return {
                    "success": False,
                    "error": (
                        "tokenUrl cannot be caller-supplied for account refresh "
                        "when auth is enabled"
                    ),
                    "reason": "token_url_not_derived",
                }
            token_url = str(params.get("tokenUrl") or params.get("token_url") or "")

    if not token_url or not refresh_token or not client_id:
        return {"success": False, "error": "tokenUrl, refreshToken, and clientId are required"}

    data = await _post_token_refresh(token_url, refresh_token, client_id, client_secret)
    if not data.get("success"):
        if data.get("invalid_grant"):
            try:
                await _mark_account_expired(account_id, str(data.get("error")))
            except Exception as exc:
                logger.error("[OAuth] Failed to mark account %s expired: %s", account_id, exc)
        return {"success": False, "error": data.get("error"), "accountId": account_id}

    new_access = str(data.get("access_token") or "")
    new_refresh = str(data.get("refresh_token") or refresh_token)
    # outlook rows keep the refresh token in ``token`` — the pool dequeue contract
    token_value = new_refresh if provider == "outlook" else new_access

    async def _op(db):
        await AccountService(db).update_token(account_id, token_value, new_refresh)

    await run_in_session(_op)

    logger.info("[OAuth] Token refreshed for account %s, expires_in: %s",
                account_id, data.get("expires_in"))
    return {
        "accessToken": new_access,
        "refreshToken": new_refresh,
        "expiresIn": data.get("expires_in"),
        "tokenType": data.get("token_type", "Bearer"),
        "accountId": account_id,
        "success": True,
    }


# ── AWS OIDC / PKCE session management ─────────────────────────────────────────

import hashlib
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



