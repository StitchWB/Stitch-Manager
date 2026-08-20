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
import hmac
import logging
import secrets
from typing import TYPE_CHECKING

from sqlalchemy import and_, or_, select

from stitch_backend.core.base_repository import BaseRepository
from stitch_backend.core.exceptions import StitchError
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialModelAccess,
    CredentialSecret,
    ProviderEndpoint,
    PublicModel,
    RouteTarget,
    UpstreamModel,
    UserProxyKey,
    _utcnow,
)

if TYPE_CHECKING:
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession

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

    async def list_all_credentials(
        self, provider_endpoint_id: str | None = None,
    ) -> list[Credential]:
        """Return ALL credentials (instance-wide, no owner filter).

        Used by background workers (DiscoveryWorker, ProbeWorker) which
        are instance-wide by design — fixes the prior bug where
        ``list_credentials()`` with ``owner_id=None`` saw ONLY NULL rows.
        """
        stmt = select(Credential)
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


# ═══════════════════════════════════════════════════════════════════════════
# UserProxyKey
# ═══════════════════════════════════════════════════════════════════════════


def _hash_proxy_key(raw: str) -> str:
    """SHA256 hex of a raw proxy key — matches ``UserProxyKey.token_hash``."""
    return hashlib.sha256(raw.encode()).hexdigest()


def _mask_proxy_key(raw: str) -> str:
    """Mask a raw proxy key: first4+****+last4. Short keys → ****."""
    if len(raw) < 8:
        return "****"
    return raw[:4] + "****" + raw[-4:]


class UserProxyKeyService(BaseRepository[UserProxyKey]):
    """CRUD + resolution for :class:`UserProxyKey`.

    Raw keys are shown ONCE at creation; only the SHA256 hash is stored.
    ``last_used_at`` is batched via :func:`mark_used` (in-memory dict) and
    flushed by :func:`flush_last_used_at` from a background task — never
    written per request.
    """

    _model = UserProxyKey
    _pk = "id"

    async def create_proxy_key(
        self,
        user_id: int,
        label: str | None = None,
        *,
        is_default: bool = False,
    ) -> tuple[UserProxyKey, str]:
        """Create a proxy key. Returns ``(key_row, raw_key)`` — raw shown ONCE.

        ``raw = secrets.token_hex(24)`` (48 chars). The hash is stored; the
        raw value is returned to the caller and never persisted.
        """
        raw = secrets.token_hex(24)
        token_hash = _hash_proxy_key(raw)
        record = UserProxyKey(
            user_id=user_id,
            label=label,
            token_hash=token_hash,
            enabled=True,
            is_default=is_default,
            created_at=_utcnow(),
        )
        self._db.add(record)
        await self._db.flush()
        logger.info(
            "ProxyKey created: user=%s id=%s default=%s",
            user_id, record.id, is_default,
        )
        return record, raw

    async def list_proxy_keys(self, user_id: int) -> list[UserProxyKey]:
        """Return all proxy keys for *user_id* (enabled + disabled)."""
        result = await self._db.execute(
            select(UserProxyKey)
            .where(UserProxyKey.user_id == user_id)
            .order_by(UserProxyKey.created_at.asc())
        )
        return list(result.scalars().all())

    async def revoke_proxy_key(
        self, key_id: str, user_id: int,
    ) -> bool:
        """Disable a proxy key (own only). Returns True if revoked.

        The default key is revokable only if another enabled key exists.
        """
        result = await self._db.execute(
            select(UserProxyKey).where(
                and_(
                    UserProxyKey.id == key_id,
                    UserProxyKey.user_id == user_id,
                )
            )
        )
        key = result.scalar_one_or_none()
        if key is None:
            raise StitchError("Proxy key not found")

        if key.is_default:
            # Count other enabled keys for this user.
            count_result = await self._db.execute(
                select(UserProxyKey).where(
                    and_(
                        UserProxyKey.user_id == user_id,
                        UserProxyKey.enabled.is_(True),
                        UserProxyKey.id != key_id,
                    )
                )
            )
            other_enabled = list(count_result.scalars().all())
            if not other_enabled:
                raise StitchError(
                    "Cannot revoke the default key without another enabled key"
                )

        key.enabled = False
        await self._db.flush()
        logger.info("ProxyKey revoked: user=%s id=%s", user_id, key_id)
        return True

    async def resolve_proxy_key(self, raw: str) -> int | None:
        """Resolve a raw proxy key to a user_id (enabled keys only).

        Uses ``hmac.compare_digest`` for timing-safe comparison.  Updates
        the in-memory ``last_used_at`` batch via :func:`mark_used` — never
        writes to the DB per request.
        """
        if not raw:
            return None
        # Compute the hash and look up the candidate row.
        token_hash = _hash_proxy_key(raw)
        result = await self._db.execute(
            select(UserProxyKey).where(
                and_(
                    UserProxyKey.token_hash == token_hash,
                    UserProxyKey.enabled.is_(True),
                )
            )
        )
        key = result.scalar_one_or_none()
        if key is None:
            return None
        # Timing-safe compare against the stored hash (defends against
        # theoretical hash-leak oracles; the SELECT already matched).
        if not hmac.compare_digest(key.token_hash, token_hash):
            return None
        # Mark used — DB-first throttle (direct UPDATE at most once per 60s
        # per key, otherwise accumulate into the in-memory batch drained by
        # the background flush task).
        await mark_used(key.id)
        return key.user_id

    async def ensure_default_key(self, user_id: int) -> tuple[UserProxyKey, str] | None:
        """Ensure the user has at least one enabled key; create a default if none.

        Returns ``(key_row, raw_key)`` when a new default was created, or
        ``None`` when the user already has an enabled key.
        """
        existing = await self.list_proxy_keys(user_id)
        has_enabled = any(k.enabled for k in existing)
        if has_enabled:
            return None
        return await self.create_proxy_key(
            user_id, label="default", is_default=True,
        )


# ── Throttled last_used_at (DB-first, batch fallback) ───────────────────────


# Per-key throttle dict {key_id: last_write_ts}.  Checked by mark_used() to
# decide whether to do a direct DB write or accumulate into _last_used_batch.
_last_used_throttle: dict[str, float] = {}

# Fallback accumulator for writes within the throttle window.
# {key_id: timestamp} — flushed by flush_last_used_at() from the background task.
_last_used_batch: dict[str, datetime] = {}

# Throttle window: direct DB write at most once per this many seconds per key.
_LAST_USED_THROTTLE_SECONDS: float = 60.0


async def mark_used(key_id: str) -> None:
    """Mark a proxy key as used — DB-first with per-key throttle.

    When >60 s have elapsed since the last direct write for this key,
    writes directly to ``UserProxyKey.last_used_at`` via
    ``run_in_session`` (survives restart).  Otherwise accumulates into
    ``_last_used_batch`` (drained by the 60 s background flush task).

    The direct write is best-effort: if ``run_in_session`` fails (DB
    unavailable, no global factory configured, etc.), the data falls back
    to ``_last_used_batch`` so the request is never blocked.
    """
    import time as _time

    now_ts = _time.monotonic()
    last_write = _last_used_throttle.get(key_id)
    if last_write is not None and (now_ts - last_write) < _LAST_USED_THROTTLE_SECONDS:
        # Within throttle window — accumulate into batch.
        _last_used_batch[key_id] = _utcnow()
        return

    # Throttle window expired (or first write for this key) — direct write.
    try:
        from sqlalchemy import text as _text

        from stitch_backend.database import run_in_session

        ts = _utcnow()

        async def _direct_update(session: AsyncSession) -> None:
            await session.execute(
                _text(
                    "UPDATE ai_gateway_user_proxy_keys SET last_used_at = :ts "
                    "WHERE id = :key_id"
                ),
                {"ts": ts, "key_id": key_id},
            )

        await run_in_session(_direct_update)
        _last_used_throttle[key_id] = now_ts
    except Exception:
        # DB unavailable — fall back to batch so the request is not blocked.
        _last_used_batch[key_id] = _utcnow()
        logger.debug("Direct last_used_at write failed, accumulated to batch", exc_info=True)


async def flush_last_used_at(session: AsyncSession) -> int:
    """Flush the ``_last_used_batch`` fallback to the DB.

    Called by a background task (registered in ``main.py`` lifespan) every
    ≥60 seconds.  Returns the number of keys updated.

    Swaps the module-level dict atomically (so concurrent mark_used calls
    during the flush land in the next batch, not lost).
    """
    global _last_used_batch
    if not _last_used_batch:
        return 0
    # Swap atomically — concurrent mark_used() calls land in the new dict.
    batch, _last_used_batch = _last_used_batch, {}
    count = 0
    for key_id, ts in batch.items():
        result = await session.execute(
            select(UserProxyKey).where(UserProxyKey.id == key_id)
        )
        key = result.scalar_one_or_none()
        if key is not None:
            key.last_used_at = ts
            count += 1
    if count:
        await session.flush()
        logger.debug("ProxyKey last_used_at flushed: %d keys", count)
    return count
