import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openFileDialog, saveFileDialog } from '@/lib/fileDialog';
import { toast } from 'sonner';

import { useUIState } from './useUIState';
import { t } from '@/lib/i18n';
import {
  deleteFingerprintProfile,
  exportFingerprintProfileBundle,
  getProfileSettings,
  importFingerprintProfileBundle,
  listFingerprintProfiles,
  loadFingerprintProfile,
  renameFingerprintProfileAlias,
  saveFingerprintProfile,
  type ProfileSettingsBrowserWindowMode,
  type ProfileSettingsProxy,
  saveProfileSettings,
  type ProfileSettingsV1,
  type BrowserFingerprintProfile,
} from '@/lib/backend/modules/profiles';
import { copyToClipboard, openInFileManager } from '@/lib/backend/modules/utils';
import {
  listProxyLibrary,
  createOrGetProxyLibraryEntry,
  parseProxyLibraryInput,
  testProxyLibraryDraft,
  ensureProxySaveUseAllowed,
  ProxyLibraryError,
  type ProxyLibraryDraft,
  type ProxyLibraryEntry,
} from '@/lib/backend/modules/proxyLibrary';

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
    userAgent: null,
    platform: null,
    hardwareConcurrency: null,
    deviceMemory: null,
    screenWidth: null,
    screenHeight: null,
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

type AliasValidationKey =
  | 'accounts.profileSettingsAliasRequired'
  | 'accounts.profileSettingsAliasTooLong'
  | 'accounts.profileSettingsAliasInvalidChars'
  | 'accounts.profileSettingsAliasInvalidNewlines'
  | 'accounts.profileSettingsAliasConflict';

function getAliasValidationKey(
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
  const raw = error instanceof Error ? error.message : String(error ?? '').trim();
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

export interface UseProfileSettingsModalParams {
  alias: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function useProfileSettingsModal({ alias, isOpen, onClose, onSaved }: UseProfileSettingsModalParams) {
  const [draft, setDraft] = useState<ProfileSettingsV1>(defaultSettings);
  const [aliasDraft, setAliasDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exportingBundle, setExportingBundle] = useState(false);
  const [importingBundle, setImportingBundle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [resetAllConfirmOpen, setResetAllConfirmOpen] = useState(false);
  const [importConfigOpen, setImportConfigOpen] = useState(false);
  const [importSourcePath, setImportSourcePath] = useState<string | null>(null);
  const [importTargetMode, setImportTargetMode] = useState<'current' | 'new'>('current');
  const [importTargetAliasDraft, setImportTargetAliasDraft] = useState('');
  const [importOverwrite, setImportOverwrite] = useState(true);
  const [existingAliases, setExistingAliases] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeTab, setActiveTab] = useUIState<SettingsTab>('profile-settings-active-tab', 'main', 'session');
  const [showCookieEditor, setShowCookieEditor] = useState(false);
  const [proxyLibrary, setProxyLibrary] = useState<ProxyLibraryEntry[]>([]);
  const [proxyLibraryLoading, setProxyLibraryLoading] = useState(false);
  const [addProxyModalOpen, setAddProxyModalOpen] = useState(false);
  const [addProxyInput, setAddProxyInput] = useState('');
  const [addProxyDraft, setAddProxyDraft] = useState<ProxyLibraryDraft | null>(null);
  const [addProxyParsing, setAddProxyParsing] = useState(false);
  const [addProxyTesting, setAddProxyTesting] = useState(false);
  const [addProxySaving, setAddProxySaving] = useState(false);
  const [addProxyError, setAddProxyError] = useState<string | null>(null);
  const [addProxyTestResult, setAddProxyTestResult] = useState<string | null>(null);
  const [addProxyParsed, setAddProxyParsed] = useState(false);
  const [addProxyLastTestOk, setAddProxyLastTestOk] = useState(false);
  const [requireProxyTestBeforeSave, setRequireProxyTestBeforeSave] = useState(true);
  const [selectedProxyTesting, setSelectedProxyTesting] = useState(false);
  const [selectedProxyTestResult, setSelectedProxyTestResult] = useState<string | null>(null);
  const [selectedProxyTestError, setSelectedProxyTestError] = useState<string | null>(null);
  const initialDraftRef = useRef<ProfileSettingsV1>(defaultSettings);
  const initialAliasRef = useRef('');

  const proxyEnabled = Boolean(draft.network.proxy?.enabled);
  const proxyLibraryId = draft.network.proxy?.proxyLibraryId?.trim() || '';
  const proxyMode: 'none' | 'library' = !proxyEnabled ? 'none' : 'library';
  const selectedLibraryProxy = proxyLibrary.find(item => item.id === proxyLibraryId) ?? null;
  const hasManualGeo =
    typeof draft.geo.latitude === 'number' && typeof draft.geo.longitude === 'number';
  const localeManual = Boolean(draft.geo.locale?.trim());
  const timezoneManual = Boolean(draft.geo.timezone?.trim());
  const browserWindow = draft.hardware.browserWindow ?? defaultSettings.hardware.browserWindow;
  const browserWindowMode: ProfileSettingsBrowserWindowMode =
    browserWindow?.mode === 'fixed' || browserWindow?.mode === 'auto'
      ? browserWindow.mode
      : 'fit-screen';
  const browserWindowWidth =
    typeof browserWindow?.width === 'number' && Number.isFinite(browserWindow.width)
      ? browserWindow.width
      : null;
  const browserWindowHeight =
    typeof browserWindow?.height === 'number' && Number.isFinite(browserWindow.height)
      ? browserWindow.height
      : null;
  const browserWindowMaximize = Boolean(browserWindow?.maximizeOnStart);
  const currentAlias = alias?.trim() ?? '';
  const aliasValidationKey = useMemo(
    () => getAliasValidationKey(aliasDraft, existingAliases, currentAlias),
    [aliasDraft, currentAlias, existingAliases]
  );
  const aliasValidationError = aliasValidationKey
    ? t(aliasValidationKey) || 'Profile alias is invalid'
    : null;
  const importNewAliasValidationKey = useMemo(
    () =>
      importTargetMode === 'new'
        ? getAliasValidationKey(importTargetAliasDraft, existingAliases, '')
        : null,
    [existingAliases, importTargetAliasDraft, importTargetMode]
  );
  const importNewAliasError = importNewAliasValidationKey
    ? t(importNewAliasValidationKey) || 'Profile alias is invalid'
    : null;

  const refreshAliases = useCallback(async () => {
    try {
      const aliases = await listFingerprintProfiles();
      setExistingAliases(aliases);
    } catch {
      setExistingAliases([]);
    }
  }, []);

  const summary = useMemo(() => {
    const proxyState = proxyEnabled ? 'Enabled' : 'Disabled';
    const cookiesRaw = draft.storage.cookies?.trim() ?? '';
    const cookiesHint = cookiesRaw
      ? cookiesRaw.startsWith('[') || cookiesRaw.startsWith('{')
        ? 'JSON configured'
        : 'File path configured'
      : 'Not configured';

    const windowModeLabel =
      browserWindowMode === 'fixed'
        ? 'Fixed'
        : browserWindowMode === 'auto'
          ? 'Auto'
          : 'Fit screen';

    const windowSizeHint =
      browserWindowMode === 'fixed' && browserWindowWidth && browserWindowHeight
        ? `${browserWindowWidth}×${browserWindowHeight}`
        : windowModeLabel;

    return {
      proxyState,
      locale: draft.geo.locale?.trim() || 'Auto',
      timezone: draft.geo.timezone?.trim() || 'Auto',
      cookiesHint,
      windowSizeHint,
      maximizeOnStart: browserWindowMaximize,
    };
  }, [
    browserWindowHeight,
    browserWindowMaximize,
    browserWindowMode,
    browserWindowWidth,
    draft.geo.locale,
    draft.geo.timezone,
    draft.storage.cookies,
    proxyEnabled,
  ]);

  const recomputeDirty = useCallback((nextDraft: ProfileSettingsV1, nextAlias: string) => {
    const aliasChanged = nextAlias.trim() !== initialAliasRef.current.trim();
    const settingsChanged = JSON.stringify(nextDraft) !== JSON.stringify(initialDraftRef.current);
    return aliasChanged || settingsChanged;
  }, []);

  const applyLoadedState = useCallback((targetAlias: string, settings: ProfileSettingsV1) => {
    const normalized = mergeSettings(settings);
    setDraft(normalized);
    setAliasDraft(targetAlias);
    initialDraftRef.current = cloneSettings(normalized);
    initialAliasRef.current = targetAlias;
    setDirty(false);
  }, []);

  const resetImportWorkflow = useCallback(() => {
    setImportConfigOpen(false);
    setImportSourcePath(null);
    setImportTargetMode('current');
    setImportTargetAliasDraft('');
    setImportOverwrite(true);
  }, []);

  const handleMakeAliasSafeBase = useCallback(
    (raw: string, current: string) => {
      const seed = raw.trim() || current.trim() || 'profile';
      const sanitized = sanitizeAlias(seed) || 'profile';
      return makeUniqueAlias({
        baseAlias: sanitized,
        existingAliases,
        currentAlias: current,
      });
    },
    [existingAliases]
  );

  const requestClose = useCallback(() => {
    if (saving || addProxySaving || duplicating || deleting || exportingBundle || importingBundle) {
      return;
    }

    if (dirty) {
      setCloseConfirmOpen(true);
      return;
    }

    onClose();
  }, [
    addProxySaving,
    deleting,
    dirty,
    duplicating,
    exportingBundle,
    importingBundle,
    onClose,
    saving,
  ]);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const loadProxyLibrary = async () => {
      setProxyLibraryLoading(true);
      try {
        const items = await listProxyLibrary();
        if (!cancelled) {
          setProxyLibrary(items.filter(item => item.enabled));
        }
      } catch {
        if (!cancelled) {
          setProxyLibrary([]);
        }
      } finally {
        if (!cancelled) setProxyLibraryLoading(false);
      }
    };

    void loadProxyLibrary();
    void refreshAliases();
    return () => {
      cancelled = true;
    };
  }, [isOpen, refreshAliases]);

  useEffect(() => {
    if (isOpen) return;
    resetImportWorkflow();
  }, [isOpen, resetImportWorkflow]);

  useEffect(() => {
    if (!isOpen) return;

    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        requestClose();
      }
    };

    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [isOpen, requestClose, saving]);

  useEffect(() => {
    if (!isOpen || !alias) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setAliasDraft(alias);
    setDirty(false);
    setShowAdvanced(false);
    setShowCookieEditor(false);

    const load = async () => {
      try {
        const existing = await getProfileSettings({ alias });
        if (cancelled) return;

        if (existing?.settings) {
          applyLoadedState(alias, existing.settings);
        } else {
          applyLoadedState(alias, defaultSettings);
        }
      } catch (e) {
        console.error('[ProfileSettingsModal] Failed to load settings:', e);
        if (cancelled) return;
        setError(t('common.error') || 'Failed to load profile settings');
        applyLoadedState(alias, defaultSettings);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [alias, applyLoadedState, isOpen]);

  const handleAliasChange = useCallback(
    (value: string) => {
      setAliasDraft(value);
      setDirty(recomputeDirty(draft, value));
    },
    [draft, recomputeDirty]
  );

  const handleMakeAliasSafe = useCallback(() => {
    const unique = handleMakeAliasSafeBase(aliasDraft, currentAlias);
    if (unique !== aliasDraft) {
      handleAliasChange(unique);
      toast.success(t('accounts.profileSettingsAliasMakeSafeApplied') || 'Alias adjusted');
    }
  }, [aliasDraft, currentAlias, handleAliasChange, handleMakeAliasSafeBase]);

  const handleMakeImportAliasSafe = useCallback(() => {
    const unique = handleMakeAliasSafeBase(importTargetAliasDraft, '');
    if (unique !== importTargetAliasDraft) {
      setImportTargetAliasDraft(unique);
      toast.success(t('accounts.profileSettingsAliasMakeSafeApplied') || 'Alias adjusted');
    }
  }, [handleMakeAliasSafeBase, importTargetAliasDraft]);

  const setDraftWithDirty = (nextDraft: ProfileSettingsV1, nextAlias = aliasDraft) => {
    setDraft(nextDraft);
    setDirty(recomputeDirty(nextDraft, nextAlias));
  };

  const update = (next: ProfileSettingsV1) => {
    setDraftWithDirty(next);
  };

  const patchBrowserWindow = (patch: {
    mode?: ProfileSettingsBrowserWindowMode;
    width?: number | null;
    height?: number | null;
    maximizeOnStart?: boolean;
  }) => {
    const currentWindow = {
      ...(defaultSettings.hardware.browserWindow ?? {}),
      ...(draft.hardware.browserWindow ?? {}),
    };

    const nextWindow = {
      ...currentWindow,
      ...patch,
    };

    if (nextWindow.mode !== 'fixed') {
      nextWindow.width = null;
      nextWindow.height = null;
    }

    update({
      ...draft,
      hardware: {
        ...draft.hardware,
        browserWindow: nextWindow,
      },
    });
  };

  const patchProxy = (patch: Partial<ProfileSettingsProxy>) => {
    const currentProxy = {
      enabled: Boolean(draft.network.proxy?.enabled),
      proxyLibraryId: draft.network.proxy?.proxyLibraryId ?? null,
    };

    update({
      ...draft,
      network: {
        ...draft.network,
        proxy: {
          ...currentProxy,
          ...patch,
        },
      },
    });
  };

  const openAddProxyModal = () => {
    setAddProxyModalOpen(true);
    setAddProxyInput('');
    setAddProxyDraft(null);
    setAddProxyError(null);
    setAddProxyTestResult(null);
    setAddProxyParsed(false);
    setAddProxyLastTestOk(false);
    setRequireProxyTestBeforeSave(true);
  };

  const runSelectedProxyTest = async (options?: {
    persistResult?: boolean;
    setUiState?: boolean;
  }): Promise<{ ok: boolean; message?: string }> => {
    const selectedId = draft.network.proxy?.proxyLibraryId?.trim() ?? '';
    if (!selectedId) {
      const message = t('profileProxy.addProxyTestRequiredMessage');
      if (options?.setUiState) {
        setSelectedProxyTestError(message);
        setSelectedProxyTestResult(null);
      }
      return { ok: false, message };
    }

    const selectedProxy = proxyLibrary.find(item => item.id === selectedId) ?? null;
    if (!selectedProxy) {
      const message = t('profileProxy.addProxyTestRequiredMessage');
      if (options?.setUiState) {
        setSelectedProxyTestError(message);
        setSelectedProxyTestResult(null);
      }
      return { ok: false, message };
    }

    if (options?.setUiState) {
      setSelectedProxyTesting(true);
      setSelectedProxyTestError(null);
      setSelectedProxyTestResult(null);
    }

    try {
      const result = await testProxyLibraryDraft(
        {
          label: selectedProxy.label,
          host: selectedProxy.host,
          port: selectedProxy.port,
          username: selectedProxy.username ?? null,
          password: selectedProxy.password ?? null,
          proxyType: selectedProxy.proxyType,
          enabled: selectedProxy.enabled,
          notes: selectedProxy.notes ?? null,
        },
        {
          proxyLibraryId: selectedId,
          persistResult: options?.persistResult ?? true,
        }
      );

      if (result.success) {
        const message = `${t('profileProxy.testOk')}${
          result.responseTimeMs != null ? ` • ${result.responseTimeMs}ms` : ''
        }${result.ip ? ` • ${result.ip}` : ''}${result.location ? ` • ${result.location}` : ''}`;

        if (options?.setUiState) {
          setSelectedProxyTestResult(message);
          setSelectedProxyTestError(null);
        }

        return { ok: true, message };
      }

      const message = `${t('profileProxy.testFail')}${result.error ? ` • ${result.error}` : ''}`;
      if (options?.setUiState) {
        setSelectedProxyTestResult(message);
        setSelectedProxyTestError(null);
      }
      return { ok: false, message };
    } catch (e) {
      const message = e instanceof Error ? e.message : t('profileProxy.addProxyTestError');
      if (options?.setUiState) {
        setSelectedProxyTestError(message);
        setSelectedProxyTestResult(null);
      }
      return { ok: false, message };
    } finally {
      if (options?.setUiState) {
        setSelectedProxyTesting(false);
      }
    }
  };

  const handleTestSelectedProxy = async () => {
    await runSelectedProxyTest({
      persistResult: true,
      setUiState: true,
    });
  };

  const normalizeProxyDraft = (draftArg: ProxyLibraryDraft): ProxyLibraryDraft => ({
    ...draftArg,
    label: draftArg.label?.trim() || `${alias ?? 'profile'} proxy`,
    host: draftArg.host.trim(),
    port: Number(draftArg.port),
    username: draftArg.username?.trim() || null,
    password: draftArg.password?.trim() || null,
    notes: draftArg.notes?.trim() || null,
  });

  const handleParseAddProxyInput = async () => {
    if (!addProxyInput.trim()) return;
    setAddProxyParsing(true);
    setAddProxyError(null);
    setAddProxyTestResult(null);
    setAddProxyLastTestOk(false);

    try {
      const parsed = await parseProxyLibraryInput({ raw: addProxyInput.trim() });
      if (!parsed.host || !parsed.port) {
        setAddProxyError(t('profileProxy.addProxyParseError'));
        return;
      }
      setAddProxyDraft({
        ...parsed,
        label: parsed.label || `${alias ?? 'profile'} proxy`,
        enabled: true,
      });
      setAddProxyParsed(true);
    } catch (e) {
      setAddProxyError(e instanceof Error ? e.message : t('profileProxy.addProxyParseError'));
    } finally {
      setAddProxyParsing(false);
    }
  };

  const handleTestAddProxyDraft = async () => {
    if (!addProxyDraft) return;
    setAddProxyTesting(true);
    setAddProxyError(null);
    setAddProxyTestResult(null);
    setAddProxyLastTestOk(false);

    try {
      const result = await testProxyLibraryDraft(normalizeProxyDraft(addProxyDraft));
      if (result.success) {
        setAddProxyLastTestOk(true);
        setAddProxyTestResult(
          `${t('profileProxy.testOk')}${result.responseTimeMs != null ? ` • ${result.responseTimeMs}ms` : ''}${
            result.ip ? ` • ${result.ip}` : ''
          }${result.location ? ` • ${result.location}` : ''}`
        );
      } else {
        setAddProxyTestResult(
          `${t('profileProxy.testFail')}${result.error ? ` • ${result.error}` : ''}`
        );
      }
    } catch (e) {
      setAddProxyError(e instanceof Error ? e.message : t('profileProxy.addProxyTestError'));
    } finally {
      setAddProxyTesting(false);
    }
  };

  const handleSaveAndUseAddProxy = async () => {
    if (!addProxyDraft) return;
    if (requireProxyTestBeforeSave && !addProxyLastTestOk) {
      setAddProxyError(t('profileProxy.addProxyTestRequiredMessage'));
      return;
    }

    setAddProxySaving(true);
    setAddProxyError(null);
    try {
      if (addProxyLastTestOk && addProxyDraft) {
        const optimisticDraft = normalizeProxyDraft(addProxyDraft);
        const optimistic = await testProxyLibraryDraft(optimisticDraft);
        if (!optimistic.success) {
          setAddProxyError(t('profileProxy.addProxyTestRequiredMessage'));
          return;
        }
      }

      const entry = await createOrGetProxyLibraryEntry(normalizeProxyDraft(addProxyDraft));

      const testResult = await testProxyLibraryDraft(normalizeProxyDraft(addProxyDraft), {
        proxyLibraryId: entry.id,
        persistResult: true,
      });

      if (requireProxyTestBeforeSave && !testResult.success) {
        setAddProxyError(t('profileProxy.addProxyTestRequiredMessage'));
        return;
      }

      const items = await listProxyLibrary();
      setProxyLibrary(items.filter(item => item.enabled));

      patchProxy({
        enabled: true,
        proxyLibraryId: entry.id,
      });
      setAddProxyModalOpen(false);
      toast.success(t('profileProxy.addProxySuccess'));
    } catch (e) {
      setAddProxyError(e instanceof Error ? e.message : t('profileProxy.addProxySaveError'));
    } finally {
      setAddProxySaving(false);
    }
  };

  const handleSave = async () => {
    if (!currentAlias || saving) return;
    setSaving(true);
    setError(null);

    try {
      if (aliasValidationError) {
        setError(aliasValidationError);
        return;
      }
      const nextAlias = aliasDraft.trim();

      const normalized = mergeSettings({
        ...draft,
        version: 1,
      });

      if (normalized.network.proxy?.enabled) {
        const selectedId = normalized.network.proxy.proxyLibraryId?.trim() ?? '';
        if (!selectedId) {
          setError(t('profileProxy.addProxyTestRequiredMessage'));
          return;
        }

        const selectedProxy = proxyLibrary.find(item => item.id === selectedId) ?? null;
        if (!selectedProxy) {
          setError(t('profileProxy.addProxyTestRequiredMessage'));
          return;
        }

        let guardOk = true;
        try {
          guardOk = await ensureProxySaveUseAllowed({
            proxyLibraryId: selectedId,
          });
        } catch (guardError) {
          if (guardError instanceof ProxyLibraryError) {
            const isGuardFailure = guardError.code === 'proxy_save_use_guard_failed';
            if (isGuardFailure) {
              setError(t('profileProxy.addProxyTestRequiredMessage'));
              return;
            }
            const guardMessage = guardError.message?.trim();
            if (guardMessage) {
              setError(guardMessage);
              return;
            }
          }
          guardOk = false;
        }

        if (!guardOk) {
          setError(t('profileProxy.addProxyTestRequiredMessage'));
          return;
        }
      }

      let savedAlias = currentAlias;
      if (nextAlias !== currentAlias) {
        await renameFingerprintProfileAlias({
          currentAlias,
          nextAlias,
        });
        savedAlias = nextAlias;
      }

      await saveProfileSettings({ alias: savedAlias, settings: normalized });
      applyLoadedState(savedAlias, normalized);
      await refreshAliases();
      toast.success(t('common.saved') || 'Saved');
      onSaved?.();
      onClose();
    } catch (e) {
      console.error('[ProfileSettingsModal] Failed to save settings:', e);
      setError(
        extractActionErrorMessage(e, t('common.error') || 'Failed to save profile settings')
      );
    } finally {
      setSaving(false);
    }
  };

  const handleClearMain = () => {
    update({
      ...draft,
      storage: {
        ...draft.storage,
        lastUrl: null,
        lastScenarioPath: null,
        notes: null,
      },
    });
  };

  const handleResetMainToDefaults = () => {
    update({
      ...draft,
      hardware: {
        ...draft.hardware,
        browserWindow: {
          ...(defaultSettings.hardware.browserWindow ?? {}),
        },
      },
      storage: {
        ...draft.storage,
        lastUrl: defaultSettings.storage.lastUrl,
        lastScenarioPath: defaultSettings.storage.lastScenarioPath,
        notes: defaultSettings.storage.notes,
      },
    });
  };

  const handleClearGeo = () => {
    update({
      ...draft,
      geo: {
        ...draft.geo,
        locale: null,
        timezone: null,
        latitude: null,
        longitude: null,
      },
    });
    setShowAdvanced(false);
  };

  const handleClearData = () => {
    update({
      ...draft,
      storage: {
        ...draft.storage,
        cookies: null,
      },
    });
  };

  const handleResetCurrentTab = () => {
    const baseline = initialDraftRef.current;

    if (activeTab === 'main') {
      setDraftWithDirty(
        {
          ...draft,
          hardware: {
            ...draft.hardware,
            browserWindow: {
              ...(defaultSettings.hardware.browserWindow ?? {}),
              ...(baseline.hardware.browserWindow ?? {}),
            },
          },
          storage: {
            ...draft.storage,
            lastUrl: baseline.storage.lastUrl ?? null,
            lastScenarioPath: baseline.storage.lastScenarioPath ?? null,
            notes: baseline.storage.notes ?? null,
          },
        },
        aliasDraft
      );
      return;
    }

    if (activeTab === 'proxy') {
      setDraftWithDirty(
        {
          ...draft,
          network: {
            ...draft.network,
            proxy: {
              enabled: Boolean(baseline.network.proxy?.enabled),
              proxyLibraryId: baseline.network.proxy?.proxyLibraryId ?? null,
            },
          },
        },
        aliasDraft
      );
      return;
    }

    if (activeTab === 'geo') {
      setDraftWithDirty(
        {
          ...draft,
          geo: {
            ...draft.geo,
            locale: baseline.geo.locale ?? null,
            timezone: baseline.geo.timezone ?? null,
            latitude: baseline.geo.latitude ?? null,
            longitude: baseline.geo.longitude ?? null,
          },
        },
        aliasDraft
      );
      setShowAdvanced(
        typeof baseline.geo.latitude === 'number' && typeof baseline.geo.longitude === 'number'
      );
      return;
    }

    setDraftWithDirty(
      {
        ...draft,
        storage: {
          ...draft.storage,
          cookies: baseline.storage.cookies ?? null,
        },
      },
      aliasDraft
    );
  };

  const handleResetAllToDefaults = () => {
    const normalized = mergeSettings({
      ...defaultSettings,
      version: 1,
    });
    setDraftWithDirty(normalized, aliasDraft);
    setShowAdvanced(false);
    setShowCookieEditor(false);
    setResetAllConfirmOpen(false);
  };

  const handleDuplicateProfile = async () => {
    if (!currentAlias || duplicating) return;
    if (aliasValidationError) {
      setError(aliasValidationError);
      return;
    }
    setDuplicating(true);
    setError(null);

    try {
      const source = await loadFingerprintProfile({ email: currentAlias });
      if (!source) {
        throw new Error('Source profile not found');
      }

      const aliases = await listFingerprintProfiles();
      const duplicateAlias = buildUniqueDuplicateAlias(currentAlias, aliases);
      await saveFingerprintProfile({
        email: duplicateAlias,
        profile: source as BrowserFingerprintProfile,
      });

      const normalized = mergeSettings({
        ...draft,
        version: 1,
      });
      await saveProfileSettings({ alias: duplicateAlias, settings: normalized });

      await refreshAliases();
      toast.success(`Profile duplicated: ${duplicateAlias}`);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to duplicate profile');
    } finally {
      setDuplicating(false);
    }
  };

  const handleDeleteProfile = async () => {
    if (!currentAlias || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteFingerprintProfile({ email: currentAlias });
      toast.success(t('accounts.profileDeleteSuccess') || 'Profile deleted');
      setDeleteConfirmOpen(false);
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('accounts.profileDeleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  const handleExportProfile = async () => {
    if (!currentAlias || exportingBundle) return;

    try {
      const suggestedName = `${currentAlias.replace(/[^a-zA-Z0-9._-]+/g, '_')}.profile.bundle.json`;
      const destination = await saveFileDialog({
        title: t('accounts.profileSettingsExportDialogTitle') || 'Export profile bundle',
        defaultPath: suggestedName,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });

      if (!destination) return;

      setExportingBundle(true);
      await exportFingerprintProfileBundle({ alias: currentAlias, destinationPath: destination });
      toast.success(t('accounts.profileSettingsExportSuccess') || 'Profile exported');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('accounts.profileSettingsExportFailed'));
    } finally {
      setExportingBundle(false);
    }
  };

  const handleImportProfile = async () => {
    if (!currentAlias || importingBundle) return;

    try {
      setError(null);
      const selected = await openFileDialog({
        title: t('accounts.profileSettingsImportDialogTitle') || 'Import profile bundle',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!selected) return;

      const sourcePath = Array.isArray(selected) ? selected[0] : selected;
      if (!sourcePath) return;

      setImportSourcePath(sourcePath);
      setImportTargetMode('current');
      setImportTargetAliasDraft('');
      setImportOverwrite(true);
      setImportConfigOpen(true);
    } catch {
      setError(t('accounts.profileSettingsImportPickFailed') || 'Failed to pick import file');
    }
  };

  const handleConfirmImportProfile = async () => {
    if (!currentAlias || importingBundle || !importSourcePath) return;

    const targetAlias = importTargetMode === 'new' ? importTargetAliasDraft.trim() : currentAlias;

    if (!targetAlias) {
      setError(t('accounts.profileSettingsAliasRequired') || 'Profile alias is required');
      return;
    }
    if (importTargetMode === 'new' && importNewAliasError) {
      setError(importNewAliasError);
      return;
    }

    try {
      setImportingBundle(true);
      setError(null);
      const importedAlias = await importFingerprintProfileBundle({
        sourcePath: importSourcePath,
        targetAlias,
        overwrite: importOverwrite,
      });

      if (importedAlias === currentAlias) {
        const record = await getProfileSettings({ alias: importedAlias });
        applyLoadedState(importedAlias, record?.settings ?? defaultSettings);
      }

      resetImportWorkflow();
      await refreshAliases();
      toast.success(t('accounts.profileSettingsImportSuccess') || 'Profile imported');
      onSaved?.();

      if (importedAlias !== currentAlias) {
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('accounts.profileSettingsImportFailed'));
    } finally {
      setImportingBundle(false);
    }
  };

  const handleCopyPath = async (value: string | null | undefined, label: string) => {
    const text = value?.trim();
    if (!text) {
      toast.error(`${label} is empty`);
      return;
    }

    try {
      await copyToClipboard({ text });
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Failed to copy ${label.toLowerCase()}`);
    }
  };

  const handleOpenPath = async (value: string | null | undefined, label: string) => {
    const text = value?.trim();
    if (!text) {
      toast.error(`${label} is empty`);
      return;
    }

    try {
      await openInFileManager({ path: text });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Failed to open ${label.toLowerCase()}`);
    }
  };

  const handlePickCookieFile = async () => {
    try {
      const selected = await openFileDialog({
        filters: [{ name: 'Cookie files', extensions: ['json', 'txt'] }],
      });

      if (!selected) return;
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (!path) return;

      update({
        ...draft,
        storage: {
          ...draft.storage,
          cookies: path,
        },
      });
    } catch {
      toast.error('Failed to pick cookie file');
    }
  };

  return {
    draft,
    aliasDraft,
    loading,
    saving,
    duplicating,
    deleting,
    exportingBundle,
    importingBundle,
    error,
    dirty,
    closeConfirmOpen,
    deleteConfirmOpen,
    resetAllConfirmOpen,
    importConfigOpen,
    importSourcePath,
    importTargetMode,
    importTargetAliasDraft,
    importOverwrite,
    existingAliases,
    showAdvanced,
    activeTab,
    showCookieEditor,
    proxyLibrary,
    proxyLibraryLoading,
    addProxyModalOpen,
    addProxyInput,
    addProxyDraft,
    addProxyParsing,
    addProxyTesting,
    addProxySaving,
    addProxyError,
    addProxyTestResult,
    addProxyParsed,
    addProxyLastTestOk,
    requireProxyTestBeforeSave,
    selectedProxyTesting,
    selectedProxyTestResult,
    selectedProxyTestError,

    proxyEnabled,
    proxyLibraryId,
    proxyMode,
    selectedLibraryProxy,
    hasManualGeo,
    localeManual,
    timezoneManual,
    browserWindowMode,
    browserWindowWidth,
    browserWindowHeight,
    browserWindowMaximize,
    currentAlias,
    aliasValidationError,
    importNewAliasError,
    summary,

    setCloseConfirmOpen,
    setDeleteConfirmOpen,
    setResetAllConfirmOpen,
    setActiveTab,
    setShowCookieEditor,
    setShowAdvanced,

    setAddProxyModalOpen,
    setAddProxyInput,
    setAddProxyDraft,
    setAddProxyError,
    setAddProxyTestResult,
    setAddProxyParsed,
    setAddProxyLastTestOk,
    setRequireProxyTestBeforeSave,

    setImportConfigOpen,
    setImportTargetMode,
    setImportTargetAliasDraft,
    setImportOverwrite,
    resetImportWorkflow,

    requestClose,
    handleSave,
    handleDuplicateProfile,
    handleDeleteProfile,
    handleExportProfile,
    handleImportProfile,
    handleConfirmImportProfile,
    handleResetCurrentTab,
    handleResetAllToDefaults,
    handleAliasChange,
    handleMakeAliasSafe,
    handleMakeImportAliasSafe,
    handleClearMain,
    handleResetMainToDefaults,
    handleClearGeo,
    handleClearData,
    handleCopyPath,
    handleOpenPath,
    handlePickCookieFile,
    patchBrowserWindow,
    patchProxy,
    openAddProxyModal,
    handleTestSelectedProxy,
    handleParseAddProxyInput,
    handleTestAddProxyDraft,
    handleSaveAndUseAddProxy,
    normalizeProxyDraft,
    update,
  };
}
