"""Proxy spec parsing, proxy health-check and IP geo/timezone lookup."""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ProxySpec:
    scheme: str  # http|https|socks5
    host: str
    port: int
    username: str | None = None
    password: str | None = None

    def to_url(self, *, include_auth: bool = True) -> str:
        auth = ""
        if include_auth and self.username:
            password = self.password or ""
            auth = f"{self.username}:{password}@"
        return f"{self.scheme}://{auth}{self.host}:{self.port}"


def _safe_stderr(msg: str) -> None:
    try:
        sys.stderr.write(msg.rstrip() + os.linesep)
        sys.stderr.flush()
    except Exception:
        pass


def _parse_proxy_any(proxy: Any) -> ProxySpec | None:
    """Parse common proxy formats into a normalized ProxySpec.

    Accepted formats:
    - None / "" -> None
    - "http://user:pass@host:port" (or https/socks5)
    - "host:port" (defaults to http)
    - "user:pass@host:port" (defaults to http)
    - "host:port:user:pass" (defaults to http)
    - dict: {"type": "http", "host": "1.2.3.4", "port": 8080, "username": "u", "password": "p"}
    """

    if proxy is None:
        return None

    if isinstance(proxy, dict):
        scheme = str(proxy.get("type") or proxy.get("scheme") or "http").strip().lower()
        host = str(proxy.get("host") or "").strip()
        port = proxy.get("port")
        username = proxy.get("username") or proxy.get("user")
        password = proxy.get("password") or proxy.get("pass")
        if not host or port is None:
            raise ValueError(f"Invalid proxy dict (expected host+port): {proxy}")
        try:
            port_i = int(port)
        except Exception as e:
            raise ValueError(f"Invalid proxy port: {port}") from e
        return ProxySpec(
            scheme=scheme, host=host, port=port_i, username=username, password=password
        )

    if not isinstance(proxy, str):
        raise ValueError(f"Invalid proxy type: {type(proxy).__name__}")

    value = proxy.strip()
    if not value:
        return None

    # host:port:user:pass
    hpup = re.match(r"^(?P<host>[^:]+):(?P<port>\d+):(?P<user>[^:]+):(?P<password>.+)$", value)
    if hpup:
        return ProxySpec(
            scheme="http",
            host=hpup.group("host"),
            port=int(hpup.group("port")),
            username=hpup.group("user"),
            password=hpup.group("password"),
        )

    # Ensure scheme is present for consistent parsing.
    if "://" not in value:
        value = f"http://{value}"

    # scheme://[user:pass@]host:port
    match = re.match(
        r"^(?P<scheme>https?|socks5)://(?:(?P<user>[^:@/]+):(?P<password>[^@/]+)@)?(?P<host>[^:/]+):(?P<port>\d+)$",
        value,
        re.IGNORECASE,
    )
    if not match:
        raise ValueError(
            "Invalid proxy format. Expected type://user:pass@host:port or host:port (optional auth). "
            f"Got: {proxy}"
        )

    scheme = match.group("scheme").lower()
    host = match.group("host")
    port = int(match.group("port"))
    user = match.group("user")
    password = match.group("password")
    return ProxySpec(scheme=scheme, host=host, port=port, username=user, password=password)


def _redact_proxy_for_logs(proxy: ProxySpec) -> str:
    if proxy.username:
        return f"{proxy.scheme}://{proxy.username}:***@{proxy.host}:{proxy.port}"
    return f"{proxy.scheme}://{proxy.host}:{proxy.port}"


async def _fetch_json_with_optional_proxy(
    url: str,
    *,
    proxy: ProxySpec | None,
    timeout_s: float,
) -> dict[str, Any]:
    """Fetch JSON with optional http/https/socks5 proxy."""

    try:
        import aiohttp
    except Exception as e:  # pragma: no cover
        raise RuntimeError("aiohttp is required for proxy checks and geo lookup") from e

    timeout = aiohttp.ClientTimeout(total=timeout_s)

    if proxy and proxy.scheme.startswith("socks"):
        try:
            from aiohttp_socks import ProxyConnector
        except Exception as e:  # pragma: no cover
            raise RuntimeError("aiohttp-socks is required for socks proxies") from e

        # socks5h:// resolves DNS on the proxy side; socks5:// resolves locally and leaks target domains.
        proxy_url = proxy.to_url(include_auth=True).replace("socks5://", "socks5h://", 1)
        connector = ProxyConnector.from_url(proxy_url)
        async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
            async with session.get(url, headers={"Accept": "application/json"}) as resp:
                data = await resp.json(content_type=None)
                if resp.status >= 400:
                    raise RuntimeError(f"HTTP {resp.status} from {url}: {data}")
                if not isinstance(data, dict):
                    raise RuntimeError(f"Unexpected response from {url}: {type(data).__name__}")
                return data

    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(
            url,
            headers={"Accept": "application/json"},
            proxy=(proxy.to_url(include_auth=True) if proxy else None),
        ) as resp:
            data = await resp.json(content_type=None)
            if resp.status >= 400:
                raise RuntimeError(f"HTTP {resp.status} from {url}: {data}")
            if not isinstance(data, dict):
                raise RuntimeError(f"Unexpected response from {url}: {type(data).__name__}")
            return data


async def _proxy_health_check(proxy: ProxySpec, *, timeout_s: float = 8.0) -> None:
    """Fail-fast proxy check by performing a simple JSON request."""

    # NOTE: use a stable endpoint with very small payload.
    endpoints = [
        "https://api.ipify.org?format=json",
        "https://httpbin.org/ip",
    ]

    last_error: Exception | None = None
    for url in endpoints:
        try:
            data = await _fetch_json_with_optional_proxy(url, proxy=proxy, timeout_s=timeout_s)
            # ipify -> {"ip": "x.x.x.x"}, httpbin -> {"origin": "..."}
            if "ip" in data or "origin" in data:
                return
            # Still fine; request succeeded.
            return
        except Exception as e:
            last_error = e
            continue

    raise RuntimeError(
        "Proxy health-check failed. "
        f"Proxy: {_redact_proxy_for_logs(proxy)}. "
        f"Last error: {type(last_error).__name__}: {last_error}"
    )


async def _resolve_geo_and_timezone(
    *,
    proxy: ProxySpec | None,
    timeout_s: float = 5.0,
) -> tuple[dict[str, Any] | None, str | None]:
    """Resolve geolocation + timezone from IP.

    Returns:
        (geolocation_dict_for_playwright, timezone_id)
    """

    providers = [
        ("https://ipwho.is/", "ipwho"),
        ("https://ipapi.co/json/", "ipapi"),
    ]

    last_error: Exception | None = None
    for url, provider in providers:
        try:
            data = await _fetch_json_with_optional_proxy(url, proxy=proxy, timeout_s=timeout_s)

            if provider == "ipwho":
                if data.get("success") is False:
                    raise RuntimeError(str(data.get("message") or "geo lookup failed"))
                lat = data.get("latitude")
                lon = data.get("longitude")
                tz = (
                    (data.get("timezone") or {}).get("id")
                    if isinstance(data.get("timezone"), dict)
                    else None
                )
            else:
                lat = data.get("latitude")
                lon = data.get("longitude")
                tz = data.get("timezone")

            geolocation: dict[str, Any] | None = None
            if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
                geolocation = {"latitude": float(lat), "longitude": float(lon), "accuracy": 50}
            timezone_id = str(tz) if isinstance(tz, str) and tz.strip() else None
            return geolocation, timezone_id

        except Exception as e:
            last_error = e
            continue

    _safe_stderr(
        "[ProfileLauncher] Auto geo/timezone lookup failed; using defaults. "
        f"Last error: {type(last_error).__name__}: {last_error}"
    )
    return None, None
