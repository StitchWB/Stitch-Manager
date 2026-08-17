"""Vendored DeepSeek web protocol core (snake-aabb-wtf/deepseek-web2api-free).

Pinned vendor copy of the protocol modules only — the upstream FastAPI
``server.py`` is intentionally NOT vendored (our ``deepseek_adapter`` plays
that role). Vendor patches applied to ``adapter.py``:

- relative ``logger`` import (package module, not top-level);
- ``dotenv`` loading removed (credentials come from the accounts DB);
- missing ``curl_cffi`` raises ``ImportError`` instead of ``SystemExit`` so
  the provider degrades to "unavailable" rather than killing the backend.

Upstream sync = deliberate bump + re-apply these patches.
"""
