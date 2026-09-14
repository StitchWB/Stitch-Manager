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
  /** Public model id; '' for pre-migration rows. */
  model?: string;
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
// Usage accounting + ownership transfer
//
// ``groups_usage_list`` returns per-member per-model daily rows for the
// last 30 days (members see only their own rows; owners see all members'
// rows).  Quota management lives in the quota-rules API below; the legacy
// ``groups_set_quota`` command still exists backend-side (evaluated as the
// lowest-priority member rule) but is intentionally not exposed here.
// ``groups_transfer_ownership`` transfers ownership to an existing member
// (owner only) and returns the updated Group.
// ═══════════════════════════════════════════════════════════════════════════

export async function groupsUsageList(groupId: string): Promise<GroupsUsageListResponse> {
  return safeInvoke('groups_usage_list', { groupId }, { noCache: true });
}

export async function groupsTransferOwnership(params: {
  groupId: string;
  userId: number;
}): Promise<Group> {
  return safeInvoke('groups_transfer_ownership', params, { noCache: true });
}

// ═══════════════════════════════════════════════════════════════════════════
// Quota rules (flexible per-member / per-pool caps)
//
// ``subject``: 'member' caps each matching member (``user_id`` null = every
// member), 'pool' caps the whole group's combined usage. ``model``: null =
// all models, exact id, or 'prefix-*' glob. ``amount``: null = unlimited
// (overrides broader rules). ``period``: 'daily' | 'total'.
// ``groups_quota_rule_set`` is a natural-key upsert on
// (subject, userId, model, unit, period). ``used`` is the current usage
// counter for progress display (member rule → that member or max across
// members; pool rule → whole pool).
// ═══════════════════════════════════════════════════════════════════════════

export type GroupQuotaSubject = 'member' | 'pool';
export type GroupQuotaUnit = 'requests' | 'tokens';
export type GroupQuotaPeriod = 'daily' | 'total';

export interface GroupQuotaRule {
  id: string;
  group_id: string;
  subject: GroupQuotaSubject;
  user_id: number | null;
  model: string | null;
  unit: GroupQuotaUnit;
  amount: number | null;
  period: GroupQuotaPeriod;
  created_at: string;
  used: number;
}

export interface GroupQuotaRulesListResponse {
  rules: GroupQuotaRule[];
}

export async function groupsQuotaRulesList(
  groupId: string,
): Promise<GroupQuotaRulesListResponse> {
  return safeInvoke('groups_quota_rules_list', { groupId }, { noCache: true });
}

export async function groupsQuotaRuleSet(params: {
  groupId: string;
  subject: GroupQuotaSubject;
  userId?: number | null;
  model?: string | null;
  unit: GroupQuotaUnit;
  amount: number | null;
  period: GroupQuotaPeriod;
}): Promise<GroupQuotaRule> {
  return safeInvoke('groups_quota_rule_set', params, { noCache: true });
}

export async function groupsQuotaRuleDelete(params: {
  groupId: string;
  ruleId: string;
}): Promise<{ success: boolean }> {
  return safeInvoke('groups_quota_rule_delete', params, { noCache: true });
}

// ═══════════════════════════════════════════════════════════════════════════
// Account sharing (M:N account ↔ group)
//
// ``groups_share_account`` shares an account into a group (idempotent).
// ``groups_unshare_account`` removes an account from a group (account-owner
// OR group-owner gated). ``groups_list_accounts`` lists the accounts shared
// into a group, with per-row action flags (``canRemoveShare`` /
// ``canDelete``) computed by the backend based on the caller's rights.
// ═══════════════════════════════════════════════════════════════════════════

export interface GroupAccountItem {
  id: number;
  provider: string;
  email: string;
  status: string;
  quotaUsedPercent: number | null;
  ownerUsername: string;
  sharedByUsername: string;
  canRemoveShare: boolean;
  canDelete: boolean;
}

export interface GroupAccountsListResponse {
  items: GroupAccountItem[];
}

export async function shareAccount(
  groupId: string,
  accountId: number,
): Promise<{ success: boolean }> {
  return safeInvoke('groups_share_account', { groupId, accountId }, { noCache: true });
}

export async function unshareAccount(
  groupId: string,
  accountId: number,
): Promise<{ success: boolean }> {
  return safeInvoke('groups_unshare_account', { groupId, accountId }, { noCache: true });
}

export async function listGroupAccounts(groupId: string): Promise<GroupAccountsListResponse> {
  // The command returns a bare list; normalize to the {items} shape the
  // UI expects (tolerates either wire format).
  const res = await safeInvoke<GroupAccountItem[] | GroupAccountsListResponse>(
    'groups_list_accounts',
    { groupId },
    { noCache: true },
  );
  return Array.isArray(res) ? { items: res } : res;
}
