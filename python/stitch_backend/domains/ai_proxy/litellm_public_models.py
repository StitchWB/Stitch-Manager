from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from stitch_backend.domains.background_manager.schemas import BackgroundManagerConfig

logger = logging.getLogger(__name__)

ConfigLoader = Callable[[], Awaitable[BackgroundManagerConfig]]


async def _default_config() -> BackgroundManagerConfig:
    return BackgroundManagerConfig.model_validate({})


# Flag True with 0 providers is intentional: the step ran, rows may not exist.
_public_models_auto_created_flag: bool = False


def _public_models_auto_created() -> bool:
    """True if the startup auto-create step succeeded (fallback removed)."""
    return _public_models_auto_created_flag


async def auto_create_public_models_from_config(
    load_config: ConfigLoader | None = None,
) -> bool:
    """Auto-create PublicModels from legacy BackgroundManagerConfig providers.

    Runs at startup. Creates one PublicModel per provider in
    ``BackgroundManagerConfig.provider_priority`` (or derived from loaded
    keys) when no PublicModels exist. Idempotent — safe to call on every
    boot. owner_id = NULL (instance-shared).

    Returns True if the step succeeded (flag set), False on any exception
    (caller keeps the LiteLLM fallback).
    """
    global _public_models_auto_created_flag

    try:
        from sqlalchemy import func, select

        from stitch_backend.database import run_in_read_session, run_in_session
        from stitch_backend.domains.ai_gateway.models import PublicModel
        from stitch_backend.domains.ai_gateway.service import PublicModelService

        # Check if any PublicModels exist.
        async def _count(session):
            result = await session.execute(select(func.count()).select_from(PublicModel))
            return int(result.scalar_one())

        existing = await run_in_read_session(_count)
        if existing > 0:
            # Existing rows serve the same purpose — the step counts as succeeded.
            _public_models_auto_created_flag = True
            return True

        # Load config + keys to discover providers.
        config = await (load_config or _default_config)()
        provider_keys = await _load_keys_for_auto_create()

        # Derive provider list from config.provider_priority + loaded keys.
        providers: set[str] = set()
        providers.update(config.provider_priority)
        providers.update(provider_keys.keys())
        # Filter out sentinel/internal keys.
        providers.discard("__custom_providers__")

        if not providers:
            # No providers configured — nothing to create; the step still counts as succeeded.
            _public_models_auto_created_flag = True
            return True

        async def _create(session):
            svc = PublicModelService(session)
            for provider in sorted(providers):
                model_id = f"{provider}/*"
                # Idempotent: check before create.
                result = await session.execute(
                    select(PublicModel).where(PublicModel.id == model_id)
                )
                if result.scalar_one_or_none() is not None:
                    continue
                await svc.create_public_model(
                    model_id,
                    display_name=provider,
                    enabled=True,
                    owner_id=None,
                )
            # P2.12: flush, not commit — run_in_session commits the outer transaction.
            await session.flush()

        await run_in_session(_create)
        _public_models_auto_created_flag = True
        logger.info(
            "PublicModel auto-create succeeded: %d providers", len(providers),
        )
        return True
    except Exception as exc:
        logger.warning(
            "PublicModel auto-create failed — keeping LiteLLM fallback: %s", exc,
        )
        _public_models_auto_created_flag = False
        return False


async def _load_keys_for_auto_create() -> dict[str, list[dict]]:
    """Load provider keys for the auto-create step.

    Mirrors the executor's former key loader (which fed ``_providers``)
    so the PublicModel auto-create covers every provider the LiteLLM
    Router would have served — including custom providers, which the
    original built-in-only list missed (L2 gap fix). Safe fallback when
    the real loader is unavailable (e.g. during tests).
    """
    try:
        from stitch_backend.database import run_in_read_session
        from stitch_backend.domains.api_keys.custom_providers import (
            custom_provider_db_key,
            get_custom_providers,
        )
        from stitch_backend.domains.api_keys.service import ApiKeysService

        async def _load(session):
            svc = ApiKeysService(session)
            result: dict[str, list[dict]] = {}
            for provider in (
                "openai", "anthropic", "gemini", "antigravity",
                "fireworks", "zai", "dashscope",
            ):
                try:
                    keys = await svc.get_keys(provider)
                    if keys:
                        result[provider] = keys
                except Exception:
                    pass

            # Custom providers must be covered too (the legacy _providers list included them).
            try:
                custom_providers = await get_custom_providers(session)
                for cp in custom_providers:
                    cp_keys = await svc.get_keys_by_db_key(custom_provider_db_key(cp.id))
                    if cp_keys:
                        result[f"custom_{cp.id}"] = cp_keys
            except Exception:
                pass

            return result

        return await run_in_read_session(_load)
    except Exception:
        return {}
