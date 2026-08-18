"""Telegram OIDC ``id_token`` verification (RS256 via JWKS).

When ``TG_AUTH_MODE=oidc`` the ``POST /api/auth/telegram-oidc`` endpoint
delegates here to verify a Telegram-issued OIDC ``id_token``.  The token
is signed with RS256; the public keys are fetched from Telegram's JWKS
endpoint (``https://oauth.telegram.org/.well-known/jwks.json``) and
cached for 10 minutes.  On an unknown ``kid`` the cache is force-refreshed
exactly once before giving up.

The verification follows the spec (``tz-stitch-telegram-oidc.md`` §2):

  - ``alg`` = RS256 (PyJWT ``algorithms=["RS256"]``)
  - ``iss`` = ``https://oauth.telegram.org``
  - ``aud`` = ``settings.tg_bot_client_id`` (the bot numeric id)
  - ``exp`` > now with ≤ 5 minutes clock skew (``leeway``)
  - ``iat`` and ``exp`` required (``options={"require": ["exp", "iat"]}``)
  - ``sub`` and/or ``id`` claim present (checked after decode)

Two typed exceptions (subclasses of :class:`StitchError`) let the router
map failures to the right HTTP status:

  - :class:`TelegramOIDCVerificationError` → 401 (bad token / bad claims)
  - :class:`TelegramJWKSUnavailableError` → 503 (JWKS endpoint unreachable)
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import timedelta
from typing import Any

import httpx
import jwt

from stitch_backend.config import get_settings
from stitch_backend.core.exceptions import StitchError

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

#: Telegram OIDC issuer (``iss`` claim).
TELEGRAM_ISSUER = "https://oauth.telegram.org"

#: JWKS endpoint.
_JWKS_URL = "https://oauth.telegram.org/.well-known/jwks.json"

#: JWKS cache TTL — 10 minutes (spec: ≤ 10 minutes).
_JWKS_TTL = 600.0

#: HTTP timeout for the JWKS fetch.
_JWKS_TIMEOUT = 10.0

#: Clock-skew leeway for ``exp`` / ``iat`` — 5 minutes (spec).
_LEEWAY = timedelta(minutes=5)


# ── Exceptions ────────────────────────────────────────────────────────────────


class TelegramOIDCError(StitchError):
    """Base for Telegram OIDC verification errors."""


class TelegramOIDCVerificationError(TelegramOIDCError):
    """Token verification failed — the router maps this to HTTP 401."""


class TelegramJWKSUnavailableError(TelegramOIDCError):
    """JWKS endpoint unreachable — the router maps this to HTTP 503."""


# ── JWKS cache (module-level, guarded by an asyncio.Lock) ────────────────────

#: Cached JWKS dict (``{"keys": [...]}``) or ``None`` when empty/expired.
_jwks_cache: dict[str, Any] | None = None

#: ``time.monotonic()`` value of the last successful fetch.
_jwks_fetched_at: float = 0.0

#: Lock guarding the fetch — lazily created so it binds to the running
#: event loop (avoids cross-loop issues in tests).
_jwks_lock: asyncio.Lock | None = None


def _get_lock() -> asyncio.Lock:
    """Return the JWKS lock, creating it lazily on first use."""
    global _jwks_lock
    if _jwks_lock is None:
        _jwks_lock = asyncio.Lock()
    return _jwks_lock


def _reset_jwks_cache() -> None:
    """Reset the module-level JWKS cache and lock (for tests)."""
    global _jwks_cache, _jwks_fetched_at, _jwks_lock
    _jwks_cache = None
    _jwks_fetched_at = 0.0
    _jwks_lock = None


async def _fetch_jwks() -> dict[str, Any]:
    """Fetch the JWKS dict from Telegram's well-known endpoint.

    This is the single HTTP seam — tests monkeypatch this function to
    avoid hitting the network.  Raises :class:`TelegramJWKSUnavailableError`
    on any transport/HTTP failure.
    """
    try:
        async with httpx.AsyncClient(timeout=_JWKS_TIMEOUT) as client:
            resp = await client.get(_JWKS_URL)
            resp.raise_for_status()
            return resp.json()
    except Exception as exc:
        logger.warning("Failed to fetch Telegram JWKS: %s", exc)
        raise TelegramJWKSUnavailableError("Telegram JWKS unavailable") from exc


async def _get_jwks(*, force_refresh: bool = False) -> dict[str, Any]:
    """Return the JWKS dict, fetching if the cache is stale or empty.

    When *force_refresh* is ``True`` the cache is bypassed and a fresh
    fetch is performed (used after an unknown ``kid``).  The fetch is
    guarded by a lock so concurrent callers don't duplicate the request.
    """
    global _jwks_cache, _jwks_fetched_at

    # Fast path: cache is fresh and we're not forcing.
    if not force_refresh and _jwks_cache is not None:
        if time.monotonic() - _jwks_fetched_at < _JWKS_TTL:
            return _jwks_cache

    async with _get_lock():
        # Double-check after acquiring the lock — another coroutine may
        # have already refreshed the cache while we were waiting.
        if not force_refresh and _jwks_cache is not None:
            if time.monotonic() - _jwks_fetched_at < _JWKS_TTL:
                return _jwks_cache

        _jwks_cache = await _fetch_jwks()
        _jwks_fetched_at = time.monotonic()
        return _jwks_cache


def _find_key(jwks: dict[str, Any], kid: str) -> dict[str, Any] | None:
    """Return the JWK with matching *kid* in *jwks*, or ``None``."""
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            return key
    return None


# ── Public API ────────────────────────────────────────────────────────────────


async def verify_telegram_id_token(id_token: str) -> dict[str, Any]:
    """Verify a Telegram-issued OIDC ``id_token`` and return its claims.

    Raises :class:`TelegramOIDCVerificationError` on any signature/claim
    failure (mapped to HTTP 401 by the router) and
    :class:`TelegramJWKSUnavailableError` when the JWKS endpoint is
    unreachable (mapped to HTTP 503).
    """
    settings = get_settings()

    # ── Parse the header to extract kid ──────────────────────────────────────
    try:
        unverified_header = jwt.get_unverified_header(id_token)
    except jwt.PyJWTError as exc:
        logger.warning("Malformed Telegram id_token header: %s", exc)
        raise TelegramOIDCVerificationError("Malformed id_token") from exc

    kid = unverified_header.get("kid")
    if not kid:
        logger.warning("Telegram id_token missing kid in header")
        raise TelegramOIDCVerificationError("Missing kid in token header")

    # ── Resolve the signing key from JWKS (force-refresh once on unknown kid) ──
    try:
        jwks = await _get_jwks()
    except TelegramJWKSUnavailableError:
        raise

    jwk = _find_key(jwks, kid)

    if jwk is None:
        # Unknown kid — force-refresh the JWKS exactly once and retry.
        logger.info("Unknown kid %r — force-refreshing JWKS", kid)
        try:
            jwks = await _get_jwks(force_refresh=True)
        except TelegramJWKSUnavailableError:
            raise
        jwk = _find_key(jwks, kid)

    if jwk is None:
        logger.warning("Unknown kid in Telegram id_token: %s", kid)
        raise TelegramOIDCVerificationError(f"Unknown kid: {kid}")

    try:
        public_key = jwt.algorithms.RSAAlgorithm.from_jwk(jwk)
    except Exception as exc:
        logger.warning("Failed to build key from JWK (kid=%s): %s", kid, exc)
        raise TelegramOIDCVerificationError("Invalid signing key") from exc

    # ── Decode + verify signature and claims ──────────────────────────────────
    try:
        claims = jwt.decode(
            id_token,
            public_key,
            algorithms=["RS256"],
            issuer=TELEGRAM_ISSUER,
            audience=settings.tg_bot_client_id,
            leeway=_LEEWAY,
            options={"require": ["exp", "iat"]},
        )
    except jwt.PyJWTError as exc:
        logger.warning("Telegram id_token verification failed (kid=%s): %s", kid, exc)
        raise TelegramOIDCVerificationError(str(exc)) from exc

    # ── Require sub and/or id claim presence ──────────────────────────────────
    if not claims.get("sub") and not claims.get("id"):
        logger.warning(
            "Telegram id_token missing both sub and id claims (kid=%s)", kid
        )
        raise TelegramOIDCVerificationError("Missing subject claim")

    return claims
