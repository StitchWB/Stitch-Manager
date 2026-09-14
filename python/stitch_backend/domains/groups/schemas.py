"""Pydantic response schemas for the groups domain.

Mirrors the wire format produced by the service layer's dict builders
(``_group_to_dict``, ``_invite_to_dict``, ``list_groups_for_user``,
``get_group_detail``, ``list_pool``, ``list_group_usage``).  The
dispatcher (``cmd_dispatcher._serialise``) calls
``model_dump(mode="json", by_alias=True)`` on the way out; since groups
use snake_case field names with **no aliases**, ``by_alias=True`` returns
the field names verbatim -- the wire format is unchanged.

``datetime`` fields are typed ``datetime``; ``model_dump(mode="json")``
serialises them to ISO 8601 strings, matching the previous
``_json_safe`` path that converted ``datetime`` -> ``.isoformat()``.

FE type counterparts live in ``src/lib/backend/modules/groups.ts``.
"""

from __future__ import annotations

from datetime import datetime  # noqa: TC003 -- pydantic resolves at runtime

from pydantic import BaseModel, ConfigDict, Field

# ═══════════════════════════════════════════════════════════════════════════
# Group
# ═══════════════════════════════════════════════════════════════════════════


class GroupResponse(BaseModel):
    """A group row (FE: ``Group``).

    Returned directly by ``groups_update``, ``groups_set_quota``,
    ``groups_transfer_ownership``; wrapped in ``GroupCreateResponse``
    by ``groups_create``; nested in ``GroupDetailResponse`` by
    ``groups_get``.
    """

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    name: str
    owner_id: int
    max_requests_per_member_daily: int | None
    created_at: datetime


class GroupCreateResponse(BaseModel):
    """Wrapper for ``groups_create`` (FE: ``{ group: Group }``)."""

    group: GroupResponse


# ═══════════════════════════════════════════════════════════════════════════
# List (groups + pending invites)
# ═══════════════════════════════════════════════════════════════════════════


class GroupSummaryResponse(BaseModel):
    """A group summary row (FE: ``GroupSummary``). Used in ``groups_list``."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    name: str
    role: str
    member_count: int
    key_count: int
    created_at: datetime


class InviteSummaryResponse(BaseModel):
    """A pending-invite summary (FE: ``GroupInviteSummary``).

    Used in ``groups_list`` -- only pending invites for the caller.
    """

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    group_id: str
    group_name: str
    invited_by_username: str | None
    created_at: datetime


class GroupListResponse(BaseModel):
    """Response for ``groups_list`` (FE: ``GroupsListResponse``)."""

    groups: list[GroupSummaryResponse]
    invites: list[InviteSummaryResponse]


# ═══════════════════════════════════════════════════════════════════════════
# Detail (group + members + invites)
# ═══════════════════════════════════════════════════════════════════════════


class MemberResponse(BaseModel):
    """A group member row (FE: ``GroupMember``). Used in ``groups_get``."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    user_id: int
    username: str
    role: str
    joined_at: datetime


class InviteDetailResponse(BaseModel):
    """An invite in the group detail view (FE: ``GroupInviteDetail``).

    Differs from ``InviteSummaryResponse`` (no ``group_id``/``group_name``)
    and from ``InviteResponse`` (no ``group_id``/``status``).
    """

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    invitee_username: str
    invited_by_username: str | None
    created_at: datetime


class GroupDetailResponse(BaseModel):
    """Response for ``groups_get`` (FE: ``GroupDetailResponse``)."""

    group: GroupResponse
    members: list[MemberResponse]
    invites: list[InviteDetailResponse]
    is_owner: bool


# ═══════════════════════════════════════════════════════════════════════════
# Invite (full row from groups_invite)
# ═══════════════════════════════════════════════════════════════════════════


class InviteResponse(BaseModel):
    """A full invite row (FE: ``GroupInvite``).

    Returned by ``groups_invite`` (wrapped in ``InviteCreateResponse``).
    ``invited_by_username`` is the inviter's username, not the ORM
    ``invited_by`` integer FK.
    """

    id: str
    group_id: str
    invitee_username: str
    invited_by_username: str | None
    status: str
    created_at: datetime


class InviteCreateResponse(BaseModel):
    """Wrapper for ``groups_invite`` (FE: ``{ invite: GroupInvite }``)."""

    invite: InviteResponse


# ═══════════════════════════════════════════════════════════════════════════
# Pool
# ═══════════════════════════════════════════════════════════════════════════


class PoolItemResponse(BaseModel):
    """A pooled credential item (FE: ``PoolItem``).

    Used in ``groups_pool_list``.  ``masked_secret`` is computed
    server-side; the raw secret never appears in the response.
    """

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    credential_id: str
    label: str | None
    endpoint_name: str
    adapter_type: str
    runtime_status: str
    enabled: bool
    contributor_username: str | None
    masked_secret: str
    can_manage: bool
    can_unshare: bool
    created_at: datetime


class PoolListResponse(BaseModel):
    """Response for ``groups_pool_list`` (FE: ``GroupsPoolListResponse``)."""

    items: list[PoolItemResponse]


# ═══════════════════════════════════════════════════════════════════════════
# Usage
# ═══════════════════════════════════════════════════════════════════════════


class UsageRowResponse(BaseModel):
    """A per-member per-model daily usage row (FE: ``GroupUsageRow``).

    Used in ``groups_usage_list``.  ``day`` is ``'YYYY-MM-DD'`` (UTC).
    ``model`` is the public model id (``''`` for pre-migration rows).
    """

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    user_id: int
    username: str
    model: str = ""
    day: str
    requests: int
    tokens: int


class UsageListResponse(BaseModel):
    """Response for ``groups_usage_list`` (FE: ``GroupsUsageListResponse``).

    ``max_per_member_daily`` is the group-wide per-member daily cap
    (nullable = unlimited).  Included so members can see the fair-use
    limit context alongside their own usage.
    """

    rows: list[UsageRowResponse]
    max_per_member_daily: int | None


# ═══════════════════════════════════════════════════════════════════════════
# Quota rules
# ═══════════════════════════════════════════════════════════════════════════


class QuotaRuleResponse(BaseModel):
    """A group quota rule (FE: ``GroupQuotaRule``).

    ``subject='member'`` caps each matching member (``user_id NULL`` =
    every member); ``subject='pool'`` caps the whole group's combined
    usage.  ``model NULL`` = all models; ``amount NULL`` = unlimited.
    """

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    group_id: str
    subject: str
    user_id: int | None
    model: str | None
    unit: str
    amount: int | None
    period: str
    created_at: datetime
    """Current usage counter for progress display: member+user rule → that
    member; member rule for everyone → max across members; pool rule →
    whole pool.  ``0`` when absent from the response (older backends)."""
    used: int = 0


class QuotaRulesListResponse(BaseModel):
    """Response for ``groups_quota_rules_list``."""

    rules: list[QuotaRuleResponse]


# ═══════════════════════════════════════════════════════════════════════════
# Success (mutation commands)
# ═══════════════════════════════════════════════════════════════════════════


class SuccessResponse(BaseModel):
    """Simple success acknowledgement for mutation commands.

    Used by ``groups_delete``, ``groups_invite_resolve``,
    ``groups_invite_revoke``, ``groups_remove_member``, ``groups_leave``,
    ``groups_share_credential``, ``groups_unshare_credential``,
    ``groups_share_account``, ``groups_unshare_account``.
    """

    success: bool


# ═══════════════════════════════════════════════════════════════════════════
# Group accounts (groups_list_accounts)
# ═══════════════════════════════════════════════════════════════════════════


class GroupAccountItemResponse(BaseModel):
    """An account shared into a group (FE: ``GroupAccountItem``).

    Used in ``groups_list_accounts``.  ``canRemoveShare`` and
    ``canDelete`` reflect the caller's permissions per the
    share/unshare/delete rules.

    Unlike the rest of the groups schemas (which use snake_case field
    names with no aliases), this model uses camelCase aliases because the
    frozen feature contract specifies camelCase wire-format keys for the
    account-list item shape.
    """

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: str
    provider: str
    email: str
    status: str
    quota_used_percent: float = Field(0.0, alias="quotaUsedPercent")
    owner_username: str | None = Field(None, alias="ownerUsername")
    shared_by_username: str | None = Field(None, alias="sharedByUsername")
    can_remove_share: bool = Field(False, alias="canRemoveShare")
    can_delete: bool = Field(False, alias="canDelete")
