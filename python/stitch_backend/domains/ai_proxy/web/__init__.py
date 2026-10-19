"""In-process web-session adapters (web2api bridges).

Phase 0 pilot: Gemini web protocol core. See
``.kiro/steering/web2api-bridges.md`` for the fixed architecture and
``.omo/plans/web-gemini-adapter.md`` for the task breakdown.
"""

from __future__ import annotations

from .base import (
    ModelDict,
    WebSessionAdapter,
    parse_cookie_jar,
    sanitize_secrets,
)

__all__ = [
    "ModelDict",
    "WebSessionAdapter",
    "parse_cookie_jar",
    "sanitize_secrets",
]
