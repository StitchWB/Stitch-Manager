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

export type MarketplaceSource = 'official' | 'community' | 'local';

export type I18nText = {
  ru: string;
  en: string;
};

export type MarketplaceCategory =
  | 'autoreg'
  | 'engine'
  | 'ide-integration'
  | 'ai-tools'
  | 'productivity'
  | 'security'
  | 'communication'
  | 'data';

export type MarketplaceStatus = 'stable' | 'beta' | 'deprecated';

export type MarketplaceFeatureStatus = 'stable' | 'beta' | 'planned';

export interface MarketplaceFeature {
  title: string | I18nText;
  status: MarketplaceFeatureStatus;
}

export interface MarketplaceChangelogEntry {
  version: string;
  date: string;
  changes: Array<string | I18nText>;
}

export interface MarketplaceItem {
  id: string;
  name: string;
  description: string | null;
  author: string | null;
  version: string | null;
  source: MarketplaceSource;
  entitled: boolean;
  installed: boolean;
  installed_version: string | null;
  can_download: boolean;
  required_tier?: string;
  /**
   * Badge chips: 'recommended' | 'verified' | 'works' | 'not_works'.
   * 'verified' is computed server-side from the offline attestation.
   * Optional for older backends that predate the badges field.
   */
  badges?: string[];
  /**
   * Rich manifest metadata. Optional for older backends / feed items that
   * predate the manifest fields — the UI falls back to the plain fields.
   */
  description_i18n?: I18nText | null;
  category?: MarketplaceCategory | null;
  status?: MarketplaceStatus | null;
  /** Single emoji from the plugin manifest. */
  icon?: string | null;
  features?: MarketplaceFeature[] | null;
  changelog?: MarketplaceChangelogEntry[] | null;
  homepage?: string | null;
  repository?: string | null;
}

export interface MarketplaceFeeds {
  official?: 'ok' | 'error' | 'skipped';
  community?: 'ok' | 'error';
}

export interface GetMarketplaceResponse {
  activated: boolean;
  items: MarketplaceItem[];
  /**
   * Per-feed health, so the UI can tell "catalog genuinely empty" apart from
   * "upstream unreachable". Optional for older backends.
   */
  feeds?: MarketplaceFeeds;
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
