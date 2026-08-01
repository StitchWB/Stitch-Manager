"""``ProviderAdapter`` protocol + shared result types + adapter registry.

This module defines the seam between the (future) routing/health engine and
the concrete per-protocol implementations in this subpackage. The engine
only ever talks to a ``ProviderAdapter`` — it never knows whether the
underlying protocol is OpenAI-compatible, Anthropic, Gemini, or Kiro.

Follows the ``typing.Protocol`` style already used in this codebase for
``CompletionRouter`` (see
``domains/ai_proxy/litellm_executor.py::CompletionRouter``): a structural
interface with no base class to inherit from, so any object with matching
async method signatures satisfies it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

# ═══════════════════════════════════════════════════════════════════════════
# Shared result types
# ═══════════════════════════════════════════════════════════════════════════


@dataclass
class ProbeResult:
    """Outcome of a health-check probe against one credential.

    Internal-only type — never serialized across the wire directly, so a
    plain dataclass (not Pydantic) is preferable here.
    """

    success: bool
    latency_ms: float
    models: list[str] | None = None
    http_status: int | None = None
    error: str | None = None


@dataclass
class ClassifiedError:
    """Normalized classification of a failure raised during a provider call.

    Consumed by the (future) routing engine and by
    ``Credential.runtime_status`` transitions — a fixed vocabulary so the
    engine never needs to know about provider-specific exception types or
    HTTP status codes.
    """

    category: str
    """One of: auth_failed | rate_limited | quota_exhausted | model_not_found |
    model_access_denied | transport_error | client_error | server_error | unknown."""

    retry_after_seconds: int | None = None
    """Parsed from a ``Retry-After`` response header, if present."""

    is_endpoint_wide: bool = False
    """True if the error suggests the WHOLE ENDPOINT is unhealthy (e.g.
    connection refused, 5xx) rather than just this one credential (e.g. a
    401/429 scoped to a single key)."""


# ═══════════════════════════════════════════════════════════════════════════
# ProviderAdapter protocol
# ═══════════════════════════════════════════════════════════════════════════


@runtime_checkable
class ProviderAdapter(Protocol):
    """Structural interface every protocol adapter must satisfy.

    Adapters are stateless and take plain scalars/dicts — never ORM objects
    — so they can be unit tested without a database and reused regardless
    of how credentials end up being stored.
    """

    async def probe_credential(
        self,
        *,
        base_url: str,
        secret: str,
        default_headers: dict[str, str] | None = None,
    ) -> ProbeResult:
        """Health-check one credential against ``base_url``.

        Should be cheap and side-effect free (a discovery/list-models call
        is the conventional probe for OpenAI-compatible protocols).
        """
        ...

    async def list_models(
        self,
        *,
        base_url: str,
        secret: str,
        default_headers: dict[str, str] | None = None,
    ) -> list[str]:
        """Return the model IDs this credential can see on this endpoint."""
        ...

    async def invoke(
        self,
        *,
        base_url: str,
        secret: str,
        model: str,
        messages: list[dict[str, Any]],
        stream: bool = False,
        default_headers: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> Any:
        """Perform the actual completion call.

        Provider-agnostic and low-level: returns whatever the underlying
        transport gives back (a parsed JSON dict for non-streaming, or an
        async-iterable/response object for streaming) — it is the caller's
        job to turn that into an SSE stream, a FastAPI response, etc. This
        adapter has no knowledge of FastAPI or Starlette.
        """
        ...

    async def invoke_responses(
        self,
        *,
        base_url: str,
        secret: str,
        model: str,
        input: Any,
        stream: bool = False,
        default_headers: dict[str, str] | None = None,
        **kwargs: Any,
    ) -> Any:
        """Invoke the Responses API (OpenAI-specific).

        Unlike ``invoke`` which sends ``messages``, this sends ``input``
        as the primary content field.
        """
        ...

    def classify_error(
        self,
        exc: BaseException,
        *,
        http_status: int | None = None,
        response_headers: dict[str, str] | None = None,
    ) -> ClassifiedError:
        """Map a raised exception / HTTP status into a ``ClassifiedError``."""
        ...


# ═══════════════════════════════════════════════════════════════════════════
# Registry
# ═══════════════════════════════════════════════════════════════════════════

_ADAPTERS: dict[str, ProviderAdapter] = {}


def register_adapter(adapter_type: str, adapter: ProviderAdapter) -> None:
    """Register a concrete adapter instance under ``adapter_type``.

    ``adapter_type`` matches ``ProviderEndpoint.adapter_type`` in
    ``domains/ai_gateway/models.py``.
    """
    _ADAPTERS[adapter_type] = adapter


def get_adapter(adapter_type: str) -> ProviderAdapter:
    """Look up a registered adapter by type.

    Raises:
        KeyError: if no adapter is registered for ``adapter_type``.
    """
    try:
        return _ADAPTERS[adapter_type]
    except KeyError:
        known = ", ".join(sorted(_ADAPTERS)) or "(none registered)"
        raise KeyError(
            f"No provider adapter registered for adapter_type={adapter_type!r}. "
            f"Known adapter types: {known}"
        ) from None
