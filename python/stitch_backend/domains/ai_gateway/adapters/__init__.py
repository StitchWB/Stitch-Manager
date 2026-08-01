"""Provider adapter abstraction layer for the AI Gateway domain.

One ``ConfigurableAdapter`` class covers OpenAI-compatible, Anthropic, and
Gemini protocols — the wire-level differences (auth header name, models
path, extra headers) are constructor parameters, not separate classes.
Adding a new endpoint for any of these protocols never requires code
changes — only a new ``ProviderEndpoint`` row.

Kiro is the only provider that needs its own adapter class (custom OAuth +
machine_id rotation) — that lives in a future ``kiro.py`` module.

This subpackage has NO dependency on ``schemas.py``/``service.py``/
``commands.py`` — adapters take plain ``base_url``/``secret``/``model``/
``messages`` arguments, never ORM objects.
"""

from stitch_backend.domains.ai_gateway.adapters.base import (
    ClassifiedError,
    ProbeResult,
    ProviderAdapter,
    get_adapter,
    register_adapter,
)

# Importing this module registers openai_compatible, anthropic, gemini.
from stitch_backend.domains.ai_gateway.adapters import configurable  # noqa: F401

__all__ = [
    "ClassifiedError",
    "ProbeResult",
    "ProviderAdapter",
    "get_adapter",
    "register_adapter",
]
