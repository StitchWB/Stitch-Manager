"""Credential + secret lifecycle services (fingerprint dedup, rotation, invocation fetch)."""

from __future__ import annotations

import hashlib
import logging

from sqlalchemy import or_, select

from stitch_backend.core.base_repository import BaseRepository
from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialSecret,
    _utcnow,
)

# pinned to the pre-split module name so existing log routing keeps working
logger = logging.getLogger("stitch_backend.domains.ai_gateway.service")


def compute_fingerprint(provider_endpoint_id: str, secret: str) -> str:
    """SHA256(endpoint_id + '\\0' + secret) — matches ``Credential.fingerprint``'s
    documented dedup-key contract. Never logs or returns the raw secret.
    """
    return hashlib.sha256(f"{provider_endpoint_id}\0{secret}".encode()).hexdigest()


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
        the existing row is returned and no duplicate is created. This
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
