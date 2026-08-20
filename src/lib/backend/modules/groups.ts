import { safeInvoke } from '../core/invoke';

// ═══════════════════════════════════════════════════════════════════════════
// Types
//
// Response interfaces use camelCase to match the wire format produced by the
// backend's ``model_dump(by_alias=True)`` serialisation. Request param types
// use camelCase aliases too — the backend's ``populate_by_name=True`` accepts
// both, so camelCase (the alias) is the canonical form.
// ═══════════════════════════════════════════════════════════════════════════

export type GroupRole = 'owner' | 'member';

export interface GroupSummary {
  id: string;
  name: string;
  role: GroupRole;
  member_count: number;
  key_count: number;
  created_at: string;
}

export interface GroupInviteSummary {
  id: string;
  group_id: string;
  group_name: string;
  invited_by_username: string;
  created_at: string;
}

export interface GroupsListResponse {
  groups: GroupSummary[];
  invites: GroupInviteSummary[];
}

export interface Group {
  id: string;
  name: string;
  owner_id: number;
  /** Per-member daily request cap (null=unlimited). Optional because the
   *  backend's ``_group_to_dict`` may omit it in older responses. */
  max_requests_per_member_daily?: number | null;
  created_at: string;
}

export interface GroupMember {
  user_id: number;
  username: string;
  role: GroupRole;
  joined_at: string;
}

export interface GroupInviteDetail {
  id: string;
  invitee_username: string;
  invited_by_username: string;
  created_at: string;
}

export interface GroupDetailResponse {
  group: Group;
  members: GroupMember[];
  invites: GroupInviteDetail[];
  is_owner: boolean;
}

export interface GroupInvite {
  id: string;
  group_id: string;
  invitee_username: string;
  invited_by_username: string;
  status: string;
  created_at: string;
}

export interface PoolItem {
  credential_id: string;
  label: string | null;
  endpoint_name: string;
  adapter_type: string;
  runtime_status: string;
  enabled: boolean;
  contributor_username: string;
  masked_secret: string;
  can_manage: boolean;
  can_unshare: boolean;
  created_at: string;
}

export interface GroupsPoolListResponse {
  items: PoolItem[];
}

export interface GroupUsageRow {
  user_id: number;
  username: string;
  day: string;
  requests: number;
  tokens: number;
}

export interface GroupsUsageListResponse {
  rows: GroupUsageRow[];
  /** Group-wide per-member daily cap (null=unlimited). */
  max_per_member_daily: number | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// Groups API
// ═══════════════════════════════════════════════════════════════════════════

export async function groupsCreate(params: { name: string }): Promise<Group> {
  const res = await safeInvoke<{ group: Group }>('groups_create', params, { noCache: true });
  return res.group;
}

export async function groupsList(): Promise<GroupsListResponse> {
  return safeInvoke('groups_list', {}, { noCache: true });
}

export async function groupsGet(params: { groupId: string }): Promise<GroupDetailResponse> {
  return safeInvoke('groups_get', params, { noCache: true });
}

export async function groupsInvite(params: {
  groupId: string;
  username: string;
}): Promise<GroupInvite> {
  const res = await safeInvoke<{ invite: GroupInvite }>('groups_invite', params, { noCache: true });
  return res.invite;
}

export async function groupsInviteResolve(params: {
  inviteId: string;
  accept: boolean;
}): Promise<{ success: boolean }> {
  return safeInvoke('groups_invite_resolve', params, { noCache: true });
}

export async function groupsInviteRevoke(inviteId: string): Promise<{ success: boolean }> {
  return safeInvoke('groups_invite_revoke', { inviteId }, { noCache: true });
}

export async function groupsRemoveMember(params: {
  groupId: string;
  userId: number;
}): Promise<{ success: boolean }> {
  return safeInvoke('groups_remove_member', params, { noCache: true });
}

export async function groupsLeave(groupId: string): Promise<{ success: boolean }> {
  return safeInvoke('groups_leave', { groupId }, { noCache: true });
}

export async function groupsUpdate(params: { groupId: string; name: string }): Promise<Group> {
  return safeInvoke('groups_update', params, { noCache: true });
}

export async function groupsDelete(groupId: string): Promise<{ success: boolean }> {
  return safeInvoke('groups_delete', { groupId }, { noCache: true });
}

export async function groupsPoolList(groupId: string): Promise<GroupsPoolListResponse> {
  return safeInvoke('groups_pool_list', { groupId }, { noCache: true });
}

// ═══════════════════════════════════════════════════════════════════════════
// Credential sharing (M:N credential ↔ group)
//
// Both commands take camelCase params (``credentialId`` / ``groupId``) and
// return ``{ success: true }``. ``groups_share_credential`` is idempotent;
// ``groups_unshare_credential`` is credential-owner OR group-owner gated.
// ═══════════════════════════════════════════════════════════════════════════

export async function groupsShareCredential(params: {
  credentialId: string;
  groupId: string;
}): Promise<{ success: boolean }> {
  return safeInvoke('groups_share_credential', params, { noCache: true });
}

export async function groupsUnshareCredential(params: {
  credentialId: string;
  groupId: string;
}): Promise<{ success: boolean }> {
  return safeInvoke('groups_unshare_credential', params, { noCache: true });
}

// ═══════════════════════════════════════════════════════════════════════════
// Usage accounting + quota + ownership transfer
//
// ``groups_usage_list`` returns per-member daily rows for the last 30 days
// (members see only their own rows; owners see all members' rows) plus
// the group-wide ``max_per_member_daily`` cap (null=unlimited).
// ``groups_set_quota`` sets the per-member daily request cap (owner only;
// null=unlimited) and returns the updated Group.
// ``groups_transfer_ownership`` transfers ownership to an existing member
// (owner only) and returns the updated Group.
// ═══════════════════════════════════════════════════════════════════════════

export async function groupsUsageList(groupId: string): Promise<GroupsUsageListResponse> {
  return safeInvoke('groups_usage_list', { groupId }, { noCache: true });
}

export async function groupsSetQuota(params: {
  groupId: string;
  maxPerMemberDaily: number | null;
}): Promise<Group> {
  return safeInvoke('groups_set_quota', params, { noCache: true });
}

export async function groupsTransferOwnership(params: {
  groupId: string;
  userId: number;
}): Promise<Group> {
  return safeInvoke('groups_transfer_ownership', params, { noCache: true });
}
