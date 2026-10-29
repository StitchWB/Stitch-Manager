"""Proxy parsing/masking helpers for the recorder (proxy.switch normalization)."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit


def _parse_proxy_switch_raw(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None

    # URL form: scheme://[user:pass@]host:port
    if "://" in raw:
        try:
            parsed = urlsplit(raw)
            if parsed.hostname and parsed.port:
                return {
                    "scheme": (parsed.scheme or "http").strip().lower(),
                    "host": parsed.hostname,
                    "port": int(parsed.port),
                    "username": parsed.username,
                    "password": parsed.password,
                }
        except Exception:
            return None

    # Legacy bulk form: host:port[:username:password]
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

    username = parts[2] if len(parts) == 4 and parts[2] else None
    password = parts[3] if len(parts) == 4 and parts[3] else None

    return {
        "scheme": scheme if scheme in ("http", "socks5", "https") else "http",
        "host": host,
        "port": port,
        "username": username,
        "password": password,
    }


def _parse_proxy_library_catalog_item(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None

    proxy_id = str(value.get("id") or "").strip()
    host = str(value.get("host") or "").strip()
    if not proxy_id or not host:
        return None

    try:
        port = int(value.get("port") or 0)
    except Exception:
        return None
    if port <= 0 or port > 65535:
        return None

    scheme = str(value.get("proxyType") or "http").strip().lower()
    if scheme not in ("http", "https", "socks5"):
        scheme = "http"

    return {
        "id": proxy_id,
        "scheme": scheme,
        "host": host,
        "port": port,
        "username": value.get("username"),
        "password": value.get("password"),
    }


def _build_proxy_url_from_catalog_item(item: dict[str, Any]) -> str:
    scheme = str(item.get("scheme") or "http")
    host = str(item.get("host") or "")
    port = int(item.get("port") or 0)
    username = item.get("username")
    password = item.get("password")
    if username:
        return f"{scheme}://{username}:{password or ''}@{host}:{port}"
    return f"{scheme}://{host}:{port}"


def _mask_proxy_for_display(data: dict[str, Any]) -> str:
    scheme = str(data.get("scheme") or "http")
    host = str(data.get("host") or "")
    port = str(data.get("port") or "")
    username = data.get("username")
    if username:
        return f"{scheme}://{username}:***@{host}:{port}"
    return f"{scheme}://{host}:{port}"
