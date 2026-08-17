/**
 * Marketplace Module
 *
 * VSCode-Extensions-style plugin marketplace: unified list of official and
 * community plugins with role-based entitlement gating. The backend returns
 * a single feed (`get_marketplace`) that already filters by the caller's
 * role — `can_download` and `entitled` reflect what the current user may
 * do. Install/uninstall are thin wrappers over the same backend commands.
 */

import { safeInvoke } from '../core';

// ============================================
// Types
// ============================================

export type MarketplaceSource = 'official' | 'community';

export interface MarketplaceItem {
  id: string;
  name: string;
  description: string | null;
  version: string | null;
  source: MarketplaceSource;
  entitled: boolean;
  installed: boolean;
  installed_version: string | null;
  can_download: boolean;
}

export interface GetMarketplaceResponse {
  activated: boolean;
  items: MarketplaceItem[];
}

export interface InstallMarketplacePluginParams {
  id: string;
  source: MarketplaceSource;
}

export interface InstallMarketplacePluginResult {
  success: boolean;
  error: string | null;
}

export interface UninstallMarketplacePluginParams {
  id: string;
  source: MarketplaceSource;
}

export interface UninstallMarketplacePluginResult {
  success: boolean;
  error: string | null;
}

// ============================================
// Commands
// ============================================

/**
 * Fetch the full marketplace feed for the current user. The backend applies
 * role-based filtering: `can_download` and `entitled` reflect entitlements.
 * When `activated` is false, the official list is empty — community plugins
 * are still returned.
 */
export async function getMarketplace(): Promise<GetMarketplaceResponse> {
  return safeInvoke<GetMarketplaceResponse>('get_marketplace');
}

/**
 * Install a marketplace plugin by id + source. The backend validates
 * entitlement (`can_download`) before attempting the install.
 */
export async function installMarketplacePlugin(
  params: InstallMarketplacePluginParams,
): Promise<InstallMarketplacePluginResult> {
  return safeInvoke<InstallMarketplacePluginResult>('install_marketplace_plugin', {
    id: params.id,
    source: params.source,
  });
}

/**
 * Uninstall a previously installed marketplace plugin.
 */
export async function uninstallMarketplacePlugin(
  params: UninstallMarketplacePluginParams,
): Promise<UninstallMarketplacePluginResult> {
  return safeInvoke<UninstallMarketplacePluginResult>('uninstall_marketplace_plugin', {
    id: params.id,
    source: params.source,
  });
}
