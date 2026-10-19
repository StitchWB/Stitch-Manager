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

from typing import Any

from stitch_backend.domains.ai_gateway.credential_service import (
    CredentialService,
    _secret_type_for_auth_type,
    compute_fingerprint,
)
from stitch_backend.domains.ai_gateway.endpoint_service import ProviderEndpointService
from stitch_backend.domains.ai_gateway.model_catalog_service import (
    CredentialModelAccessService,
    PublicModelService,
    RouteTargetService,
    UpstreamModelService,
)
from stitch_backend.domains.ai_gateway.proxy_key_service import (
    _MAX_ENABLED_KEYS_PER_USER,
    _RESOLVE_PROXY_KEY_LIMIT,
    UserProxyKeyService,
    _hash_proxy_key,
    _mask_proxy_key,
    flush_last_used_at,
    mark_used,
)

__all__ = [
    "CredentialModelAccessService",
    "CredentialService",
    "ProviderEndpointService",
    "PublicModelService",
    "RouteTargetService",
    "UpstreamModelService",
    "UserProxyKeyService",
    "_MAX_ENABLED_KEYS_PER_USER",
    "_RESOLVE_PROXY_KEY_LIMIT",
    "_hash_proxy_key",
    "_mask_proxy_key",
    "_secret_type_for_auth_type",
    "compute_fingerprint",
    "flush_last_used_at",
    "mark_used",
]


def __getattr__(name: str) -> Any:
    # _last_used_batch is rebound (not mutated) by flush_last_used_at — resolve it lazily
    if name == "_last_used_batch":
        from stitch_backend.domains.ai_gateway.proxy_key_service import _last_used_batch

        return _last_used_batch
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
