"""Process-wide SSL context: httpx reloads the CA bundle per client otherwise."""

from __future__ import annotations

import ssl
from functools import lru_cache


@lru_cache(maxsize=1)
def shared_ssl_context() -> ssl.SSLContext:
    return ssl.create_default_context()
