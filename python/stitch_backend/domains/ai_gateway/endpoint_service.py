"""CRUD service for :class:`ProviderEndpoint`."""

from __future__ import annotations

from sqlalchemy import or_, select

from stitch_backend.core.base_repository import BaseRepository
from stitch_backend.domains.ai_gateway.models import ProviderEndpoint, _utcnow


class ProviderEndpointService(BaseRepository[ProviderEndpoint]):
    """CRUD for :class:`ProviderEndpoint`."""

    _model = ProviderEndpoint
    _pk = "id"

    async def create_endpoint(
        self,
        *,
        name: str,
        adapter_type: str,
        base_url: str,
        enabled: bool = True,
        default_headers: dict | None = None,
        discovery_policy: dict | None = None,
        health_policy: dict | None = None,
        owner_id: int | None = None,
    ) -> ProviderEndpoint:
        return await self.create(
            name=name,
            adapter_type=adapter_type,
            base_url=base_url,
            enabled=enabled,
            default_headers=default_headers,
            discovery_policy=discovery_policy,
            health_policy=health_policy,
            owner_id=owner_id,
            created_at=_utcnow(),
        )

    async def list_endpoints(
        self, owner_id: int | None = None,
    ) -> list[ProviderEndpoint]:
        stmt = select(ProviderEndpoint).where(
            or_(
                ProviderEndpoint.owner_id.is_(None),
                ProviderEndpoint.owner_id == owner_id,
            )
        ).order_by(ProviderEndpoint.created_at.desc())
        result = await self._db.execute(stmt)
        return list(result.scalars().all())

    async def list_all_endpoints(
        self,
    ) -> list[ProviderEndpoint]:
        """Return ALL endpoints (instance-wide, no owner filter).

        Used by background workers (DiscoveryWorker, ProbeWorker) which
        are instance-wide by design — fixes the prior bug where
        ``list_endpoints()`` with ``owner_id=None`` saw ONLY NULL rows.
        """
        stmt = select(ProviderEndpoint).order_by(
            ProviderEndpoint.created_at.desc()
        )
        result = await self._db.execute(stmt)
        return list(result.scalars().all())
