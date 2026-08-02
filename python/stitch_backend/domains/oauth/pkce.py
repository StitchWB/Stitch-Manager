"""OAuth 2.0 Authorization Code Flow with PKCE.

Implements the full PKCE flow: code_verifier generation, authorization
URL construction, token exchange.  Used by providers that require OAuth
login (e.g. Kiro, Windsurf).
"""

from __future__ import annotations

import base64
import hashlib
import logging
import secrets
from typing import Any

import httpx

logger = logging.getLogger(__name__)


def generate_code_verifier(length: int = 64) -> str:
    """Generate a random PKCE code verifier."""
    return secrets.token_urlsafe(length)[:length]


def generate_code_challenge(verifier: str) -> str:
    """Derive the S256 code challenge from a verifier."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


class PKCEFlow:
    """Manages a single PKCE authorization flow."""

    def __init__(
        self,
        authorize_url: str,
        token_url: str,
        client_id: str,
        redirect_uri: str = "http://localhost:25584/api/oauth/callback",
        scope: str = "openid profile email",
    ) -> None:
        self.authorize_url = authorize_url
        self.token_url = token_url
        self.client_id = client_id
        self.redirect_uri = redirect_uri
        self.scope = scope
        self.code_verifier = generate_code_verifier()
        self.code_challenge = generate_code_challenge(self.code_verifier)

    def get_authorization_url(self, state: str | None = None) -> str:
        """Build the authorization URL to open in the browser."""
        params = {
            "response_type": "code",
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scope": self.scope,
            "code_challenge": self.code_challenge,
            "code_challenge_method": "S256",
        }
        if state:
            params["state"] = state

        query = "&".join(f"{k}={v}" for k, v in params.items())
        return f"{self.authorize_url}?{query}"

    async def exchange_code(self, code: str, proxy: str | None = None) -> dict[str, Any]:
        """Exchange the authorization code for tokens."""
        payload = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": self.redirect_uri,
            "client_id": self.client_id,
            "code_verifier": self.code_verifier,
        }
        async with httpx.AsyncClient(proxy=proxy) as client:
            resp = await client.post(self.token_url, data=payload)
            resp.raise_for_status()
            tokens = resp.json()
            logger.info("PKCE token exchange successful")
            return tokens
