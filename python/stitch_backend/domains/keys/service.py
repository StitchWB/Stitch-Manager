"""Found-keys proxy — AiApiRadar admin-gated endpoints.

The masked list comes from the shared radar endpoint; the decrypted secret
comes from the VDS instance (the secret endpoint is vds-only on the radar
side — the CF worker never sees key_enc). ``AIRADAR_KEYS_URL`` overrides the
base for both; falls back to ``AIRADAR_API_URL`` when empty.

No TTL caching here: key material must not sit in memory longer than the
request that fetched it.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

import httpx

from stitch_backend.config import get_settings
from stitch_backend.core.exceptions import StitchError

from .models import FoundKeysParams

_TIMEOUT = 10.0


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _mint_assertion(role: str, secret: str) -> str:
    """Short-lived HS256 role assertion for the radar (SSO by assertion).

    The radar verifies the signature with the same shared secret and enforces
    its min-role ladder, so Stitch-authenticated VIP+ users read found keys
    without a second login.
    """
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64(json.dumps({"role": role, "exp": int(time.time()) + 300}).encode())
    sig = _b64(
        hmac.new(
            secret.encode("utf-8"),
            f"{header}.{payload}".encode("utf-8"),
            hashlib.sha256,
        ).digest()
    )
    return f"{header}.{payload}.{sig}"


def _auth_headers(role: str | None = None) -> dict[str, str]:
    s = get_settings()
    if s.radar_shared_secret:
        return {
            "Authorization": f"Bearer {_mint_assertion(role or '', s.radar_shared_secret)}"
        }
    token = s.airadar_admin_token
    if not token:
        raise StitchError(
            "AiApiRadar auth not configured (STITCH_RADAR_SECRET or "
            "AIRADAR_ADMIN_TOKEN)"
        )
    return {"Authorization": f"Bearer {token}"}


def _keys_base_url() -> str:
    s = get_settings()
    return (s.airadar_keys_url or s.airadadar_api_url).rstrip("/")


async def _get(path: str, params: dict[str, str] | None = None,
               role: str | None = None) -> dict:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            resp = await client.get(
                f"{_keys_base_url()}{path}",
                params=params,
                headers=_auth_headers(role),
            )
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as exc:
            # 401/403 = token problem, not an outage: surface it so the UI can
            # point the operator at AIRADAR_ADMIN_TOKEN (review finding).
            if exc.response.status_code in (401, 403):
                raise StitchError(
                    f"AiApiRadar admin token rejected "
                    f"({exc.response.status_code}) — check AIRADAR_ADMIN_TOKEN"
                ) from exc
            raise StitchError(f"AiApiRadar unavailable: {exc}") from exc
        except httpx.HTTPError as exc:
            raise StitchError(f"AiApiRadar unavailable: {exc}") from exc
        except ValueError as exc:
            raise StitchError("AiApiRadar unavailable: invalid JSON response") from exc


async def fetch_found_keys(params: FoundKeysParams, role: str | None = None) -> dict:
    """Proxy ``GET /api/found-keys`` (masked list, VIP+ via assertion)."""
    return await _get("/api/found-keys", params.to_query(), role)


async def fetch_found_key_secret(key_id: int, role: str | None = None) -> dict:
    """Proxy ``GET /api/found-keys/{id}/secret`` (VDS-only, VIP+)."""
    return await _get(f"/api/found-keys/{key_id}/secret", role=role)
