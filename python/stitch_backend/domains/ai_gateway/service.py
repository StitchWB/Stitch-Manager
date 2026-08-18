"""AI Gateway services — CRUD and business logic for the provider/credential/model catalog.

One service class per aggregate, each taking ``db: AsyncSession`` in
``__init__`` (same pattern as ``KeyHealthService``). DB writes use
``self._db.flush()`` — never ``commit()`` — the caller commits via
``run_in_session()``.

Two methods have stable, documented signatures relied on by the parallel
migration effort (reads from the legacy ``ai_proxy_accounts`` /
``ai_proxy_settings`` / ``custom_providers_v1`` tables) as its integration
point into this domain:

    CredentialService.create_credential(provider_endpoint_id, label, auth_type, secret, ...)
    UpstreamModelService.upsert_model(provider_endpoint_id, upstream_model_id, ...)

Do not change these signatures without coordinating with that effort.
"""

from __future__ import annotations

import hashlib
import logging

from sqlalchemy import or_, select

from stitch_backend.core.base_repository import BaseRepository
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialModelAccess,
    CredentialSecret,
    ProviderEndpoint,
    PublicModel,
    RouteTarget,
    UpstreamModel,
    _utcnow,
)

logger = logging.getLogger(__name__)


def compute_fingerprint(provider_endpoint_id: str, secret: str) -> str:
    """SHA256(endpoint_id + '\\0' + secret) — matches ``Credential.fingerprint``'s
    documented dedup-key contract. Never logs or returns the raw secret.
    """
    return hashlib.sha256(f"{provider_endpoint_id}\0{secret}".encode()).hexdigest()


# ═══════════════════════════════════════════════════════════════════════════
# ProviderEndpoint
# ═══════════════════════════════════════════════════════════════════════════


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


# ═══════════════════════════════════════════════════════════════════════════
# Credential
# ═══════════════════════════════════════════════════════════════════════════


class CredentialService(BaseRepository[Credential]):
    """CRUD + secret lifecycle for :class:`Credential` / :class:`CredentialSecret`.

    ``list_credentials`` and every plain CRUD method here only ever touch
    the ``Credential`` table — never ``CredentialSecret`` — by design.  The
    only sanctioned way to read a raw secret is
    :meth:`get_secret_for_invocation`.
    """

    _model = Credential
    _pk = "id"

    async def create_credential(
        self,
        provider_endpoint_id: str,
        label: str | None,
        auth_type: str,
        secret: str,
        owner_id: int | None = None,
    ) -> Credential:
        """Create a :class:`Credential` + linked :class:`CredentialSecret`.

        Idempotent by fingerprint: if a credential with the same
        ``SHA256(provider_endpoint_id + '\\0' + secret)`` already exists,
        that existing row is returned instead of creating a duplicate. This
        matters for the migration task that calls this repeatedly for the
        same legacy key.

        Args:
            provider_endpoint_id: FK to :class:`ProviderEndpoint`.
            label: Optional user-facing label.
            auth_type: ``api_key`` | ``oauth`` | ``session``.
            secret: RAW secret value. Hashed into ``fingerprint`` for dedup
                and stored verbatim in ``CredentialSecret.secret_value`` —
                never persisted on the ``Credential`` row itself.

        Returns:
            The new or pre-existing :class:`Credential` (never includes the
            secret — fetch it separately via
            :meth:`get_secret_for_invocation` if needed).
        """
        fingerprint = compute_fingerprint(provider_endpoint_id, secret)

        result = await self._db.execute(
            select(Credential).where(Credential.fingerprint == fingerprint),
        )
        existing = result.scalar_one_or_none()
        if existing is not None:
            return existing

        credential = Credential(
            provider_endpoint_id=provider_endpoint_id,
            label=label,
            auth_type=auth_type,
            fingerprint=fingerprint,
            enabled=True,
            runtime_status="unknown",
            owner_id=owner_id,
            created_at=_utcnow(),
        )
        self._db.add(credential)
        await self._db.flush()  # assigns credential.id via default=_uuid

        secret_type = _secret_type_for_auth_type(auth_type)
        credential_secret = CredentialSecret(
            credential_id=credential.id,
            secret_value=secret,
            secret_type=secret_type,
            created_at=_utcnow(),
        )
        self._db.add(credential_secret)
        await self._db.flush()

        logger.info(
            "Credential created: endpoint=%s auth_type=%s id=%s",
            provider_endpoint_id, auth_type, credential.id,
        )
        return credential

    async def rotate_secret(self, credential_id: str, new_secret: str) -> Credential | None:
        """Rotate the raw secret for a credential.

        Updates ``CredentialSecret.secret_value``, recomputes and updates
        ``Credential.fingerprint``, and resets ``runtime_status`` to
        ``"unknown"`` — a rotated secret needs re-verification before it can
        be trusted again.

        Returns:
            The updated :class:`Credential`, or ``None`` if it doesn't exist.
        """
        credential = await self.get_by_pk(credential_id)
        if credential is None:
            return None

        result = await self._db.execute(
            select(CredentialSecret).where(CredentialSecret.credential_id == credential_id),
        )
        secret_row = result.scalar_one_or_none()
        if secret_row is None:
            # Shouldn't normally happen (1:1), but stay defensive.
            secret_row = CredentialSecret(
                credential_id=credential_id,
                secret_value=new_secret,
                secret_type=_secret_type_for_auth_type(credential.auth_type),
                created_at=_utcnow(),
            )
            self._db.add(secret_row)
        else:
            secret_row.secret_value = new_secret
            secret_row.updated_at = _utcnow()

        credential.fingerprint = compute_fingerprint(
            credential.provider_endpoint_id, new_secret,
        )
        credential.runtime_status = "unknown"
        credential.status_reason = None
        credential.updated_at = _utcnow()

        await self._db.flush()
        await self._db.refresh(credential)
        logger.info("Secret rotated for credential %s", credential_id)
        return credential

    async def list_credentials(
        self, provider_endpoint_id: str | None = None,
        owner_id: int | None = None,
    ) -> list[Credential]:
        """Return :class:`Credential` rows only — never joins ``CredentialSecret``."""
        stmt = select(Credential).where(
            or_(
                Credential.owner_id.is_(None),
                Credential.owner_id == owner_id,
            )
        )
        if provider_endpoint_id is not None:
            stmt = stmt.where(Credential.provider_endpoint_id == provider_endpoint_id)
        result = await self._db.execute(stmt)
        return list(result.scalars().all())

    async def get_secret_for_invocation(self, credential_id: str) -> str | None:
        """Return the RAW secret value for a credential.

        THIS IS THE ONLY SANCTIONED PATH for an adapter/executor to obtain
        raw secret material at request time. No other method on this
        service (or anywhere else in the domain) should return
        ``CredentialSecret.secret_value``. Do not add logging of the
        returned value.

        Returns:
            The raw secret string, or ``None`` if no secret row exists for
            this credential.
        """
        result = await self._db.execute(
            select(CredentialSecret).where(CredentialSecret.credential_id == credential_id),
        )
        secret_row = result.scalar_one_or_none()
        return secret_row.secret_value if secret_row is not None else None


def _secret_type_for_auth_type(auth_type: str) -> str:
    """Map ``Credential.auth_type`` to the matching ``CredentialSecret.secret_type``."""
    return {
        "api_key": "api_key",
        "oauth": "oauth_access_token",
        "session": "session_token",
    }.get(auth_type, "api_key")


# ═══════════════════════════════════════════════════════════════════════════
# UpstreamModel
# ═══════════════════════════════════════════════════════════════════════════


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
            # ponytail: preserve operator's enabled/disabled intent on upsert.
            # Discovery should not re-enable manually disabled models.
            existing.discovery_source = discovery_source
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


# ═══════════════════════════════════════════════════════════════════════════
# CredentialModelAccess
# ═══════════════════════════════════════════════════════════════════════════


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


# ═══════════════════════════════════════════════════════════════════════════
# PublicModel
# ═══════════════════════════════════════════════════════════════════════════


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


# ═══════════════════════════════════════════════════════════════════════════
# RouteTarget
# ═══════════════════════════════════════════════════════════════════════════


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
