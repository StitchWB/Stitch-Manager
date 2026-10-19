"""Proxy surface of the provider SDK (ADR-005)."""

try:
    from autoreg.browser.proxy_pool import ProxyPool
    from autoreg.browser.proxy_utils import (
        ProxyConfig,
        parse_proxy_line,
        proxy_from_env,
        proxy_from_params,
    )
except ImportError:  # open-core: proxy utilities are closed modules
    ProxyPool = None
    ProxyConfig = None
    parse_proxy_line = None
    proxy_from_env = None
    proxy_from_params = None

__all__ = ["ProxyConfig", "ProxyPool", "parse_proxy_line", "proxy_from_env", "proxy_from_params"]
