"""CRUD services for the model catalog: upstream models, access joins, public models, route targets."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import func, or_, select

from stitch_backend.core.base_repository import BaseRepository
from stitch_backend.domains.ai_gateway.model_identity import (
    canonical_model_key,
    is_valid_public_slug,
    reconcile_contract,
)
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialModelAccess,
    ProviderEndpoint,
    PublicModel,
    RouteTarget,
    UpstreamModel,
    _utcnow,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class UpstreamModelService(BaseRepository[UpstreamModel]):
    """CRUD + idempotent upsert for :class:`UpstreamModel`."""

    _model = UpstreamModel
    _pk = "id"

    async def upsert_model(
        self,
        provider_endpoint_id: str,
        upstream_model_id: str,
        *,
        display_name: str | None = None,
        enabled: bool = True,
        discovery_source: str = "manual",
        capabilities: dict | None = None,
    ) -> UpstreamModel:
        """Create or update the row for ``(provider_endpoint_id, upstream_model_id)``.

        Idempotent by the ``uq_upstream_model_per_endpoint`` unique
        constraint already defined in the ORM. SQLite doesn't reliably
        support ``ON CONFLICT DO UPDATE`` through the ORM update path used
        elsewhere in this repo, so this follows the read-then-write pattern
        from ``KeyHealthService.upsert_health``.

        This signature is relied on by the parallel migration effort — do
        not change it without coordinating.
        """
        result = await self._db.execute(
            select(UpstreamModel).where(
                UpstreamModel.provider_endpoint_id == provider_endpoint_id,
                UpstreamModel.upstream_model_id == upstream_model_id,
            ),
        )
        existing = result.scalar_one_or_none()

        if existing is not None:
            if display_name is not None:
                existing.display_name = display_name
            # ponytail: keep operator's enabled/disabled intent — discovery must not re-enable disabled models
            existing.discovery_source = discovery_source
            existing.canonical_model_key = canonical_model_key(upstream_model_id)
            if capabilities is not None:
                existing.capabilities = capabilities
            existing.last_discovered_at = _utcnow()
            existing.updated_at = _utcnow()
            await self._db.flush()
            return existing

        record = UpstreamModel(
            provider_endpoint_id=provider_endpoint_id,
            upstream_model_id=upstream_model_id,
            display_name=display_name,
            enabled=enabled,
            discovery_source=discovery_source,
            canonical_model_key=canonical_model_key(upstream_model_id),
            capabilities=capabilities,
            last_discovered_at=_utcnow(),
            created_at=_utcnow(),
        )
        self._db.add(record)
        await self._db.flush()
        return record

    async def list_models(
        self, provider_endpoint_id: str | None = None,
    ) -> list[UpstreamModel]:
        return list(await self.find_by(provider_endpoint_id=provider_endpoint_id))


class CredentialModelAccessService(BaseRepository[CredentialModelAccess]):
    """CRUD + idempotent upsert for the credential↔model access join table."""

    _model = CredentialModelAccess
    _pk = "id"

    async def upsert_access(
        self,
        credential_id: str,
        upstream_model_id: str,
        status: str = "unknown",
        last_error: str | None = None,
    ) -> CredentialModelAccess:
        """Create or update the row for ``(credential_id, upstream_model_id)``.

        Idempotent by the ``uq_credential_model_access`` unique constraint,
        following the same read-then-write pattern as
        :meth:`UpstreamModelService.upsert_model`.
        """
        result = await self._db.execute(
            select(CredentialModelAccess).where(
                CredentialModelAccess.credential_id == credential_id,
                CredentialModelAccess.upstream_model_id == upstream_model_id,
            ),
        )
        existing = result.scalar_one_or_none()

        if existing is not None:
            existing.status = status
            existing.last_error = last_error
            existing.last_verified_at = _utcnow()
            existing.updated_at = _utcnow()
            await self._db.flush()
            return existing

        record = CredentialModelAccess(
            credential_id=credential_id,
            upstream_model_id=upstream_model_id,
            status=status,
            last_error=last_error,
            last_verified_at=_utcnow(),
            created_at=_utcnow(),
        )
        self._db.add(record)
        await self._db.flush()
        return record

    async def list_access(
        self,
        credential_id: str | None = None,
        upstream_model_id: str | None = None,
    ) -> list[CredentialModelAccess]:
        return list(
            await self.find_by(
                credential_id=credential_id, upstream_model_id=upstream_model_id,
            ),
        )


class PublicModelService(BaseRepository[PublicModel]):
    """CRUD for :class:`PublicModel`."""

    _model = PublicModel
    _pk = "id"

    async def create_public_model(
        self,
        id_: str,
        *,
        display_name: str | None = None,
        enabled: bool = True,
        contract: dict | None = None,
        owner_id: int | None = None,
    ) -> PublicModel:
        return await self.create(
            id=id_,
            display_name=display_name,
            enabled=enabled,
            contract=contract,
            owner_id=owner_id,
            created_at=_utcnow(),
        )

    async def list_public_models(
        self, owner_id: int | None = None,
    ) -> list[PublicModel]:
        stmt = select(PublicModel).where(
            or_(
                PublicModel.owner_id.is_(None),
                PublicModel.owner_id == owner_id,
            )
        )
        result = await self._db.execute(stmt)
        return list(result.scalars().all())


class RouteTargetService(BaseRepository[RouteTarget]):
    """CRUD for :class:`RouteTarget`."""

    _model = RouteTarget
    _pk = "id"

    async def create_target(
        self,
        public_model_id: str,
        upstream_model_id: str,
        *,
        enabled: bool = True,
        priority: int = 100,
        weight: float = 1.0,
        cost_modifier: float = 1.0,
    ) -> RouteTarget:
        return await self.create(
            public_model_id=public_model_id,
            upstream_model_id=upstream_model_id,
            enabled=enabled,
            priority=priority,
            weight=weight,
            cost_modifier=cost_modifier,
            created_at=_utcnow(),
        )

    async def list_targets_for_public_model(
        self, public_model_id: str,
    ) -> list[RouteTarget]:
        """Return targets for ``public_model_id`` ordered by ``priority ASC,
        weight DESC`` — the ordering the future routing engine relies on.
        """
        result = await self._db.execute(
            select(RouteTarget)
            .where(RouteTarget.public_model_id == public_model_id)
            .order_by(RouteTarget.priority.asc(), RouteTarget.weight.desc()),
        )
        return list(result.scalars().all())


class ModelIdentityService:
    """Auto-group upstream models that share a canonical identity.

    A canonical key exposed by two or more enabled endpoints becomes one
    ``PublicModel`` (slug = the key) with one ``RouteTarget`` per upstream
    model, so a request survives any single provider dying.  Idempotent:
    re-running only adds missing targets and never re-prioritises existing
    ones (operator edits win).
    """

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def auto_group(self) -> dict[str, int]:
        rows = await self._load_groupable_models()
        groups: dict[tuple[int | None, str], list[tuple[UpstreamModel, ProviderEndpoint]]] = {}
        for upstream, endpoint in rows:
            key = upstream.canonical_model_key or canonical_model_key(upstream.upstream_model_id)
            if not key:
                continue
            groups.setdefault((endpoint.owner_id, key), []).append((upstream, endpoint))

        created_models = 0
        created_targets = 0
        for (owner_id, key), members in groups.items():
            if len({endpoint.id for _u, endpoint in members}) < 2:
                continue
            if not is_valid_public_slug(key):
                continue

            pub_svc = PublicModelService(self._db)
            public = await pub_svc.get_by_pk(key)
            if public is None:
                public = await pub_svc.create_public_model(
                    key,
                    display_name=key,
                    enabled=True,
                    contract=reconcile_contract([u for u, _e in members]),
                    owner_id=owner_id,
                )
                created_models += 1
            elif public.owner_id != owner_id:
                # Slug is globally unique; never fold another owner's endpoints into it.
                continue
            elif public.contract is None:
                public.contract = reconcile_contract([u for u, _e in members])
                public.updated_at = _utcnow()

            weights = await self._healthy_cred_counts([u.id for u, _e in members])
            target_svc = RouteTargetService(self._db)
            existing = {
                t.upstream_model_id
                for t in await target_svc.list_targets_for_public_model(key)
            }
            ordered = sorted(members, key=lambda pair: (pair[1].name, pair[1].id))
            for index, (upstream, _endpoint) in enumerate(ordered):
                if upstream.id in existing:
                    continue
                await target_svc.create_target(
                    key,
                    upstream.id,
                    priority=10 * (index + 1),
                    weight=float(max(1, weights.get(upstream.id, 0))),
                )
                created_targets += 1

        await self._db.flush()
        return {
            "public_models_created": created_models,
            "route_targets_created": created_targets,
        }

    async def _load_groupable_models(self) -> list[tuple[UpstreamModel, ProviderEndpoint]]:
        stmt = (
            select(UpstreamModel, ProviderEndpoint)
            .join(
                ProviderEndpoint,
                UpstreamModel.provider_endpoint_id == ProviderEndpoint.id,
            )
            .where(
                UpstreamModel.enabled == True,  # noqa: E712
                ProviderEndpoint.enabled == True,  # noqa: E712
            )
        )
        result = await self._db.execute(stmt)
        return [(row[0], row[1]) for row in result.all()]

    async def _healthy_cred_counts(self, upstream_ids: list[str]) -> dict[str, int]:
        if not upstream_ids:
            return {}
        stmt = (
            select(CredentialModelAccess.upstream_model_id, func.count())
            .join(Credential, Credential.id == CredentialModelAccess.credential_id)
            .where(
                CredentialModelAccess.upstream_model_id.in_(upstream_ids),
                CredentialModelAccess.status == "available",
                Credential.enabled == True,  # noqa: E712
                Credential.runtime_status.in_(("active", "unknown")),
            )
            .group_by(CredentialModelAccess.upstream_model_id)
        )
        result = await self._db.execute(stmt)
        return {row[0]: int(row[1]) for row in result.all()}
