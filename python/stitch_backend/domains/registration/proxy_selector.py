"""Round-robin proxy selector for registration jobs.

Reads the enabled proxy list from proxy_library_v1 (stored as a JSON blob in
ai_proxy_settings).  Maintains a cursor in the same settings table so each
registration picks the next proxy in sequence, wrapping around when exhausted.

If the proxy library is empty the selector returns None and the registration
proceeds without a proxy.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

_CURSOR_KEY = "registration_proxy_cursor"


class ProxySelector:
    """Round-robin proxy selection from proxy_library_v1."""

    @staticmethod
    async def next_proxy(session: Any) -> dict[str, Any] | None:
        """Return the next enabled proxy and advance the cursor.

        Returns a dict with keys: host, port, proxy_type, username, password
        (matching the ProxyLibraryEntry dataclass fields), or None if no
        proxies are configured.
        """
        from stitch_backend.domains.ai_proxy.service import get_settings_kv, set_settings_kv
        from stitch_backend.domains.proxy_library.service import _load_secret, load_proxy_library

        proxies = await load_proxy_library(session)
        enabled = [p for p in proxies if p.enabled]

        if not enabled:
            logger.debug("[proxy_selector] No enabled proxies — running without proxy")
            return None

        # Read current cursor
        raw_cursor = await get_settings_kv(session, _CURSOR_KEY)
        try:
            cursor = int(raw_cursor) if raw_cursor else 0
        except (TypeError, ValueError):
            cursor = 0

        # Clamp to list length in case proxies were deleted
        cursor = cursor % len(enabled)
        proxy = enabled[cursor]

        # Advance and persist cursor
        next_cursor = (cursor + 1) % len(enabled)
        await set_settings_kv(session, _CURSOR_KEY, str(next_cursor))

        proxy_url = f"{proxy.proxy_type}://{proxy.host}:{proxy.port}"
        logger.info(
            "[proxy_selector] Selected proxy %s (cursor %d→%d, pool size %d)",
            proxy_url, cursor, next_cursor, len(enabled),
        )

        return {
            "proxy_url": proxy_url,
            "proxy_type": proxy.proxy_type,
            "proxy_username": _load_secret(proxy.username) if proxy.username else None,
            "proxy_password": _load_secret(proxy.password) if proxy.password else None,
            "proxy_label": proxy.label,
        }

    @staticmethod
    def build_proxy_url(entry: dict[str, Any]) -> str | None:
        """Build a full proxy URL string from a selector result dict."""
        if not entry:
            return None
        url = entry.get("proxy_url", "")
        username = entry.get("proxy_username")
        password = entry.get("proxy_password")
        if username and password and "://" in url:
            scheme, rest = url.split("://", 1)
            return f"{scheme}://{username}:{password}@{rest}"
        return url or None
