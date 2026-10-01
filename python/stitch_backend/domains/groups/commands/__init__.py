"""Groups command handlers — registered via ``@register_command``.

Mirrors the pattern in ``domains/ai_gateway/commands/``: each handler
validates params, delegates to the service layer via
``run_in_session`` / ``run_in_read_session``, and returns a Pydantic
response model from :mod:`stitch_backend.domains.groups.schemas`.

The dispatcher (``cmd_dispatcher._serialise``) calls
``model_dump(mode="json", by_alias=True)`` on the way out; since groups
schemas use snake_case field names with no aliases, ``by_alias=True``
returns the field names verbatim — the wire format is unchanged.

Response shapes (snake_case — the frontend agent codes against these):
  - groups_create          → GroupCreateResponse{group: GroupResponse}
  - groups_list            → GroupListResponse{groups, invites}
  - groups_get             → GroupDetailResponse{group, members, invites, is_owner}
  - groups_invite          → InviteCreateResponse{invite: InviteResponse}
  - groups_invite_resolve  → SuccessResponse
  - groups_invite_revoke   → SuccessResponse
  - groups_remove_member   → SuccessResponse
  - groups_leave           → SuccessResponse
  - groups_update          → GroupResponse
  - groups_delete          → SuccessResponse
  - groups_share_credential    → SuccessResponse
  - groups_unshare_credential  → SuccessResponse
  - groups_pool_list       → PoolListResponse{items}
  - groups_usage_list      → UsageListResponse{rows, max_per_member_daily}
  - groups_set_quota       → GroupResponse
  - groups_transfer_ownership  → GroupResponse
  - groups_share_account   → SuccessResponse
  - groups_unshare_account → SuccessResponse
  - groups_list_accounts   → list[GroupAccountItemResponse]  (camelCase aliases)
"""

from stitch_backend.domains.groups.commands.invites import (
    cmd_groups_invite,
    cmd_groups_invite_resolve,
    cmd_groups_invite_revoke,
)
from stitch_backend.domains.groups.commands.lifecycle import (
    cmd_groups_create,
    cmd_groups_delete,
    cmd_groups_get,
    cmd_groups_list,
    cmd_groups_transfer_ownership,
    cmd_groups_update,
)
from stitch_backend.domains.groups.commands.membership import (
    cmd_groups_leave,
    cmd_groups_remove_member,
)
from stitch_backend.domains.groups.commands.pool import (
    cmd_groups_pool_list,
    cmd_groups_share_credential,
    cmd_groups_unshare_credential,
)
from stitch_backend.domains.groups.commands.shares import (
    cmd_groups_list_accounts,
    cmd_groups_share_account,
    cmd_groups_unshare_account,
)
from stitch_backend.domains.groups.commands.usage import (
    cmd_groups_quota_rule_delete,
    cmd_groups_quota_rule_set,
    cmd_groups_quota_rules_list,
    cmd_groups_set_quota,
    cmd_groups_usage_list,
)

__all__ = [
    "cmd_groups_create",
    "cmd_groups_delete",
    "cmd_groups_get",
    "cmd_groups_invite",
    "cmd_groups_invite_resolve",
    "cmd_groups_invite_revoke",
    "cmd_groups_leave",
    "cmd_groups_list",
    "cmd_groups_list_accounts",
    "cmd_groups_pool_list",
    "cmd_groups_quota_rule_delete",
    "cmd_groups_quota_rule_set",
    "cmd_groups_quota_rules_list",
    "cmd_groups_remove_member",
    "cmd_groups_set_quota",
    "cmd_groups_share_account",
    "cmd_groups_share_credential",
    "cmd_groups_transfer_ownership",
    "cmd_groups_unshare_account",
    "cmd_groups_unshare_credential",
    "cmd_groups_update",
    "cmd_groups_usage_list",
]
