"""AI Gateway domain — unified provider/credential/model catalog.

Single source of truth for routing native AI-proxy requests: which provider
endpoints exist, which credentials belong to them, which upstream models
each credential can reach, and what public model aliases resolve to.

See ``models.py`` module docstring for the full entity design.
"""

from stitch_backend.domains.ai_gateway.models import (
    Credential,
    CredentialModelAccess,
    CredentialSecret,
    ProviderEndpoint,
    PublicModel,
    RouteTarget,
    UpstreamModel,
)

__all__ = [
    "Credential",
    "CredentialModelAccess",
    "CredentialSecret",
    "ProviderEndpoint",
    "PublicModel",
    "RouteTarget",
    "UpstreamModel",
]
