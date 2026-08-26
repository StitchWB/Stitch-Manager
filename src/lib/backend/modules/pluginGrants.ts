/**
 * Plugin Grants Module
 *
 * Role-based plugin entitlement management. Admins grant plugins to roles
 * (the default entitlement ladder) and override per-user (grant or revoke
 * a specific plugin for a specific user). The backend enforces admin-only
 * access on all commands except get_marketplace (which gains required_tier).
 *
 * Follows the marketplace.ts pattern: safeInvoke wrappers with typed
 * responses, noCache on all calls (grant state is volatile).
 */

import { safeInvoke } from '../core';
import type { AuthUser } from './auth';

// ============================================
// Types
// ============================================

/** Role ladder excluding admin — admin is always all-granted, read-only. */
export const GRANTABLE_ROLES: AuthUser['role'][] = ['user', 'vip', 'premium', 'elite'];

/** All roles in ladder order, admin last (locked/read-only in the matrix). */
export const ROLE_LADDER: AuthUser['role'][] = ['user', 'vip', 'premium', 'elite', 'admin'];

export interface PluginSummary {
  id: string;
  name: string;
  version: string;
}

export interface PluginGrantsRoleListResponse {
  roles: Record<string, string[]>;
  plugins: PluginSummary[];
}

export interface PluginGrantsRoleSetParams {
  role: string;
  pluginId: string;
  granted: boolean;
}

export interface PluginGrantsRoleSetResult {
  success: boolean;
}

export interface PluginGrantsGroupListResponse {
  groups: Record<string, string[]>;
  groupNames: Record<string, string>;
  plugins: PluginSummary[];
}

export interface PluginGrantsGroupSetParams {
  groupId: string;
  pluginId: string;
  granted: boolean;
}

export interface PluginGrantsGroupSetResult {
  success: boolean;
}

export interface UserPluginGrant {
  pluginId: string;
  granted: boolean;
}

export interface PluginGrantsUserGetResponse {
  grants: UserPluginGrant[];
  effective: string[];
}

export interface PluginGrantsUserSetParams {
  userId: number;
  pluginId: string;
  granted: boolean;
}

export interface PluginGrantsUserSetResult {
  success: boolean;
}

export interface PluginGrantsUserDeleteParams {
  userId: number;
  pluginId: string;
}

export interface PluginGrantsUserDeleteResult {
  success: boolean;
}

export interface PluginGrantAuditEntry {
  ts: string;
  adminUserId: number;
  action: string;
  scope: string;
  target: string;
  pluginId: string;
  granted: boolean;
}

export interface PluginGrantsAuditListResponse {
  entries: PluginGrantAuditEntry[];
}

// ============================================
// Commands
// ============================================

/**
 * Fetch the full role→plugins grant map and the list of known plugins.
 * Admin-only. The `roles` map keys are role names; values are arrays of
 * plugin IDs granted to that role. The `plugins` array lists every
 * official plugin the admin can grant.
 */
export async function pluginGrantsRoleList(): Promise<PluginGrantsRoleListResponse> {
  return safeInvoke<PluginGrantsRoleListResponse>('plugin_grants_role_list', {}, { noCache: true });
}

/**
 * Grant or revoke a plugin for a role. Admin-only.
 * The admin role is immutable server-side; attempts to mutate it return 400.
 */
export async function pluginGrantsRoleSet(params: PluginGrantsRoleSetParams): Promise<PluginGrantsRoleSetResult> {
  return safeInvoke<PluginGrantsRoleSetResult>('plugin_grants_role_set', {
    role: params.role,
    pluginId: params.pluginId,
    granted: params.granted,
  }, { noCache: true });
}

/**
 * Fetch the full group→plugins grant map, all group names and the list of
 * known plugins. Admin-only. The `groups` map keys are group IDs; values
 * are arrays of plugin IDs granted to that group. `groupNames` contains
 * every group (even ones with zero grants). The `plugins` array lists
 * every official plugin the admin can grant.
 */
export async function pluginGrantsGroupList(): Promise<PluginGrantsGroupListResponse> {
  return safeInvoke<PluginGrantsGroupListResponse>('plugin_grants_group_list', {}, { noCache: true });
}

/**
 * Grant or revoke a plugin for a group. Admin-only.
 * Every member of the group may download the granted plugins.
 */
export async function pluginGrantsGroupSet(params: PluginGrantsGroupSetParams): Promise<PluginGrantsGroupSetResult> {
  return safeInvoke<PluginGrantsGroupSetResult>('plugin_grants_group_set', {
    groupId: params.groupId,
    pluginId: params.pluginId,
    granted: params.granted,
  }, { noCache: true });
}

/**
 * Fetch per-user plugin grants and the effective plugin list for a user.
 * Admin-only. `grants` contains explicit overrides (grant or revoke);
 * `effective` is the final list of plugin IDs the user has access to
 * (role grants + overrides).
 */
export async function pluginGrantsUserGet(userId: number): Promise<PluginGrantsUserGetResponse> {
  return safeInvoke<PluginGrantsUserGetResponse>('plugin_grants_user_get', { userId }, { noCache: true });
}

/**
 * Set a per-user plugin grant (override). Admin-only.
 * When `granted` is true, the user gets the plugin even if their role
 * doesn't grant it. When false, the plugin is explicitly revoked even
 * if the role grants it.
 */
export async function pluginGrantsUserSet(params: PluginGrantsUserSetParams): Promise<PluginGrantsUserSetResult> {
  return safeInvoke<PluginGrantsUserSetResult>('plugin_grants_user_set', {
    userId: params.userId,
    pluginId: params.pluginId,
    granted: params.granted,
  }, { noCache: true });
}

/**
 * Delete a per-user plugin override. Admin-only.
 * The user falls back to their role's default grants.
 */
export async function pluginGrantsUserDelete(params: PluginGrantsUserDeleteParams): Promise<PluginGrantsUserDeleteResult> {
  return safeInvoke<PluginGrantsUserDeleteResult>('plugin_grants_user_delete', {
    userId: params.userId,
    pluginId: params.pluginId,
  }, { noCache: true });
}

/**
 * Fetch the audit log of plugin grant changes. Admin-only.
 * @param limit Optional maximum number of entries to return.
 */
export async function pluginGrantsAuditList(limit?: number): Promise<PluginGrantsAuditListResponse> {
  return safeInvoke<PluginGrantsAuditListResponse>('plugin_grants_audit_list', limit ? { limit } : {}, { noCache: true });
}
