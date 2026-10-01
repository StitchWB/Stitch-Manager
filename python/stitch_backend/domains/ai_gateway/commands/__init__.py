"""AI Gateway command handlers — registered via ``@register_command``.

Full CRUD for every entity in the domain (``ProviderEndpoint``,
``Credential``, ``UpstreamModel``, ``CredentialModelAccess``,
``PublicModel``, ``RouteTarget``), plus the two special ``Credential``
actions (``rotate_credential_secret`` and the underlying invocation-secret
access, which is intentionally NOT exposed as a command — see
``CredentialService.get_secret_for_invocation`` docstring).

Every handler validates ``params`` through the matching Pydantic request
schema (``model_validate(params)``) then performs the DB operation via
``run_in_session(...)``, matching the pattern in
``domains/key_health/commands.py``.

NOTE: ``Group`` and ``GroupMember`` are NOT imported at top level — that
would re-create the ``ai_gateway → groups`` import edge.  They are
lazy-imported inside the few command handlers that need them.
"""

from stitch_backend.domains.ai_gateway.commands.admin import (
    cmd_gateway_claim_legacy,
    cmd_gateway_set_instance_shared,
)
from stitch_backend.domains.ai_gateway.commands.credentials import (
    cmd_create_credential,
    cmd_delete_credential,
    cmd_get_credential,
    cmd_list_credentials,
    cmd_rotate_credential_secret,
    cmd_update_credential,
)
from stitch_backend.domains.ai_gateway.commands.discovery import (
    cmd_discover_models_for_endpoint,
    cmd_test_credential_connection,
)
from stitch_backend.domains.ai_gateway.commands.endpoints import (
    cmd_create_provider_endpoint,
    cmd_delete_provider_endpoint,
    cmd_get_provider_endpoint,
    cmd_list_provider_endpoints,
    cmd_update_provider_endpoint,
)
from stitch_backend.domains.ai_gateway.commands.model_access import (
    cmd_delete_credential_model_access,
    cmd_list_credential_model_access,
    cmd_upsert_credential_model_access,
)
from stitch_backend.domains.ai_gateway.commands.opencode_import import (
    cmd_import_opencode_providers,
)
from stitch_backend.domains.ai_gateway.commands.proxy_keys import (
    cmd_proxy_keys_create,
    cmd_proxy_keys_list,
    cmd_proxy_keys_revoke,
)
from stitch_backend.domains.ai_gateway.commands.public_models import (
    cmd_create_public_model,
    cmd_delete_public_model,
    cmd_get_public_model,
    cmd_list_public_models,
    cmd_update_public_model,
)
from stitch_backend.domains.ai_gateway.commands.route_targets import (
    cmd_create_route_target,
    cmd_delete_route_target,
    cmd_get_route_target,
    cmd_list_route_targets_for_public_model,
    cmd_update_route_target,
)
from stitch_backend.domains.ai_gateway.commands.upstream_models import (
    cmd_create_upstream_model,
    cmd_delete_upstream_model,
    cmd_get_upstream_model,
    cmd_list_upstream_models,
    cmd_update_upstream_model,
)

__all__ = [
    "cmd_create_credential",
    "cmd_create_provider_endpoint",
    "cmd_create_public_model",
    "cmd_create_route_target",
    "cmd_create_upstream_model",
    "cmd_delete_credential",
    "cmd_delete_credential_model_access",
    "cmd_delete_provider_endpoint",
    "cmd_delete_public_model",
    "cmd_delete_route_target",
    "cmd_delete_upstream_model",
    "cmd_discover_models_for_endpoint",
    "cmd_gateway_claim_legacy",
    "cmd_gateway_set_instance_shared",
    "cmd_get_credential",
    "cmd_get_provider_endpoint",
    "cmd_get_public_model",
    "cmd_get_route_target",
    "cmd_get_upstream_model",
    "cmd_import_opencode_providers",
    "cmd_list_credential_model_access",
    "cmd_list_credentials",
    "cmd_list_provider_endpoints",
    "cmd_list_public_models",
    "cmd_list_route_targets_for_public_model",
    "cmd_list_upstream_models",
    "cmd_proxy_keys_create",
    "cmd_proxy_keys_list",
    "cmd_proxy_keys_revoke",
    "cmd_rotate_credential_secret",
    "cmd_test_credential_connection",
    "cmd_update_credential",
    "cmd_update_provider_endpoint",
    "cmd_update_public_model",
    "cmd_update_route_target",
    "cmd_update_upstream_model",
    "cmd_upsert_credential_model_access",
]
