/**
 * Community Plugins Module
 *
 * Community-contributed plugin packages: catalog browsing, install/uninstall,
 * and author "submit for review" flow (opens a GitHub PR).
 *
 * Consent for the community feature surface is stored as a setting
 * (key `community_enabled`, value "true"/"false") via the existing settings
 * module — same pattern as `telemetry_consent`.
 */

import { safeInvoke } from '../core';

// ============================================
// Types
// ============================================

export interface CommunityCatalogPlugin {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  path: string;
  services: string[];
  sha256: string;
}

export interface GetCommunityCatalogResponse {
  plugins: CommunityCatalogPlugin[];
}

export interface InstallCommunityPluginParams {
  id: string;
  version: string;
}

export interface InstallCommunityPluginResult {
  success: boolean;
  error?: string;
}

export interface UninstallCommunityPluginParams {
  id: string;
  version?: string;
}

export interface UninstallCommunityPluginResult {
  success: boolean;
  error?: string;
}

export interface InstalledCommunityPackage {
  id: string;
  version: string;
  services: string[];
  name: string;
}

export interface ListInstalledCommunityResponse {
  packages: InstalledCommunityPackage[];
}

export interface LocalPackage {
  id: string;
  name: string;
  version: string;
  services: string[];
  path: string;
}

export interface ListLocalPackagesResponse {
  packages: LocalPackage[];
}

export interface SubmitForReviewParams {
  package_id: string;
  github_token: string;
}

export interface SubmitForReviewResult {
  success: boolean;
  pr_url?: string;
  error?: string;
}

// ============================================
// Commands
// ============================================

/**
 * Browse the community plugin catalog (curated list available for install).
 */
export async function getCommunityCatalog(): Promise<GetCommunityCatalogResponse> {
  return safeInvoke<GetCommunityCatalogResponse>('get_community_catalog');
}

/**
 * Install a community plugin by id + version.
 */
export async function installCommunityPlugin(
  params: InstallCommunityPluginParams,
): Promise<InstallCommunityPluginResult> {
  return safeInvoke<InstallCommunityPluginResult>('install_community_plugin', {
    id: params.id,
    version: params.version,
  });
}

/**
 * Uninstall a previously installed community plugin.
 * `version` is optional — when omitted, uninstalls the installed version.
 */
export async function uninstallCommunityPlugin(
  params: UninstallCommunityPluginParams,
): Promise<UninstallCommunityPluginResult> {
  const args: Record<string, unknown> = { id: params.id };
  if (params.version !== undefined) {
    args.version = params.version;
  }
  return safeInvoke<UninstallCommunityPluginResult>('uninstall_community_plugin', args);
}

/**
 * List community plugins currently installed locally.
 */
export async function listInstalledCommunity(): Promise<ListInstalledCommunityResponse> {
  return safeInvoke<ListInstalledCommunityResponse>('list_installed_community');
}

/**
 * List the author's own plugins-local dev packages (for the author cabinet).
 */
export async function listLocalPackages(): Promise<ListLocalPackagesResponse> {
  return safeInvoke<ListLocalPackagesResponse>('list_local_packages');
}

// ============================================
// Manual install (ADR-006, channels B1/B2)
// ============================================

export interface InstallLocalPluginParams {
  /** Absolute path to a package directory or a .zip file. */
  path: string;
}

export interface InstallLocalPluginResult {
  success: boolean;
  error?: string;
  id?: string;
  version?: string;
  /** 'official' — signed into the cache; 'local' — unsigned into plugins-local. */
  trust?: 'official' | 'local';
  path?: string;
}

/**
 * Install a plugin package from a local path or zip. Signed packages verify
 * into the versioned cache; unsigned ones require dev mode and are copied to
 * plugins-local.
 */
export async function installLocalPlugin(
  params: InstallLocalPluginParams,
): Promise<InstallLocalPluginResult> {
  return safeInvoke<InstallLocalPluginResult>('install_local_plugin', {
    path: params.path,
  });
}

/** Remove a package from plugins-local (manual/dev installs). */
export async function uninstallLocalPlugin(params: {
  id: string;
}): Promise<{ success: boolean; error?: string }> {
  return safeInvoke('uninstall_local_plugin', { id: params.id });
}

/**
 * Submit a local package for review — opens a GitHub PR.
 * The `github_token` is used only for this request and is not persisted
 * by the backend.
 */
export async function submitForReview(
  params: SubmitForReviewParams,
): Promise<SubmitForReviewResult> {
  return safeInvoke<SubmitForReviewResult>('submit_for_review', {
    package_id: params.package_id,
    github_token: params.github_token,
  });
}
