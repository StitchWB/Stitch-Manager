"""Proxy surface of the provider SDK (ADR-005)."""

from autoreg.browser.proxy_pool import ProxyPool
from autoreg.browser.proxy_utils import (
    ProxyConfig,
    parse_proxy_line,
    proxy_from_env,
    proxy_from_params,
)

__all__ = ["ProxyConfig", "ProxyPool", "parse_proxy_line", "proxy_from_env", "proxy_from_params"]
