"""Pydantic request/response schemas for the ai_gateway domain.

Per the project's type-validation convention, incoming params are validated
through Pydantic models with ``populate_by_name=True`` and camelCase
aliases via ``Field(alias=...)`` so both camelCase (frontend-native) and
snake_case keys are accepted on the way in. The dispatcher
(``cmd_dispatcher._serialise``) handles ``model_dump(mode="json",
by_alias=True)`` automatically on the way out, so response schemas below
use plain Python types (``datetime``, ``dict``) rather than pre-serialising
to strings — that JSON-to-str convention is specific to
``AccountResponse``'s wire contract, not a general project rule.

IMPORTANT: ``CredentialResponse`` intentionally never references
``CredentialSecret`` — the whole point of splitting that table out is that
credential listing/health code paths structurally cannot carry secret
material. Never add a ``secret``/``secretValue`` field to this schema.
"""

from stitch_backend.domains.ai_gateway.schemas.admin import (
    GatewayClaimLegacyRequest,
    GatewaySetInstanceSharedRequest,
)
from stitch_backend.domains.ai_gateway.schemas.credentials import (
    CredentialCreateRequest,
    CredentialIdRequest,
    CredentialResponse,
    CredentialUpdateRequest,
    ListCredentialsRequest,
    RotateCredentialSecretRequest,
)
from stitch_backend.domains.ai_gateway.schemas.endpoints import (
    ProviderEndpointCreateRequest,
    ProviderEndpointIdRequest,
    ProviderEndpointResponse,
    ProviderEndpointUpdateRequest,
)
from stitch_backend.domains.ai_gateway.schemas.model_access import (
    CredentialModelAccessIdRequest,
    CredentialModelAccessResponse,
    CredentialModelAccessUpsertRequest,
    ListCredentialModelAccessRequest,
)
from stitch_backend.domains.ai_gateway.schemas.proxy_keys import (
    ProxyKeyCreatedResponse,
    ProxyKeyCreateRequest,
    ProxyKeyListResponse,
    ProxyKeyPoolGroupEntry,
    ProxyKeyResponse,
    ProxyKeyRevokeRequest,
)
from stitch_backend.domains.ai_gateway.schemas.public_models import (
    ListPublicModelsRequest,
    PublicModelCreateRequest,
    PublicModelIdRequest,
    PublicModelResponse,
    PublicModelUpdateRequest,
)
from stitch_backend.domains.ai_gateway.schemas.route_targets import (
    ListRouteTargetsForPublicModelRequest,
    RouteTargetCreateRequest,
    RouteTargetIdRequest,
    RouteTargetResponse,
    RouteTargetUpdateRequest,
)
from stitch_backend.domains.ai_gateway.schemas.upstream_models import (
    ListUpstreamModelsRequest,
    UpstreamModelCreateRequest,
    UpstreamModelIdRequest,
    UpstreamModelResponse,
    UpstreamModelUpdateRequest,
)

__all__ = [
    "CredentialCreateRequest",
    "CredentialIdRequest",
    "CredentialModelAccessIdRequest",
    "CredentialModelAccessResponse",
    "CredentialModelAccessUpsertRequest",
    "CredentialResponse",
    "CredentialUpdateRequest",
    "GatewayClaimLegacyRequest",
    "GatewaySetInstanceSharedRequest",
    "ListCredentialModelAccessRequest",
    "ListCredentialsRequest",
    "ListPublicModelsRequest",
    "ListRouteTargetsForPublicModelRequest",
    "ListUpstreamModelsRequest",
    "ProviderEndpointCreateRequest",
    "ProviderEndpointIdRequest",
    "ProviderEndpointResponse",
    "ProviderEndpointUpdateRequest",
    "ProxyKeyCreatedResponse",
    "ProxyKeyCreateRequest",
    "ProxyKeyListResponse",
    "ProxyKeyPoolGroupEntry",
    "ProxyKeyResponse",
    "ProxyKeyRevokeRequest",
    "PublicModelCreateRequest",
    "PublicModelIdRequest",
    "PublicModelResponse",
    "PublicModelUpdateRequest",
    "RotateCredentialSecretRequest",
    "RouteTargetCreateRequest",
    "RouteTargetIdRequest",
    "RouteTargetResponse",
    "RouteTargetUpdateRequest",
    "UpstreamModelCreateRequest",
    "UpstreamModelIdRequest",
    "UpstreamModelResponse",
    "UpstreamModelUpdateRequest",
]
