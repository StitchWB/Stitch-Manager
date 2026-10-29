"""Runtime proxy parsing/masking for replay (proxy.switch resolution)."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit


def _parse_runtime_proxy_any(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None

    if "://" in raw:
        try:
            parsed = urlsplit(raw)
            if parsed.hostname and parsed.port:
                scheme = (parsed.scheme or "http").strip().lower()
                host = parsed.hostname
                port = int(parsed.port)
                if parsed.username:
                    return f"{scheme}://{parsed.username}:{parsed.password or ''}@{host}:{port}"
                return f"{scheme}://{host}:{port}"
        except Exception:
            return None

    scheme = "http"
    payload = raw

    parts = [p.strip() for p in payload.split(":")]
    if len(parts) not in (2, 4):
        return None

    host = parts[0]
    if not host:
        return None
    try:
        port = int(parts[1])
    except Exception:
        return None
    if port <= 0 or port > 65535:
        return None

    if len(parts) == 4 and parts[2]:
        username = parts[2]
        password = parts[3]
        return f"{scheme}://{username}:{password}@{host}:{port}"
    return f"{scheme}://{host}:{port}"


def _mask_proxy_url(value: str) -> str:
    try:
        if "@" in value and "://" in value:
            head, tail = value.split("://", 1)
            auth, host = tail.split("@", 1)
            if ":" in auth:
                user, _ = auth.split(":", 1)
                return f"{head}://{user}:***@{host}"
        return value
    except Exception:
        return "proxy://***"
