"""Read-only aggregate for gateway runtime and rb/* routing state."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from stitch_backend.config import get_settings
from stitch_backend.core.command_decorator import command
from stitch_backend.domains.ai_gateway.role_catalog_service import RoleCatalogService
from stitch_backend.domains.ai_gateway.schemas import (
    AiGatewayRoutingStatusResponse,
    GatewayRuntimeStatusResponse,
    RoleRoutingStatusResponse,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


@command("get_ai_gateway_routing_status", readonly=True)
async def cmd_get_ai_gateway_routing_status(
    db: AsyncSession,
    _params: dict,
) -> AiGatewayRoutingStatusResponse:
    """Aggregate rb/* desired chains, runtime lifecycle and probe evidence.

    The gateway is embedded in the backend process but can be disabled by
    configuration, so the response carries the configured router state rather
    than inferring health merely from the command being served.  Reachability
    of upstream providers is represented per chain step instead of being
    collapsed into this process-health flag.
    """
    settings = get_settings()
    roles = await RoleCatalogService(db).role_routing_status()
    return AiGatewayRoutingStatusResponse(
        gateway=GatewayRuntimeStatusResponse(
            running=bool(getattr(settings, "litellm_gateway_enabled", True)),
            base_url=(
                f"http://127.0.0.1:{settings.port}"
                f"{settings.litellm_gateway_model_prefix}"
            ),
            port=settings.port,
        ),
        roles=[RoleRoutingStatusResponse.model_validate(role) for role in roles],
        generated_at=datetime.now(UTC),
    )
