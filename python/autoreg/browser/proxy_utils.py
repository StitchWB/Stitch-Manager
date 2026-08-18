"""
Proxy configuration utilities.

Single source of truth for proxy URL parsing and ChromiumOptions formatting.
Replaces inline parsing in ``BaseBrowser``, ``kiro/browser.py``,
``fireworks/browser.py`` and ``openai/browser.py``.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ProxyConfig:
    """Normalized proxy configuration."""

    enabled: bool = False
    scheme: str = "http"  # ``http`` or ``socks5``
    host: str = ""
    port: int = 0
    username: str | None = None
    password: str | None = None

    def has_auth(self) -> bool:
        return bool(self.username and self.password)

    def to_url(self, *, include_auth: bool = True) -> str:
        """Build a full proxy URL string.

        Args:
            include_auth: Whether to inline ``user:pass@`` (set False when
                Chrome will fetch credentials via an extension).
        """
        if not self.enabled or not self.host:
            return ""
        auth = ""
        if include_auth and self.username:
            password = self.password or ""
            auth = f"{self.username}:{password}@"
        port_part = f":{self.port}" if self.port else ""
        return f"{self.scheme}://{auth}{self.host}{port_part}"


def proxy_from_params(
    enabled: bool = False,
    proxy_type: str = "http",
    proxy_url: str | None = None,
    username: str | None = None,
    password: str | None = None,
) -> ProxyConfig:
    """Build :class:`ProxyConfig` from individual parameters.

    Accepts ``proxy_url`` as either ``host:port`` or full ``scheme://host:port``.
    Auth components in ``username`` / ``password`` win over those embedded in
    ``proxy_url``.
    """
    if not enabled or not proxy_url:
        return ProxyConfig(enabled=False)

    host, port, scheme_override, parsed_user, parsed_pass = _parse_proxy_url(proxy_url)

    return ProxyConfig(
        enabled=True,
        scheme=scheme_override or proxy_type,
        host=host,
        port=port,
        username=username or parsed_user,
        password=password or parsed_pass,
    )


def proxy_from_env() -> ProxyConfig:
    """Build :class:`ProxyConfig` from ``HTTPS_PROXY`` / ``HTTP_PROXY`` /
    ``ALL_PROXY`` env vars.

    Returns:
        Disabled :class:`ProxyConfig` when no env var is set.
    """
    proxy_url = (
        os.environ.get("HTTPS_PROXY")
        or os.environ.get("HTTP_PROXY")
        or os.environ.get("ALL_PROXY")
    )
    if not proxy_url:
        return ProxyConfig(enabled=False)

    host, port, scheme, user, password = _parse_proxy_url(proxy_url)

    return ProxyConfig(
        enabled=True,
        scheme=scheme or "http",
        host=host,
        port=port,
        username=user,
        password=password,
    )


def _parse_proxy_url(
    url: str,
) -> tuple[str, int, str | None, str | None, str | None]:
    """Parse a proxy URL into ``(host, port, scheme, user, password)``.

    Accepts forms like ``host:port``, ``user:pass@host:port``, or
    ``scheme://user:pass@host:port``.
    """
    url = (url or "").strip()
    if not url:
        return "", 0, None, None, None

    if "://" in url:
        parsed = urlparse(url)
        scheme = parsed.scheme.lower() if parsed.scheme else None
        host = parsed.hostname or ""
        port = parsed.port or 0
        user = parsed.username
        password = parsed.password
        return host, port, scheme, user, password

    user: str | None = None
    password: str | None = None
    if "@" in url:
        auth_part, host_part = url.rsplit("@", 1)
        if ":" in auth_part:
            user, password = auth_part.split(":", 1)
        else:
            user = auth_part
        url = host_part

    if ":" in url:
        host, port_str = url.split(":", 1)
        try:
            port = int(port_str)
        except ValueError:
            port = 0
    else:
        host = url
        port = 0

    return host, port, None, user, password


__all__ = ["ProxyConfig", "proxy_from_params", "proxy_from_env"]
