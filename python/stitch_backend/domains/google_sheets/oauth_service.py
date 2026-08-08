"""Google Sheets OAuth 2.0 service — user-facing PKCE flow.

Reuses :class:`stitch_backend.domains.oauth.pkce.PKCEFlow` for the
authorization-code + PKCE exchange, then persists the resulting tokens to the
``settings`` table so the Google Sheets service can prefer them over the
service-account JSON fallback.

Token storage:
    - ``google_oauth_refresh_token`` — base64-encoded (ponytail: upgrade to
      Fernet/keyring when a proper secret store is wired in)
    - ``google_oauth_access_token``  — plaintext (short-lived, 1h)
    - ``google_oauth_token_expiry``  — unix timestamp (int as text)
    - ``google_oauth_email``         — the connected user's email
"""

from __future__ import annotations

import base64
import logging
import socket
import time
import uuid
from datetime import UTC
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from typing import Any, cast
from urllib.parse import parse_qs, urlparse

import httpx

from stitch_backend.database import run_in_session
from stitch_backend.domains.google_sheets.oauth_config import (
    GOOGLE_OAUTH_CONFIG,
    GOOGLE_OAUTH_SETTINGS_KEYS,
)
from stitch_backend.domains.oauth.pkce import PKCEFlow

logger = logging.getLogger(__name__)

# Refresh tokens are long-lived secrets — encode at rest.
# ponytail: base64 is NOT encryption, only obfuscation. Upgrade to
# cryptography.fernet (or keyring) when a proper secret store is available.


def _encode_secret(value: str) -> str:
    return base64.urlsafe_b64encode(value.encode()).decode()


def _decode_secret(value: str) -> str:
    try:
        return base64.urlsafe_b64decode(value.encode()).decode()
    except Exception:
        return ""  # treat corrupt entry as empty


# ── Settings table helpers ───────────────────────────────────────────────────


async def _get_setting(key: str) -> str:
    """Read a single setting value by key."""

    async def _op(session):
        from sqlalchemy import text

        row = (
            await session.execute(text("SELECT value FROM settings WHERE key = :k"), {"k": key})
        ).scalar_one_or_none()
        return row or ""

    return await run_in_session(_op)


async def _set_setting(key: str, value: str) -> None:
    """Upsert a single setting row."""

    now_iso = _utcnow_iso()

    async def _op(session):
        from sqlalchemy import text

        await session.execute(
            text(
                "INSERT INTO settings (key, value, updated_at) "
                "VALUES (:k, :v, :t) "
                "ON CONFLICT(key) DO UPDATE SET value = :v, updated_at = :t"
            ),
            {"k": key, "v": value, "t": now_iso},
        )

    await run_in_session(_op)


async def _delete_setting(key: str) -> None:
    async def _op(session):
        from sqlalchemy import text

        await session.execute(text("DELETE FROM settings WHERE key = :k"), {"k": key})

    await run_in_session(_op)


def _utcnow_iso() -> str:
    from datetime import datetime

    return datetime.now(UTC).isoformat()


# ── In-memory PKCE session store (state → code_verifier) ─────────────────────
# ponytail: module-level dict, same pattern as oauth/commands.py _OAUTH_SESSIONS.
# Upgrade to TTL cleanup if stale sessions accumulate.
_GOOGLE_PKCE_SESSIONS: dict[str, str] = {}

# ── Loopback server state ─────────────────────────────────────────────────────
# Active loopback server (if any)
_LOOPBACK_SERVER: HTTPServer | None = None
_LOOPBACK_PORT: int | None = None


def _find_free_port() -> int:
    """Find a free port on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        s.listen(1)
        port = s.getsockname()[1]
    return cast("int", port)


def _stop_loopback_server() -> None:
    """Stop the active loopback server if running."""
    global _LOOPBACK_SERVER, _LOOPBACK_PORT
    if _LOOPBACK_SERVER:
        logger.info("[GoogleOAuth] Stopping loopback server on port %d", _LOOPBACK_PORT)
        _LOOPBACK_SERVER.shutdown()
        _LOOPBACK_SERVER = None
        _LOOPBACK_PORT = None


class _OAuthCallbackHandler(BaseHTTPRequestHandler):
    """HTTP handler for OAuth callback on loopback server."""

    def do_GET(self) -> None:
        """Handle GET request from OAuth callback."""
        parsed = urlparse(self.path)
        if parsed.path != "/oauth/google/callback":
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not found")
            return

        params = parse_qs(parsed.query)
        code = params.get("code", [""])[0]
        state = params.get("state", [""])[0]
        error = params.get("error", [""])[0]

        if error:
            logger.error("[GoogleOAuth] OAuth error: %s", error)
            self.send_response(400)
            self.end_headers()
            self.wfile.write(f"OAuth error: {error}".encode())
            return

        if not code or not state:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"Missing code or state")
            return

        # Store callback data for async processing
        _GOOGLE_PKCE_SESSIONS[f"callback_{state}"] = code

        # Send success page
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(b"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Google Connected</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                       display: flex; justify-content: center; align-items: center;
                       height: 100vh; margin: 0; background: #f5f5f5; }
                .container { text-align: center; padding: 40px; background: white;
                           border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                h1 { color: #4285f4; }
                p { color: #666; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Google Connected</h1>
                <p>You can close this window and return to Stitch Manager.</p>
            </div>
            <script>setTimeout(() => window.close(), 3000);</script>
        </body>
        </html>
        """)

        # Stop server after callback
        logger.info("[GoogleOAuth] Callback received, stopping loopback server")
        Thread(target=_stop_loopback_server, daemon=True).start()

    def log_message(self, format: str, *args: Any) -> None:
        """Suppress default HTTP server logging."""
        pass


class GoogleSheetsOAuthService:
    """Manages the Google OAuth 2.0 PKCE flow for Google Sheets access."""

    def __init__(self) -> None:
        cfg = GOOGLE_OAUTH_CONFIG
        self._client_id = str(cfg["client_id"])
        self._client_secret = str(cfg["client_secret"])
        self._authorize_url = str(cfg["authorize_url"])
        self._token_url = str(cfg["token_url"])
        self._userinfo_url = str(cfg["userinfo_url"])
        self._scopes = " ".join(cast("list[str]", cfg["scopes"]))  # PKCEFlow expects a single string
        self._redirect_uri = str(cfg["redirect_uri"])

    # ── Public API ───────────────────────────────────────────────────────────

    async def start_oauth_flow(self) -> dict[str, str]:
        """Begin a new PKCE flow with loopback server.  Returns ``{authUrl, state, port}``."""
        if not self._client_id or self._client_id == "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com":
            raise ValueError(
                "Google OAuth client_id is not configured. "
                "Replace 'YOUR_CLIENT_ID_HERE' in oauth_config.py with your Desktop app client_id. "
                "See: https://console.cloud.google.com/apis/credentials"
            )

        # Stop any existing loopback server
        _stop_loopback_server()

        # Find free port and start loopback server
        port = _find_free_port()
        redirect_uri = f"http://localhost:{port}/oauth/google/callback"

        global _LOOPBACK_SERVER, _LOOPBACK_PORT
        _LOOPBACK_SERVER = HTTPServer(("localhost", port), _OAuthCallbackHandler)
        _LOOPBACK_PORT = port

        # Start server in background thread
        server_thread = Thread(target=_LOOPBACK_SERVER.serve_forever, daemon=True)
        server_thread.start()
        logger.info("[GoogleOAuth] Started loopback server on port %d", port)

        # Create PKCE flow with dynamic redirect_uri
        flow = PKCEFlow(
            authorize_url=self._authorize_url,
            token_url=self._token_url,
            client_id=self._client_id,
            redirect_uri=redirect_uri,
            scope=self._scopes,
        )
        state = str(uuid.uuid4())
        _GOOGLE_PKCE_SESSIONS[state] = flow.code_verifier

        auth_url = flow.get_authorization_url(state=state)
        logger.info("[GoogleOAuth] Started PKCE flow, state=%s, port=%d", state, port)
        return {"authUrl": auth_url, "state": state, "port": str(port)}

    async def handle_callback(self, code: str, state: str) -> dict[str, Any]:
        """Exchange the authorization code for tokens and persist them.

        Returns ``{success, email}`` on success or ``{success: False, error}``.
        """
        code_verifier = _GOOGLE_PKCE_SESSIONS.pop(state, "")
        if not code_verifier:
            return {"success": False, "error": "Unknown or expired OAuth state"}

        # Use the same redirect_uri that was used in start_oauth_flow
        redirect_uri = f"http://localhost:{_LOOPBACK_PORT or 25584}/oauth/google/callback"

        flow = PKCEFlow(
            authorize_url=self._authorize_url,
            token_url=self._token_url,
            client_id=self._client_id,
            redirect_uri=redirect_uri,
            scope=self._scopes,
        )
        flow.code_verifier = code_verifier

        try:
            tokens = await flow.exchange_code(code)
        except Exception as exc:
            logger.error("[GoogleOAuth] Code exchange failed: %s", exc)
            return {"success": False, "error": str(exc)}

        access_token = tokens.get("access_token", "")
        refresh_token = tokens.get("refresh_token", "")
        expires_in = int(tokens.get("expires_in", 3600))

        if not access_token:
            return {"success": False, "error": "No access_token in token response"}

        # Fetch user email from userinfo endpoint
        email = await self._fetch_userinfo(access_token)

        # Persist tokens
        keys = GOOGLE_OAUTH_SETTINGS_KEYS
        await _set_setting(keys["access_token"], access_token)
        await _set_setting(keys["token_expiry"], str(int(time.time()) + expires_in))
        await _set_setting(keys["email"], email)
        if refresh_token:
            await _set_setting(keys["refresh_token"], _encode_secret(refresh_token))

        logger.info("[GoogleOAuth] Tokens stored, email=%s", email)
        return {"success": True, "email": email}

    async def get_access_token(self) -> str | None:
        """Return a valid access token, refreshing if needed.

        Returns ``None`` when no OAuth tokens are stored (caller falls back
        to the service-account JSON flow).
        """
        keys = GOOGLE_OAUTH_SETTINGS_KEYS
        access_token = await _get_setting(keys["access_token"])
        expiry_str = await _get_setting(keys["token_expiry"])

        if not access_token:
            return None  # no OAuth tokens — caller falls back to SA

        # Check expiry
        if expiry_str:
            try:
                expiry = int(expiry_str)
                if time.time() < expiry - 60:  # 60s buffer
                    return access_token
            except ValueError:
                pass

        # Token expired or about to expire — try refresh
        refreshed = await self._refresh_access_token()
        return refreshed  # None if refresh failed (caller falls back)

    async def disconnect(self) -> dict[str, bool]:
        """Remove all stored Google OAuth tokens."""
        for key in GOOGLE_OAUTH_SETTINGS_KEYS.values():
            await _delete_setting(key)
        _GOOGLE_PKCE_SESSIONS.clear()
        logger.info("[GoogleOAuth] Disconnected, tokens removed")
        return {"success": True}

    async def get_status(self) -> dict[str, Any]:
        """Return ``{connected, email}``."""
        keys = GOOGLE_OAUTH_SETTINGS_KEYS
        access_token = await _get_setting(keys["access_token"])
        email = await _get_setting(keys["email"])
        return {
            "connected": bool(access_token),
            "email": email or None,
        }

    async def check_loopback_callback(self, state: str) -> dict[str, Any]:
        """Check if loopback server received callback and process it.

        Returns ``{received: bool, success: bool, email: str | None}``.
        """
        callback_key = f"callback_{state}"
        code = _GOOGLE_PKCE_SESSIONS.pop(callback_key, "")

        if not code:
            return {"received": False, "success": False, "email": None}

        # Process the callback
        result = await self.handle_callback(code, state)
        return {
            "received": True,
            "success": result.get("success", False),
            "email": result.get("email"),
        }

    # ── Internal ─────────────────────────────────────────────────────────────

    async def _refresh_access_token(self) -> str | None:
        """Use the stored refresh_token to get a new access_token."""
        keys = GOOGLE_OAUTH_SETTINGS_KEYS
        encoded_refresh = await _get_setting(keys["refresh_token"])
        if not encoded_refresh:
            return None

        refresh_token = _decode_secret(encoded_refresh)
        if not refresh_token:
            return None

        payload = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": self._client_id,
        }
        if self._client_secret:
            payload["client_secret"] = self._client_secret

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(self._token_url, data=payload)
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:
            logger.error("[GoogleOAuth] Token refresh failed: %s", exc)
            return None

        new_access = data.get("access_token", "")
        new_refresh = data.get("refresh_token", "")
        expires_in = int(data.get("expires_in", 3600))

        if not new_access:
            return None

        await _set_setting(keys["access_token"], new_access)
        await _set_setting(keys["token_expiry"], str(int(time.time()) + expires_in))
        if new_refresh:
            await _set_setting(keys["refresh_token"], _encode_secret(new_refresh))

        logger.info("[GoogleOAuth] Token refreshed, expires_in=%s", expires_in)
        return cast("str | None", new_access)

    async def _fetch_userinfo(self, access_token: str) -> str:
        """Fetch the connected user's email from Google's userinfo endpoint."""
        if not access_token:
            return ""
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(
                    self._userinfo_url,
                    headers={"Authorization": f"Bearer {access_token}"},
                )
                resp.raise_for_status()
                return cast("str", resp.json().get("email", ""))
        except Exception as exc:
            logger.warning("[GoogleOAuth] Could not fetch userinfo: %s", exc)
            return ""


# ── Singleton ────────────────────────────────────────────────────────────────

_service: GoogleSheetsOAuthService | None = None


def get_oauth_service() -> GoogleSheetsOAuthService:
    global _service
    if _service is None:
        _service = GoogleSheetsOAuthService()
    return _service
