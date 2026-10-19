/**
 * Group Plugins Module
 *
 * Delegated group-plugin management: a group's owner/admin lists the
 * group's plugin grants merged with the marketplace manifest
 * (``group_plugin_list``) and grants/revokes individual plugins
 * (``group_plugin_toggle``). The backend gates the grant direction by
 * plugin audience, group level and the ``groups.max_gated_plugins`` cap;
 * revocation is ungated.
 *
 * Both commands answer refusals as an HTTP 200 body with
 * ``{success: false, error}``, so the wrappers inspect ``success`` and
 * throw — callers get a single reject path for transport and policy
 * errors alike.
 *
 * Follows the pluginGrants.ts pattern: safeInvoke wrappers with typed
 * responses, noCache on all calls (grant state is volatile).
 */

import { safeInvoke } from '../core';

/** Plugin audience from the marketplace manifest. */
export type GroupPluginAudience = 'public' | 'group' | 'tier' | 'private';

/** Group level; ``group``-audience grants require ``verified``. */
export type GroupLevel = 'open' | 'verified' | 'suspended';

export interface GroupPluginEntry {
  id: string;
  name: string;
  version: string;
  audience: GroupPluginAudience;
  granted: boolean;
}

export interface GroupPluginListResponse {
  level: GroupLevel;
  maxGatedPlugins: number;
  plugins: GroupPluginEntry[];
}

export interface GroupPluginToggleParams {
  groupId: string;
  pluginId: string;
  granted: boolean;
}

export interface GroupPluginToggleResult {
  success: boolean;
}

interface CommandFailure {
  success?: boolean;
  error?: string;
}

function assertNotRefused(res: CommandFailure): void {
  if (res.success === false) {
    throw new Error(res.error ?? 'Command refused');
  }
}

/**
 * List the group's plugins with their audience and granted state.
 * Group owner/admin only — other callers get a thrown refusal error.
 */
export async function groupPluginList(groupId: string): Promise<GroupPluginListResponse> {
  const res = await safeInvoke<GroupPluginListResponse & CommandFailure>(
    'group_plugin_list',
    { groupId },
    { noCache: true },
  );
  assertNotRefused(res);
  return {
    level: res.level,
    maxGatedPlugins: res.maxGatedPlugins,
    plugins: res.plugins ?? [],
  };
}

/**
 * Grant or revoke a plugin for the group (owner/admin only). Grants are
 * gated server-side by audience/level/cap; revocation always succeeds.
 */
export async function groupPluginToggle(
  params: GroupPluginToggleParams,
): Promise<GroupPluginToggleResult> {
  const res = await safeInvoke<GroupPluginToggleResult & CommandFailure>(
    'group_plugin_toggle',
    {
      groupId: params.groupId,
      pluginId: params.pluginId,
      granted: params.granted,
    },
    { noCache: true },
  );
  assertNotRefused(res);
  return { success: true };
}
