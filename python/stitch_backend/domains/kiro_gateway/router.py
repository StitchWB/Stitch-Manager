"""Kiro gateway router — builds the FastAPI router via the shared factory.

Mounts at /v1 internally (the shared factory prefix), attached under
the /kiro prefix in main.py to avoid shadowing LiteLLM's /v1.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import TYPE_CHECKING

from stitch_backend.domains.ai_proxy.litellm_gateway import (
    create_native_gateway_router,
)
from stitch_backend.domains.kiro_gateway.executor import KiroExecutor
from stitch_backend.domains.kiro_gateway.pool import AccountPool
from stitch_backend.domains.kiro_gateway.session import SessionAffinityStore
from stitch_backend.domains.kiro_gateway.stats import ProxyStats

if TYPE_CHECKING:
    from fastapi import APIRouter
    from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


def create_kiro_gateway_router(
    settings: object,
    session_factory: Callable[[], AsyncSession],
) -> APIRouter | None:
    """Build the Kiro gateway router, or None if disabled.

    Args:
        settings: Must have kiro_gateway_enabled, kiro_gateway_local_api_key attrs.
        session_factory: Async callable returning a DB session.

    Returns:
        APIRouter with /v1 prefix (to be mounted under /kiro in main.py).
    """
    ki = getattr(settings, "kiro_gateway_enabled", False)
    if not ki:
        return None
    api_key: str | None = getattr(settings, "kiro_gateway_local_api_key", None)
    if not api_key:
        return None

    import httpx

    pool = AccountPool()
    affinity = SessionAffinityStore()
    stats = ProxyStats()
    http_client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))

    def executor_factory() -> KiroExecutor:
        return KiroExecutor(pool, session_factory, affinity, stats, http_client)

    return create_native_gateway_router(
        executor_factory=executor_factory,
        local_api_key=api_key,
        reject_adapters=frozenset(),
    )