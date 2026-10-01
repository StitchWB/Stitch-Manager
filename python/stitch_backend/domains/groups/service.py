"""Groups domain service — membership helpers + all group operations.

Wave-2 (pool routing) imports the membership helpers:
  - ``group_ids_for_user(db, uid) -> list[str]``
  - ``is_member(db, group_id, uid) -> bool``
  - ``get_group(db, group_id) -> Group | None``
  - ``normalize_username(username) -> str``

All functions take ``db: AsyncSession`` as the first argument and use
``await db.flush()`` (never ``commit()``) — the caller commits via
``run_in_session()``.
"""

from stitch_backend.domains.groups.invites import (
    invite_user,
    resolve_invite,
    revoke_invite,
)
from stitch_backend.domains.groups.lifecycle import (
    create_group,
    delete_group,
    get_group_detail,
    list_groups_for_user,
    transfer_ownership,
    update_group,
)
from stitch_backend.domains.groups.membership import (
    MAX_GROUPS_PER_OWNER,
    MAX_MEMBERS_PER_GROUP,
    get_group,
    group_ids_for_user,
    group_role,
    is_member,
    leave_group,
    normalize_username,
    remove_member,
)
from stitch_backend.domains.groups.pool import (
    list_pool,
    mask_secret,
    share_credential,
    unshare_credential,
)
from stitch_backend.domains.groups.shares import (
    is_group_owner_of_resource,
    list_group_resources,
    resource_shares,
    share_resource,
    unshare_resource,
)
from stitch_backend.domains.groups.usage import (
    delete_quota_rule,
    list_group_usage,
    list_quota_rules,
    set_group_quota,
    set_quota_rule,
)

__all__ = [
    "MAX_GROUPS_PER_OWNER",
    "MAX_MEMBERS_PER_GROUP",
    "create_group",
    "delete_group",
    "delete_quota_rule",
    "get_group",
    "get_group_detail",
    "group_ids_for_user",
    "group_role",
    "invite_user",
    "is_group_owner_of_resource",
    "is_member",
    "leave_group",
    "list_group_resources",
    "list_group_usage",
    "list_groups_for_user",
    "list_pool",
    "list_quota_rules",
    "mask_secret",
    "normalize_username",
    "remove_member",
    "resolve_invite",
    "resource_shares",
    "revoke_invite",
    "set_group_quota",
    "set_quota_rule",
    "share_credential",
    "share_resource",
    "transfer_ownership",
    "unshare_credential",
    "unshare_resource",
    "update_group",
]
