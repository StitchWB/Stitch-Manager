"""Shared per-install local chat token resolver.

Both the chat router (``/api/v1/chat/completions``) and the native gateway
(``/v1/*``) authenticate local requests against the same per-install token.
This module provides a request-time resolver so the native gateway — built
during ``create_app()`` before the lifespan loads the token — can read the
cached token on each request instead of capturing it at construction time.
"""

from __future__ import annotations

import hmac

from fastapi import HTTPException


def get_cached_local_chat_token() -> str | None:
    """Return the in-process cached per-install token, or ``None`` if not loaded.

    The token is generated/persisted/cached by
    :func:`stitch_backend.domains.ai_proxy.chat_router.ensure_local_chat_token`,
    which the app lifespan calls at startup.  Reading the module-level cache
    here (rather than capturing the value at router-construction time) lets the
    gateway see the token even though the router is built before the lifespan
    runs.
    """
    from stitch_backend.domains.ai_proxy.chat_router import _LOCAL_CHAT_TOKEN

    return _LOCAL_CHAT_TOKEN


def require_local_chat_auth(authorization: str | None) -> None:
    """Raise 401 unless *authorization* matches the per-install token.

    Uses :func:`hmac.compare_digest` for timing-safe comparison.  If the token
    has not been loaded yet the request is rejected — there is no static
    fallback.
    """
    token = get_cached_local_chat_token()
    if token and hmac.compare_digest(authorization or "", f"Bearer {token}"):
        return
    raise HTTPException(status_code=401, detail={"error": {"message": "Unauthorized"}})
