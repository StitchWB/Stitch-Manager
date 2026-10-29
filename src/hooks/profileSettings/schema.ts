import { detailToMessage } from '@/lib/errorText';
import type {
  ProfileSettingsBrowserWindowMode,
  ProfileSettingsV1,
} from '@/lib/backend/modules/profiles';

export type SettingsTab = 'main' | 'proxy' | 'geo' | 'data';

export const defaultSettings: ProfileSettingsV1 = {
  version: 1,
  network: {
    proxy: {
      enabled: false,
      proxyLibraryId: null,
    },
  },
  geo: {
    timezone: null,
    locale: null,
    latitude: null,
    longitude: null,
  },
  hardware: {
    browserWindow: {
      mode: 'fit-screen',
      width: null,
      height: null,
      maximizeOnStart: true,
    },
  },
  storage: {
    cookies: null,
    notes: null,
    lastUrl: null,
    lastScenarioPath: null,
  },
};

export function mergeSettings(record: ProfileSettingsV1): ProfileSettingsV1 {
  const proxy = {
    enabled: Boolean(record.network?.proxy?.enabled),
    proxyLibraryId: record.network?.proxy?.proxyLibraryId ?? null,
  };

  return {
    ...defaultSettings,
    ...record,
    network: {
      ...defaultSettings.network,
      ...(record.network ?? {}),
      proxy,
    },
    geo: {
      ...defaultSettings.geo,
      ...(record.geo ?? {}),
    },
    hardware: {
      ...defaultSettings.hardware,
      ...(record.hardware ?? {}),
      browserWindow: {
        ...(defaultSettings.hardware.browserWindow ?? {}),
        ...((record.hardware?.browserWindow as Record<string, unknown> | undefined) ?? {}),
      },
    },
    storage: {
      ...defaultSettings.storage,
      ...(record.storage ?? {}),
    },
  };
}

export const windowModeOptions: Array<{ value: ProfileSettingsBrowserWindowMode; label: string }> = [
  { value: 'fit-screen', label: 'Fit screen (recommended)' },
  { value: 'fixed', label: 'Fixed size' },
  { value: 'auto', label: 'Auto fallback' },
];

export const windowPresetOptions: Array<{ value: string; label: string; width: number; height: number }> = [
  { value: '1366x768', label: '1366 × 768 (HD)', width: 1366, height: 768 },
  { value: '1600x900', label: '1600 × 900 (HD+)', width: 1600, height: 900 },
  { value: '1920x1080', label: '1920 × 1080 (Full HD)', width: 1920, height: 1080 },
  { value: '2560x1440', label: '2560 × 1440 (QHD)', width: 2560, height: 1440 },
];

export function parsePositiveIntOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : null;
}

export function cloneSettings(record: ProfileSettingsV1): ProfileSettingsV1 {
  return mergeSettings(structuredClone(record));
}

export function buildUniqueDuplicateAlias(baseAlias: string, existingAliases: string[]): string {
  const normalized = baseAlias.trim();
  const fallback = normalized.length > 0 ? normalized : 'profile';
  const existing = new Set(existingAliases.map(alias => alias.toLowerCase()));

  const candidate = `${fallback}.copy`;
  if (!existing.has(candidate.toLowerCase())) {
    return candidate;
  }

  let index = 2;
  while (existing.has(`${fallback}.copy.${index}`.toLowerCase())) {
    index += 1;
  }
  return `${fallback}.copy.${index}`;
}

export type AliasValidationKey =
  | 'accounts.profileSettingsAliasRequired'
  | 'accounts.profileSettingsAliasTooLong'
  | 'accounts.profileSettingsAliasInvalidChars'
  | 'accounts.profileSettingsAliasInvalidNewlines'
  | 'accounts.profileSettingsAliasConflict';

export function getAliasValidationKey(
  value: string,
  existingAliases: string[],
  currentAlias: string
): AliasValidationKey | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'accounts.profileSettingsAliasRequired';
  }
  if (trimmed.length > 160) {
    return 'accounts.profileSettingsAliasTooLong';
  }
  if (/\r|\n/.test(value)) {
    return 'accounts.profileSettingsAliasInvalidNewlines';
  }
  if (/[<>:"/\\|?*]/.test(trimmed)) {
    return 'accounts.profileSettingsAliasInvalidChars';
  }

  const normalizedCurrent = currentAlias.trim().toLowerCase();
  const normalizedAlias = trimmed.toLowerCase();
  if (normalizedAlias !== normalizedCurrent) {
    const conflict = existingAliases.some(
      existing => existing.trim().toLowerCase() === normalizedAlias
    );
    if (conflict) {
      return 'accounts.profileSettingsAliasConflict';
    }
  }

  return null;
}

export function sanitizeAlias(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  let value = trimmed.replace(/\r|\n/g, ' ').replace(/\s+/g, ' ');
  value = value.replace(/[<>:"/\\|?*]/g, '_');
  value = value.replace(/\s+/g, '.');
  value = value.replace(/\.{2,}/g, '.').replace(/^\.+|\.+$/g, '');

  if (value.length > 160) {
    value = value.slice(0, 160).replace(/^\.+|\.+$/g, '');
  }

  return value;
}

export function makeUniqueAlias(params: {
  baseAlias: string;
  existingAliases: string[];
  currentAlias: string;
}): string {
  const base = params.baseAlias.trim();
  const current = params.currentAlias.trim().toLowerCase();
  const normalizedExisting = new Set(
    params.existingAliases.map(a => a.trim().toLowerCase()).filter(Boolean)
  );

  const isConflict = (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return true;
    if (normalized === current) return false;
    return normalizedExisting.has(normalized);
  };

  if (!isConflict(base)) return base;

  let idx = 2;
  while (idx < 1000) {
    const suffix = `.${idx}`;
    const maxBase = Math.max(1, 160 - suffix.length);
    const candidateBase = base.slice(0, maxBase).replace(/^\.+|\.+$/g, '');
    const candidate = `${candidateBase}${suffix}`;
    if (!isConflict(candidate)) return candidate;
    idx += 1;
  }

  return base;
}

export function extractActionErrorMessage(error: unknown, fallback: string): string {
  const raw = (
    error instanceof Error && error.message ? error.message : detailToMessage(error, '')
  ).trim();
  if (!raw) {
    return fallback;
  }

  const separatorIdx = raw.indexOf('|');
  if (separatorIdx > 0) {
    const maybeCode = raw.slice(0, separatorIdx).trim();
    const maybeMessage = raw.slice(separatorIdx + 1).trim();
    if (/^[a-z0-9_-]+$/i.test(maybeCode)) {
      return maybeMessage || fallback;
    }
  }

  return raw;
}
