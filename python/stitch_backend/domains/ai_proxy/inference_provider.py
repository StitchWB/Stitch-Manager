"""InferenceProvider — unified model-discovery abstraction for AI providers.

An *inference provider* is a source of LLM models (OpenAI, Anthropic, Kiro,
FreeModel, ...). It is distinct from:
  * a *registration provider* — a method to register accounts (autoreg/providers),
  * a *sidecar* — a local helper subprocess (domains/sidecar).

This layer covers model **discovery only** (listing available models). Chat
**routing** lives elsewhere (litellm_gateway / kiro_gateway / chat_router) and
is intentionally not touched here — discovery and routing are separate concerns.

Providers return the existing model-entry shape ``{"id", "provider", "name"}``.
"""

from __future__ import annotations

import asyncio
import logging
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable

logger = logging.getLogger(__name__)

# A single model entry: {"id", "provider", "name"}.
ModelDict = dict[str, str]

# Fetch callables injected by the caller (commands.py owns the concrete
# per-endpoint fetch implementations).
KeysFetcher = Callable[[list[dict]], Awaitable[list[ModelDict]]]
AccountsFetcher = Callable[[list[dict]], Awaitable[list[ModelDict]]]
EndpointFetcher = Callable[[str], Awaitable[list[ModelDict]]]


class InferenceProvider(ABC):
    """A source of LLM models."""

    #: unique provider id, e.g. "openai", "kiro", "freemodel"
    provider_id: str = ""

    @abstractmethod
    async def list_models(self) -> list[ModelDict]:
        """Fetch the models this provider currently offers."""

    def available(self) -> bool:
        """Whether this provider is configured / able to serve models."""
        return True


class ApiKeyInferenceProvider(InferenceProvider):
    """Provider backed by API keys (OpenAI, Anthropic, Gemini, Z.AI, ...).

    ``fetch_fn`` receives the list of API-key records and returns models.
    """

    def __init__(self, provider_id: str, keys: list[dict], fetch_fn: KeysFetcher) -> None:
        self.provider_id = provider_id
        self._keys = keys
        self._fetch_fn = fetch_fn

    def available(self) -> bool:
        return bool(self._keys)

    async def list_models(self) -> list[ModelDict]:
        if not self._keys:
            return []
        return await self._fetch_fn(self._keys)


class AccountInferenceProvider(InferenceProvider):
    """Provider backed by user accounts (Kiro).

    ``fetch_fn`` receives the list of account records and returns models.
    """

    def __init__(
        self, provider_id: str, accounts: list[dict], fetch_fn: AccountsFetcher
    ) -> None:
        self.provider_id = provider_id
        self._accounts = accounts
        self._fetch_fn = fetch_fn

    async def list_models(self) -> list[ModelDict]:
        return await self._fetch_fn(self._accounts)


class SidecarInferenceProvider(InferenceProvider):
    """Provider whose models come from a local sidecar's ``/v1/models``.

    Knows ONLY the sidecar's endpoint (resolved through the
    :class:`SidecarSupervisor`) — it never touches process details. When the
    sidecar is not running, :meth:`list_models` returns ``[]``.
    """

    def __init__(
        self,
        provider_id: str,
        sidecar_name: str,
        fetch_fn: EndpointFetcher | None = None,
    ) -> None:
        self.provider_id = provider_id
        self._sidecar_name = sidecar_name
        self._fetch_fn = fetch_fn

    def _endpoint(self) -> str | None:
        from stitch_backend.domains.sidecar import get_supervisor

        return get_supervisor().get_endpoint(self._sidecar_name)

    def available(self) -> bool:
        return self._endpoint() is not None

    async def list_models(self) -> list[ModelDict]:
        endpoint = self._endpoint()
        if not endpoint:
            return []
        if self._fetch_fn is not None:
            return await self._fetch_fn(endpoint)
        return await self._fetch_default(endpoint)

    async def _fetch_default(self, endpoint: str) -> list[ModelDict]:
        """Query ``{endpoint}/v1/models`` (OpenAI-compatible sidecar)."""
        from stitch_backend.core.http_gateway import gateway

        url = f"{endpoint.rstrip('/')}/v1/models"
        try:
            # localhost sidecar — bypass the outbound proxy.
            client = await gateway().make_client(timeout=5.0, use_proxy=False)
        except Exception:  # noqa: BLE001
            return []
        try:
            async with client:
                resp = await client.get(url)
                if resp.status_code != 200:
                    return []
                data = resp.json()
                models = data.get("data", [])
                return [
                    {"id": m["id"], "provider": self.provider_id, "name": m.get("id", m["id"])}
                    for m in models
                    if "id" in m
                ]
        except Exception:  # noqa: BLE001
            return []


class WebAdapterInferenceProvider(InferenceProvider):
    """Provider whose models come from an in-process web adapter.

    ``fetch_fn`` is injected by the caller (commands.py) and closes over
    preloaded accounts/settings — the registry itself performs no I/O and
    no DB access (same discipline as the other providers).
    """

    def __init__(
        self,
        provider_id: str,
        fetch_fn: Callable[[], Awaitable[list[ModelDict]]],
    ) -> None:
        self.provider_id = provider_id
        self._fetch_fn = fetch_fn

    async def list_models(self) -> list[ModelDict]:
        return await self._fetch_fn()


class InferenceProviderRegistry:
    """Registry of configured inference providers.

    Replaces the hardcoded per-provider dispatch that used to live in
    ``_fetch_all_provider_models``.
    """

    def __init__(self) -> None:
        self._providers: list[InferenceProvider] = []

    def register(self, provider: InferenceProvider) -> None:
        self._providers.append(provider)

    def list_all(self) -> list[InferenceProvider]:
        return list(self._providers)

    def get(self, provider_id: str) -> InferenceProvider | None:
        for p in self._providers:
            if p.provider_id == provider_id:
                return p
        return None

    async def fetch_all_models(self) -> list[ModelDict]:
        """Fetch models from every registered provider in parallel."""
        tasks: list[tuple[str, asyncio.Task]] = [
            (p.provider_id, asyncio.ensure_future(p.list_models()))
            for p in self._providers
        ]
        if not tasks:
            logger.warning("[Models] No providers configured — returning empty list")
            return []

        # Overall deadline is enforced by the caller via asyncio.wait_for.
        results = await asyncio.gather(
            *(t for _, t in tasks), return_exceptions=True
        )

        all_models: list[ModelDict] = []
        for i, result in enumerate(results):
            name = tasks[i][0] if i < len(tasks) else "?"
            if isinstance(result, list):
                all_models.extend(result)
                logger.info("[Models] %s: %d models", name, len(result))
            else:
                logger.error("[Models] %s failed: %r", name, result)

        logger.info(
            "[Models] Total: %d models from %d providers", len(all_models), len(tasks)
        )
        return all_models


def build_inference_provider_registry(
    accounts: list[dict],
    api_keys: dict[str, list[dict]],
    enabled_providers: set[str],
    *,
    key_fetchers: dict[str, KeysFetcher],
    kiro_fetcher: AccountsFetcher | None = None,
    freemodel_sidecar: str | None = None,
    web_gemini_fetcher: Callable[[], Awaitable[list[ModelDict]]] | None = None,
    web_deepseek_fetcher: Callable[[], Awaitable[list[ModelDict]]] | None = None,
    web_qwen_fetcher: Callable[[], Awaitable[list[ModelDict]]] | None = None,
) -> InferenceProviderRegistry:
    """Construct the provider registry from preloaded data + injected fetchers.

    Domain factory (lives here, not in the command layer). The I/O-bound
    ``key_fetchers`` / ``kiro_fetcher`` callables are injected by the caller so
    this module does not import the command layer (no circular import). All DB
    data must be preloaded by the caller — this performs no I/O.
    """
    registry = InferenceProviderRegistry()

    # API-key providers.
    for provider, fetcher in key_fetchers.items():
        keys = api_keys.get(provider, [])
        if not keys:
            logger.debug("[Models] No keys for %s", provider)
            continue
        registry.register(ApiKeyInferenceProvider(provider, keys, fetcher))
        logger.info("[Models] Fetching models for %s (%d keys)", provider, len(keys))

    # Account-based: Kiro.
    if kiro_fetcher is not None and (enabled_providers & {"kiro", "kiro_v2"}):
        registry.register(AccountInferenceProvider("kiro", accounts, kiro_fetcher))
        logger.info(
            "[Models] Fetching Kiro models (%d enabled accounts)",
            sum(
                1 for a in accounts
                if (a.get("provider") or "").lower() in ("kiro", "kiro_v2")
                and a.get("enabled")
            ),
        )

    # Sidecar-backed: FreeModel bridge (endpoint resolved via the supervisor;
    # returns [] when the bridge is not running).
    if freemodel_sidecar:
        registry.register(SidecarInferenceProvider("freemodel", freemodel_sidecar))

    # In-process web adapter: Gemini web (fetcher closes over preloaded
    # accounts/settings; registered only when the provider is enabled).
    if web_gemini_fetcher is not None and "web-gemini" in enabled_providers:
        registry.register(WebAdapterInferenceProvider("web-gemini", web_gemini_fetcher))
        logger.info("[Models] Fetching web-gemini models (in-process adapter)")

    # In-process web adapter: DeepSeek web (same discipline as web-gemini).
    if web_deepseek_fetcher is not None and "web-deepseek" in enabled_providers:
        registry.register(
            WebAdapterInferenceProvider("web-deepseek", web_deepseek_fetcher)
        )
        logger.info("[Models] Fetching web-deepseek models (in-process adapter)")

    # In-process web adapter: Qwen web (same discipline as web-gemini).
    if web_qwen_fetcher is not None and "web-qwen" in enabled_providers:
        registry.register(WebAdapterInferenceProvider("web-qwen", web_qwen_fetcher))
        logger.info("[Models] Fetching web-qwen models (in-process adapter)")

    return registry
