/**
 * Browser Fingerprint Profiles (Spoof Profiles)
 *
 * Backend wrappers around src-Backend/src/commands/profile.rs
 */

import { safeInvoke } from '../core';
import { buildRunnerConfigFromProfileSettings } from '@/lib/scenarioRecorder/configBuilder';
import { getProxyLibraryRuntimeProxyUrl } from './proxyLibrary';
import type { BrowserEngineId } from '@/lib/browser/engines';

const DEFAULT_SETTINGS_WINDOW = {
  mode: 'fit-screen' as const,
  width: null,
  height: null,
  maximizeOnStart: true,
};

export interface BrowserFingerprintProfile {
  userAgent: string;
  platform: string;
  vendor: string;
  screenWidth: number;
  screenHeight: number;
  availWidth: number;
  availHeight: number;
  colorDepth: number;
  pixelRatio: number;
  hardwareConcurrency: number;
  deviceMemory: number;
  maxTouchPoints: number;
  webglVendor: string;
  webglRenderer: string;
  timezone: string;
  timezoneOffset: number;
  locale: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  noiseSeed: number;
  fonts: string[];
}

// ============================================
// Versioned Profile Settings (Launcher)
// ============================================

export interface ProfileSettingsProxy {
  enabled: boolean;
  proxyLibraryId?: string | null;
}

export interface ProfileSettingsNetwork {
  proxy?: ProfileSettingsProxy | null;
}

export interface ProfileSettingsGeo {
  timezone?: string | null;
  locale?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface ProfileSettingsHardware {
  // Identity fields (userAgent/platform/hardwareConcurrency/deviceMemory/
  // screenWidth/screenHeight) intentionally absent: the browser engine owns
  // identity at launch; nothing consumed them.
  browserWindow?: ProfileSettingsBrowserWindow | null;
}

export type ProfileSettingsBrowserWindowMode = 'auto' | 'fit-screen' | 'fixed';

export interface ProfileSettingsBrowserWindow {
  mode?: ProfileSettingsBrowserWindowMode | null;
  width?: number | null;
  height?: number | null;
  maximizeOnStart?: boolean | null;
}

export interface ProfileSettingsStorage {
  cookies?: string | null;
  notes?: string | null;
  lastUrl?: string | null;
  lastScenarioPath?: string | null;
}

export interface ProfileSettingsV1 {
  version: number;
  network: ProfileSettingsNetwork;
  geo: ProfileSettingsGeo;
  hardware: ProfileSettingsHardware;
  storage: ProfileSettingsStorage;
  engine?: BrowserEngineId | null;
}

export interface ProfileSettingsRecord {
  alias: string;
  settings: ProfileSettingsV1;
  cookies?: string | null;
  notes?: string | null;
  updatedAt?: string | null;
}

/**
 * Default launcher settings for a freshly created profile.
 *
 * Profile creation writes this record (the alias registry lives in the
 * profile_settings table); no fake fingerprint JSON is generated — identity
 * is owned by the browser engine at launch.
 */
export function createDefaultProfileSettings(): ProfileSettingsV1 {
  return {
    version: 1,
    network: {},
    geo: {},
    hardware: { browserWindow: { ...DEFAULT_SETTINGS_WINDOW } },
    storage: {},
  };
}

export async function getOrCreateFingerprintProfile(params: {
  email?: string | null;
}): Promise<BrowserFingerprintProfile> {
  return safeInvoke<BrowserFingerprintProfile>('get_or_create_profile_rust', {
    email: params.email ?? null,
  });
}

export async function loadFingerprintProfile(params: {
  email: string;
}): Promise<BrowserFingerprintProfile | null> {
  return safeInvoke<BrowserFingerprintProfile | null>('load_profile_rust', {
    email: params.email,
  });
}

export async function saveFingerprintProfile(params: {
  email: string;
  profile: BrowserFingerprintProfile;
}): Promise<void> {
  return safeInvoke<void>('save_profile_rust', {
    email: params.email,
    profile: params.profile,
  });
}

export async function deleteFingerprintProfile(params: { email: string }): Promise<void> {
  return safeInvoke<void>('delete_profile_rust', {
    email: params.email,
  });
}

export async function listFingerprintProfiles(): Promise<string[]> {
  return safeInvoke<string[]>('list_profiles_rust');
}

export async function renameFingerprintProfileAlias(params: {
  currentAlias: string;
  nextAlias: string;
}): Promise<void> {
  return safeInvoke<void>('rename_profile_alias_rust', {
    current_alias: params.currentAlias,
    next_alias: params.nextAlias,
  });
}

export async function exportFingerprintProfileBundle(params: {
  alias: string;
  destinationPath: string;
}): Promise<void> {
  return safeInvoke<void>('export_profile_bundle_rust', {
    alias: params.alias,
    destination_path: params.destinationPath,
  });
}

export async function importFingerprintProfileBundle(params: {
  sourcePath: string;
  targetAlias?: string | null;
  overwrite?: boolean;
}): Promise<string> {
  return safeInvoke<string>('import_profile_bundle_rust', {
    source_path: params.sourcePath,
    target_alias: params.targetAlias ?? null,
    overwrite: params.overwrite ?? false,
  });
}

export async function openStandaloneFingerprintProfile(params: {
  alias: string;
  provider?: string;
  url?: string;
  configJson?: string;
}): Promise<string> {
  const provider = params.provider ?? 'kiro';
  const args = ['--email', params.alias, '--provider', provider];
  if (params.url && params.url.trim()) {
    args.push('--url', params.url.trim());
  }
  if (params.configJson && params.configJson.trim()) {
    args.push('--config-json', params.configJson.trim());
  }
  try {
    const profileRecord = await getProfileSettings({ alias: params.alias });
    const proxyEnabled = Boolean(profileRecord?.settings?.network?.proxy?.enabled);
    const proxyLibraryId = profileRecord?.settings?.network?.proxy?.proxyLibraryId?.trim();
    if (proxyEnabled && proxyLibraryId) {
      const runtimeProxyUrl = await getProxyLibraryRuntimeProxyUrl(proxyLibraryId);
      const proxyUrl = runtimeProxyUrl?.trim();
      if (proxyUrl) args.push('--proxy', proxyUrl);
    }
  } catch { /* best-effort */ }
  const result = await safeInvoke<string>('run_python_script', { scriptPath: 'python/open_browser.py', args });
  const trimmed = (result ?? '').trim();
  // Detect backend-reported launch failures so callers show error toasts
  // instead of treating a failed launch as success.
  if (trimmed.startsWith('error:')) {
    throw new Error(trimmed);
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Not JSON — the string is the raw result, return as before.
    return result;
  }
  if (parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>).success === false) {
    const err = (parsed as Record<string, unknown>).error;
    throw new Error(typeof err === 'string' && err ? err : 'Browser launch failed');
  }
  return result;
}

export async function openStandaloneFingerprintProfileAndRememberUrl(params: {
  alias: string;
  provider?: string;
  url?: string;
}): Promise<string> {
  let configJson: string | undefined;
  let existingRecord: ProfileSettingsRecord | null = null;
  const provider = (params.provider ?? 'kiro').toLowerCase();
  const providerDefaultUrl: Record<string, string> = {
    kiro: 'https://google.com', windsurf: 'https://codeium.com/profile',
    github: 'https://github.com/settings/profile', trae: 'https://trae.sh/',
  };
  const targetUrl = params.url?.trim() || providerDefaultUrl[provider] || 'https://google.com';
  try {
    existingRecord = await getProfileSettings({ alias: params.alias });
    const built = await buildRunnerConfigFromProfileSettings(existingRecord, { defaultUrl: targetUrl, fallbackUrl: 'https://google.com' });
    configJson = built.configJson;
  } catch { configJson = undefined; }
  const result = await openStandaloneFingerprintProfile({ ...params, configJson });
  if (targetUrl) {
    try {
      const current = existingRecord?.settings ?? { version: 1, network: {}, geo: {}, hardware: { browserWindow: { ...DEFAULT_SETTINGS_WINDOW } }, storage: {} };
      await saveProfileSettings({ alias: params.alias, settings: { ...current, storage: { ...(current.storage ?? {}), lastUrl: targetUrl } } });
    } catch { /* best effort */ }
  }
  return result;
}

export async function getProfileSettings(params: {
  alias: string;
}): Promise<ProfileSettingsRecord | null> {
  return safeInvoke<ProfileSettingsRecord | null>('get_profile_settings_rust', {
    alias: params.alias,
  });
}

export async function saveProfileSettings(params: {
  alias: string;
  settings: ProfileSettingsV1;
}): Promise<void> {
  return safeInvoke<void>('save_profile_settings_rust', {
    alias: params.alias,
    settings: params.settings,
  });
}
