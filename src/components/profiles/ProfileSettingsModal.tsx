import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Globe,
  MapPin,
  Cookie,
  Link2,
  ChevronDown,
  ChevronUp,
  Copy,
  FolderOpen,
  Upload,
  CopyPlus,
  Trash2,
  RotateCcw,
  Download,
  FileUp,
  Wand2,
} from 'lucide-react';
import { useUIState } from '../../hooks/useUIState';
import { open, save } from '@tauri-apps/plugin-dialog';

import { t } from '../../lib/i18n';
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
} from '@/lib/tauri/modules/profiles';
import { copyToClipboard, openInFileManager } from '@/lib/tauri/modules/utils';
import {
  listProxyLibrary,
  createOrGetProxyLibraryEntry,
  parseProxyLibraryInput,
  testProxyLibraryDraft,
  ensureProxySaveUseAllowed,
  ProxyLibraryError,
  type ProxyLibraryDraft,
  type ProxyLibraryEntry,
} from '@/lib/tauri/modules/proxyLibrary';
import { toast } from 'sonner';
import { formatProfileAlias } from '@/lib/profiles/displayName';
import {
  Button,
  ConfirmDialog,
  Input,
  Modal,
  Select,
  TabButton,
  Textarea,
  Toggle,
} from '@/components/ui';

interface ProfileSettingsModalProps {
  alias: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

type SettingsTab = 'main' | 'proxy' | 'geo' | 'data';

const defaultSettings: ProfileSettingsV1 = {
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
      maximizeOnStart: false,
    },
  },
  storage: {
    cookies: null,
    notes: null,
    lastUrl: null,
    lastScenarioPath: null,
  },
};

function mergeSettings(record: ProfileSettingsV1): ProfileSettingsV1 {
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

const windowModeOptions: Array<{ value: ProfileSettingsBrowserWindowMode; label: string }> = [
  { value: 'fit-screen', label: 'Fit screen (recommended)' },
  { value: 'fixed', label: 'Fixed size' },
  { value: 'auto', label: 'Auto fallback' },
];

const windowPresetOptions: Array<{ value: string; label: string; width: number; height: number }> =
  [
    { value: '1366x768', label: '1366 × 768 (HD)', width: 1366, height: 768 },
    { value: '1600x900', label: '1600 × 900 (HD+)', width: 1600, height: 900 },
    { value: '1920x1080', label: '1920 × 1080 (Full HD)', width: 1920, height: 1080 },
    { value: '2560x1440', label: '2560 × 1440 (QHD)', width: 2560, height: 1440 },
  ];

function parsePositiveIntOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : null;
}

function cloneSettings(record: ProfileSettingsV1): ProfileSettingsV1 {
  return mergeSettings(structuredClone(record));
}

function buildUniqueDuplicateAlias(baseAlias: string, existingAliases: string[]): string {
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

function sanitizeAlias(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Replace newlines with spaces, then collapse whitespace.
  let value = trimmed.replace(/\r|\n/g, ' ').replace(/\s+/g, ' ');

  // Replace Windows-illegal characters and path separators.
  value = value.replace(/[<>:"/\\|?*]/g, '_');

  // Prefer dot-separated tokens over spaces.
  value = value.replace(/\s+/g, '.');

  // Collapse repeated dots and trim edge dots.
  value = value.replace(/\.{2,}/g, '.').replace(/^\.+|\.+$/g, '');

  // Truncate to keep within validation limit.
  if (value.length > 160) {
    value = value.slice(0, 160).replace(/^\.+|\.+$/g, '');
  }

  return value;
}

function makeUniqueAlias(params: {
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

function extractActionErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? '').trim();
  if (!raw) {
    return fallback;
  }

  const separatorIdx = raw.indexOf('|');
  if (separatorIdx > 0) {
    const maybeCode = raw.slice(0, separatorIdx).trim();
    const maybeMessage = raw.slice(separatorIdx + 1).trim();
    if (/^[a-z0-9_\-]+$/i.test(maybeCode)) {
      return maybeMessage || fallback;
    }
  }

  return raw;
}

export function ProfileSettingsModal({
  alias,
  isOpen,
  onClose,
  onSaved,
}: ProfileSettingsModalProps) {
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

  const normalizeProxyDraft = (draft: ProxyLibraryDraft): ProxyLibraryDraft => ({
    ...draft,
    label: draft.label?.trim() || `${alias ?? 'profile'} proxy`,
    host: draft.host.trim(),
    port: Number(draft.port),
    username: draft.username?.trim() || null,
    password: draft.password?.trim() || null,
    notes: draft.notes?.trim() || null,
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

    if (addProxyLastTestOk && addProxyDraft) {
      const optimisticDraft = normalizeProxyDraft(addProxyDraft);
      const optimistic = await testProxyLibraryDraft(optimisticDraft);
      if (!optimistic.success) {
        setAddProxyError(t('profileProxy.addProxyTestRequiredMessage'));
        return;
      }
    }
    setAddProxySaving(true);
    setAddProxyError(null);
    try {
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
      const destination = await save({
        title: t('accounts.profileSettingsExportDialogTitle') || 'Export profile bundle',
        defaultPath: suggestedName,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });

      if (!destination) return;
      const destinationPath = Array.isArray(destination) ? destination[0] : destination;
      if (!destinationPath) return;

      setExportingBundle(true);
      await exportFingerprintProfileBundle({ alias: currentAlias, destinationPath });
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
      const selected = await open({
        title: t('accounts.profileSettingsImportDialogTitle') || 'Import profile bundle',
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!selected) return;

      const sourcePath = Array.isArray(selected) ? selected[0] : selected;
      if (!sourcePath || typeof sourcePath !== 'string') return;

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
      const selection = await open({
        multiple: false,
        filters: [{ name: 'Cookie files', extensions: ['json', 'txt'] }],
      });

      if (!selection) return;
      const selected = Array.isArray(selection) ? selection[0] : selection;
      if (!selected) return;

      const path = typeof selected === 'string' ? selected : selected.name;
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

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50">
        <button
          type="button"
          aria-label="Close profile settings backdrop"
          className="absolute inset-0 bg-black/60"
          onClick={requestClose}
        />

        <aside className="absolute right-0 top-0 h-full w-full max-w-[560px] border-l border-white/10 bg-[#0f1115] shadow-2xl flex flex-col">
          <header className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-slate-400">
                {t('accounts.profileAlias') || 'Profile'}
              </div>
              <div className="text-base font-semibold text-slate-100 truncate">
                {formatProfileAlias(aliasDraft || alias)}
              </div>
              {aliasDraft && formatProfileAlias(aliasDraft) !== aliasDraft ? (
                <div className="mt-0.5 text-[11px] text-slate-500 truncate font-mono">
                  {aliasDraft}
                </div>
              ) : null}
              <div className="mt-1 text-xs text-slate-500">
                Proxy: {summary.proxyState} • Locale: {summary.locale} • Timezone:{' '}
                {summary.timezone} • Window: {summary.windowSizeHint}
              </div>
            </div>
            <button
              type="button"
              onClick={requestClose}
              disabled={saving || duplicating || deleting || exportingBundle || importingBundle}
              className="p-2 rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/10 disabled:opacity-50"
              aria-label="Close profile settings"
            >
              <X size={18} />
            </button>
          </header>

          <div className="px-5 py-3 border-b border-white/10">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                label={t('accounts.profileAlias') || 'Profile alias'}
                value={aliasDraft}
                onChange={e => handleAliasChange(e.target.value)}
                placeholder={
                  t('accounts.profileSettingsAliasPlaceholder') ||
                  'standalone.profile...@local.profile'
                }
                error={aliasValidationError || undefined}
                rightElement={
                  <Button
                    type="button"
                    size="xs"
                    variant="secondary"
                    leftIcon={<Wand2 size={12} />}
                    onClick={handleMakeAliasSafe}
                    disabled={loading || saving || !aliasDraft.trim()}
                    title={
                      t('accounts.profileSettingsAliasMakeSafeTooltip') ||
                      'Replace invalid characters and avoid conflicts'
                    }
                  >
                    {t('accounts.profileSettingsAliasMakeSafe') || 'Make safe'}
                  </Button>
                }
              />
              <div className="flex items-end justify-start md:justify-end gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  leftIcon={<CopyPlus size={14} />}
                  onClick={() => void handleDuplicateProfile()}
                  disabled={
                    loading ||
                    saving ||
                    duplicating ||
                    deleting ||
                    exportingBundle ||
                    importingBundle ||
                    Boolean(aliasValidationError)
                  }
                  isLoading={duplicating}
                >
                  Duplicate
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  leftIcon={<Trash2 size={14} />}
                  onClick={() => setDeleteConfirmOpen(true)}
                  disabled={loading || saving || duplicating || deleting}
                >
                  {t('accounts.deleteProfile') || 'Delete'}
                </Button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="xs"
                variant="secondary"
                leftIcon={<Download size={12} />}
                onClick={() => void handleExportProfile()}
                disabled={loading || saving || exportingBundle}
                isLoading={exportingBundle}
              >
                Export
              </Button>
              <Button
                size="xs"
                variant="secondary"
                leftIcon={<FileUp size={12} />}
                onClick={() => void handleImportProfile()}
                disabled={loading || saving || importingBundle}
                isLoading={importingBundle}
              >
                Import
              </Button>
              <div className="h-4 w-px bg-white/10 mx-1" />
              <Button
                size="xs"
                variant="secondary"
                leftIcon={<RotateCcw size={12} />}
                onClick={handleResetCurrentTab}
                disabled={loading || saving}
              >
                Reset tab
              </Button>
              <Button
                size="xs"
                variant="secondary"
                onClick={() => setResetAllConfirmOpen(true)}
                disabled={loading || saving}
              >
                Reset all
              </Button>
            </div>
          </div>

          <div className="px-5 py-3 border-b border-white/10 flex flex-wrap gap-2">
            <TabButton
              active={activeTab === 'main'}
              onClick={() => setActiveTab('main')}
              label="Main"
              className="h-9 px-5"
            />
            <TabButton
              active={activeTab === 'proxy'}
              onClick={() => setActiveTab('proxy')}
              label="Proxy"
              className="h-9 px-5"
            />
            <TabButton
              active={activeTab === 'geo'}
              onClick={() => setActiveTab('geo')}
              label="Geo"
              className="h-9 px-5"
            />
            <TabButton
              active={activeTab === 'data'}
              onClick={() => setActiveTab('data')}
              label="Data"
              className="h-9 px-5"
            />
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {loading ? (
              <div className="text-sm text-slate-400">{t('common.loading') || 'Loading...'}</div>
            ) : null}
            {error ? (
              <div className="text-xs text-red-300 border border-red-500/20 bg-red-500/10 rounded-lg px-3 py-2">
                {error}
              </div>
            ) : null}

            {!loading && activeTab === 'main' && (
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-slate-200 text-sm font-semibold">
                  <Link2 size={14} /> Defaults
                </div>

                <div className="flex items-center gap-2">
                  <Button size="xs" variant="secondary" onClick={handleClearMain}>
                    Clear Main
                  </Button>
                  <Button size="xs" variant="secondary" onClick={handleResetMainToDefaults}>
                    Main defaults
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Select
                    label="Window mode"
                    value={browserWindowMode}
                    onValueChange={value =>
                      patchBrowserWindow({
                        mode: (value as ProfileSettingsBrowserWindowMode) || 'fit-screen',
                      })
                    }
                  >
                    {windowModeOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>

                  <div className="flex items-end pb-1">
                    <Toggle
                      label="Maximize on start"
                      checked={browserWindowMaximize}
                      onChange={checked => patchBrowserWindow({ maximizeOnStart: checked })}
                    />
                  </div>

                  {browserWindowMode === 'fixed' ? (
                    <>
                      <Select
                        label="Window preset"
                        value=""
                        onValueChange={value => {
                          if (!value) return;
                          const preset = windowPresetOptions.find(item => item.value === value);
                          if (!preset) return;
                          patchBrowserWindow({
                            mode: 'fixed',
                            width: preset.width,
                            height: preset.height,
                          });
                        }}
                      >
                        <option value="">Pick preset…</option>
                        {windowPresetOptions.map(preset => (
                          <option key={preset.value} value={preset.value}>
                            {preset.label}
                          </option>
                        ))}
                      </Select>

                      <div className="text-[11px] text-slate-500 flex items-end pb-2">
                        Used when mode is Fixed size.
                      </div>

                      <Input
                        label="Window width"
                        type="number"
                        min={640}
                        max={8192}
                        value={browserWindowWidth ?? ''}
                        onChange={e =>
                          patchBrowserWindow({
                            mode: 'fixed',
                            width: parsePositiveIntOrNull(e.target.value),
                          })
                        }
                        placeholder="1920"
                      />

                      <Input
                        label="Window height"
                        type="number"
                        min={480}
                        max={8192}
                        value={browserWindowHeight ?? ''}
                        onChange={e =>
                          patchBrowserWindow({
                            mode: 'fixed',
                            height: parsePositiveIntOrNull(e.target.value),
                          })
                        }
                        placeholder="1080"
                      />
                    </>
                  ) : null}
                </div>

                <Input
                  label="Last URL"
                  value={draft.storage.lastUrl ?? ''}
                  onChange={e =>
                    update({
                      ...draft,
                      storage: { ...draft.storage, lastUrl: e.target.value || null },
                    })
                  }
                  placeholder="https://google.com"
                />

                <Input
                  label="Last scenario path"
                  value={draft.storage.lastScenarioPath ?? ''}
                  onChange={e =>
                    update({
                      ...draft,
                      storage: { ...draft.storage, lastScenarioPath: e.target.value || null },
                    })
                  }
                  placeholder="C:\\...\\scenario.json"
                  rightElement={
                    <div className="flex items-center gap-2 pr-1 pl-2 border-l border-white/10">
                      <button
                        type="button"
                        className="p-2 rounded bg-white/[0.04] hover:bg-white/10 text-slate-300"
                        onClick={() =>
                          void handleCopyPath(draft.storage.lastScenarioPath, 'Scenario path')
                        }
                        title="Copy path"
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        type="button"
                        className="p-2 rounded bg-white/[0.04] hover:bg-white/10 text-slate-300"
                        onClick={() =>
                          void handleOpenPath(draft.storage.lastScenarioPath, 'Scenario path')
                        }
                        title="Open folder"
                      >
                        <FolderOpen size={14} />
                      </button>
                    </div>
                  }
                />

                <Textarea
                  label={t('accounts.notes') || 'Notes'}
                  value={draft.storage.notes ?? ''}
                  onChange={e =>
                    update({
                      ...draft,
                      storage: { ...draft.storage, notes: e.target.value || null },
                    })
                  }
                  className="h-24 min-h-[96px]"
                />

                <div className="text-xs text-slate-500">
                  Window: {summary.windowSizeHint}
                  {' • '}Maximize: {summary.maximizeOnStart ? 'On' : 'Off'}
                </div>
              </section>
            )}

            {!loading && activeTab === 'proxy' && (
              <section className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-slate-200 text-sm font-semibold">
                    <Globe size={14} /> {t('autoReg.proxy') || 'Proxy'}
                  </div>
                  <Toggle
                    label={t('profileProxy.enabledToggle')}
                    checked={proxyEnabled}
                    onChange={checked => {
                      if (checked) {
                        patchProxy({ enabled: true });
                      } else {
                        patchProxy({
                          enabled: false,
                          proxyLibraryId: null,
                        });
                      }
                    }}
                  />
                </div>

                {proxyEnabled ? (
                  <div className="space-y-3">
                    <Select
                      label={t('profileProxy.source')}
                      value={proxyMode}
                      onValueChange={value => {
                        if (value === 'none') {
                          patchProxy({
                            enabled: false,
                            proxyLibraryId: null,
                          });
                          return;
                        }

                        if (value === 'library') {
                          const first = proxyLibrary[0];
                          patchProxy({
                            enabled: true,
                            proxyLibraryId: first?.id ?? null,
                          });
                          return;
                        }
                      }}
                    >
                      <option value="none">{t('profileProxy.sourceDisabled')}</option>
                      <option value="library">{t('profileProxy.sourceLibrary')}</option>
                    </Select>

                    {proxyMode === 'library' ? (
                      <>
                        <Select
                          label={t('profileProxy.libraryProxy')}
                          value={proxyLibraryId}
                          onValueChange={value => patchProxy({ proxyLibraryId: value || null })}
                          disabled={proxyLibraryLoading || proxyLibrary.length === 0}
                        >
                          <option value="">
                            {proxyLibraryLoading
                              ? t('profileProxy.loading')
                              : proxyLibrary.length
                                ? t('profileProxy.selectProxy')
                                : t('profileProxy.noEnabledProxies')}
                          </option>
                          {proxyLibrary.map(item => (
                            <option key={item.id} value={item.id}>
                              {item.label} ({item.proxyType}://{item.host}:{item.port})
                            </option>
                          ))}
                        </Select>

                        <div className="flex items-center justify-between gap-3">
                          {selectedLibraryProxy ? (
                            <div className="text-xs text-slate-400 rounded border border-white/10 bg-white/[0.02] p-2">
                              {t('profileProxy.using')}: {selectedLibraryProxy.proxyType}://
                              {selectedLibraryProxy.host}:{selectedLibraryProxy.port}
                            </div>
                          ) : (
                            <div className="text-xs text-slate-500">
                              {t('profileProxy.noEnabledProxies')}
                            </div>
                          )}

                          <div className="flex items-center gap-2">
                            <Button
                              size="xs"
                              variant="secondary"
                              onClick={() => void handleTestSelectedProxy()}
                              disabled={!selectedLibraryProxy || selectedProxyTesting || saving}
                            >
                              {selectedProxyTesting
                                ? t('profileProxy.addProxyTesting')
                                : t('profileProxy.addProxyTest')}
                            </Button>
                            <Button size="xs" variant="secondary" onClick={openAddProxyModal}>
                              {t('profileProxy.addProxyButton')}
                            </Button>
                          </div>
                        </div>
                        {selectedProxyTestError ? (
                          <div className="text-xs text-red-300">{selectedProxyTestError}</div>
                        ) : null}
                        {selectedProxyTestResult ? (
                          <div className="text-xs text-slate-300">{selectedProxyTestResult}</div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">{t('profileProxy.disabledHint')}</div>
                )}
              </section>
            )}

            {!loading && activeTab === 'geo' && (
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-slate-200 text-sm font-semibold">
                  <MapPin size={14} /> {t('accounts.profileGeoTab') || 'Geo'}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Select
                    label={t('accounts.profileSettingsLocaleLabel') || 'Locale'}
                    value={draft.geo.locale ?? ''}
                    onValueChange={value =>
                      update({ ...draft, geo: { ...draft.geo, locale: value || null } })
                    }
                  >
                    <option value="">Auto</option>
                    <option value="en-US">en-US</option>
                    <option value="en-GB">en-GB</option>
                    <option value="ru-RU">ru-RU</option>
                    <option value="de-DE">de-DE</option>
                  </Select>

                  <div className="flex items-end">
                    <Button size="xs" variant="secondary" onClick={handleClearGeo}>
                      Clear geo
                    </Button>
                  </div>

                  <Input
                    label={t('accounts.profileSettingsTimezoneLabel') || 'Timezone'}
                    value={draft.geo.timezone ?? ''}
                    onChange={e =>
                      update({ ...draft, geo: { ...draft.geo, timezone: e.target.value || null } })
                    }
                    placeholder="Auto"
                  />
                </div>

                <div className="rounded-lg border border-white/10 bg-white/[0.02]">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 text-slate-200 text-sm font-semibold hover:bg-white/[0.03] transition-colors"
                  >
                    <span>Manual coordinates</span>
                    {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>

                  {showAdvanced && (
                    <div className="px-3 pb-3 grid grid-cols-2 gap-3 pt-2">
                      <Input
                        label={t('accounts.profileSettingsLatitudeLabel') || 'Latitude'}
                        type="number"
                        value={draft.geo.latitude ?? ''}
                        onChange={e => {
                          const next = e.target.value ? Number(e.target.value) : null;
                          update({
                            ...draft,
                            geo: {
                              ...draft.geo,
                              latitude: Number.isFinite(next as number) ? next : null,
                            },
                          });
                        }}
                        placeholder="Auto"
                      />
                      <Input
                        label={t('accounts.profileSettingsLongitudeLabel') || 'Longitude'}
                        type="number"
                        value={draft.geo.longitude ?? ''}
                        onChange={e => {
                          const next = e.target.value ? Number(e.target.value) : null;
                          update({
                            ...draft,
                            geo: {
                              ...draft.geo,
                              longitude: Number.isFinite(next as number) ? next : null,
                            },
                          });
                        }}
                        placeholder="Auto"
                      />
                    </div>
                  )}
                </div>

                <div className="text-xs text-slate-500">
                  Current mode: {hasManualGeo ? 'Manual coordinates' : 'Auto geolocation'}
                  {' • '}Locale: {localeManual ? 'Manual' : 'Auto'}
                  {' • '}Timezone: {timezoneManual ? 'Manual' : 'Auto'}
                </div>
              </section>
            )}

            {!loading && activeTab === 'data' && (
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-slate-200 text-sm font-semibold">
                  <Cookie size={14} /> Cookies & storage
                </div>

                <div className="rounded-lg bg-white/[0.02] px-3 py-2">
                  <div className="text-xs text-slate-400">Cookies</div>
                  <div className="text-sm text-slate-200 mt-1">{summary.cookiesHint}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setShowCookieEditor(v => !v)}
                    >
                      {showCookieEditor ? 'Hide editor' : 'Edit cookies'}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handlePickCookieFile()}
                    >
                      <Upload size={14} className="mr-1" /> Import file
                    </Button>
                    <Button size="sm" variant="secondary" onClick={handleClearData}>
                      Clear data
                    </Button>
                  </div>
                </div>

                {showCookieEditor && (
                  <Textarea
                    label={
                      t('accounts.profileSettingsCookiesLabel') || 'Cookies (JSON or file path)'
                    }
                    value={draft.storage.cookies ?? ''}
                    onChange={e =>
                      update({
                        ...draft,
                        storage: { ...draft.storage, cookies: e.target.value || null },
                      })
                    }
                    hint="Paste JSON array/object or absolute path to cookies file"
                    placeholder='[{"name":"sid","value":"..."}] or C:\\cookies.json'
                    className="h-44 min-h-[176px] font-mono text-xs"
                  />
                )}
              </section>
            )}
          </div>

          <footer className="sticky bottom-0 border-t border-white/10 px-5 py-4 flex items-center justify-between gap-3 bg-[#0f1115]">
            <div className="text-xs text-slate-400">{dirty ? 'Unsaved changes' : 'No changes'}</div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={requestClose}
                disabled={saving || duplicating || deleting || exportingBundle || importingBundle}
              >
                {t('common.close') || 'Close'}
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleSave()}
                disabled={
                  !dirty ||
                  saving ||
                  duplicating ||
                  deleting ||
                  exportingBundle ||
                  importingBundle ||
                  Boolean(aliasValidationError)
                }
                isLoading={saving}
              >
                {saving ? t('common.loading') || 'Saving...' : t('common.save') || 'Save'}
              </Button>
            </div>
          </footer>
        </aside>
      </div>

      <ConfirmDialog
        isOpen={closeConfirmOpen}
        onClose={() => setCloseConfirmOpen(false)}
        onConfirm={() => {
          setCloseConfirmOpen(false);
          onClose();
        }}
        title={t('accounts.profileSettingsDiscardTitle') || 'Discard changes?'}
        message={
          t('accounts.profileSettingsDiscardMessage') ||
          'You have unsaved changes. Close without saving?'
        }
        confirmText={t('accounts.profileSettingsDiscardConfirm') || 'Discard'}
        cancelText={t('common.cancel') || 'Cancel'}
        variant="warning"
      />

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        onClose={() => {
          if (!deleting) {
            setDeleteConfirmOpen(false);
          }
        }}
        onConfirm={() => void handleDeleteProfile()}
        title={t('accounts.deleteProfile') || 'Delete profile'}
        message={
          t('accounts.profileSettingsDeleteConfirmMessage', {
            alias: currentAlias || aliasDraft,
          }) || `Delete profile ${currentAlias || aliasDraft}?`
        }
        confirmText={t('common.delete') || 'Delete'}
        cancelText={t('common.cancel') || 'Cancel'}
        variant="danger"
        isLoading={deleting}
      />

      <ConfirmDialog
        isOpen={resetAllConfirmOpen}
        onClose={() => setResetAllConfirmOpen(false)}
        onConfirm={handleResetAllToDefaults}
        title={t('accounts.profileSettingsResetAllTitle') || 'Reset all settings?'}
        message={
          t('accounts.profileSettingsResetAllMessage') ||
          'This will reset Main, Proxy, Geo and Data values to defaults in the editor.'
        }
        confirmText={t('accounts.profileSettingsResetAllConfirm') || 'Reset all'}
        cancelText={t('common.cancel') || 'Cancel'}
        variant="warning"
      />

      <Modal
        isOpen={importConfigOpen}
        onClose={() => {
          if (importingBundle) return;
          resetImportWorkflow();
        }}
        title={t('accounts.profileSettingsImportDialogTitle') || 'Import profile bundle'}
        size="md"
      >
        <div className="space-y-3">
          <Input
            label={t('accounts.profileSettingsImportFileLabel') || 'Selected file'}
            value={importSourcePath ?? ''}
            readOnly
          />

          <Select
            label={t('accounts.profileSettingsImportTargetLabel') || 'Import target'}
            value={importTargetMode}
            onValueChange={value => setImportTargetMode(value === 'new' ? 'new' : 'current')}
            disabled={importingBundle}
          >
            <option value="current">
              {t('accounts.profileSettingsImportTargetCurrent') || 'Current profile'}
            </option>
            <option value="new">
              {t('accounts.profileSettingsImportTargetNew') || 'New alias'}
            </option>
          </Select>

          {importTargetMode === 'new' ? (
            <Input
              label={t('accounts.profileSettingsImportNewAliasLabel') || 'Target alias'}
              value={importTargetAliasDraft}
              onChange={e => setImportTargetAliasDraft(e.target.value)}
              error={importNewAliasError || undefined}
              placeholder={
                t('accounts.profileSettingsAliasPlaceholder') ||
                'standalone.profile...@local.profile'
              }
              rightElement={
                <Button
                  type="button"
                  size="xs"
                  variant="secondary"
                  leftIcon={<Wand2 size={12} />}
                  onClick={handleMakeImportAliasSafe}
                  disabled={importingBundle || !importTargetAliasDraft.trim()}
                  title={
                    t('accounts.profileSettingsAliasMakeSafeTooltip') ||
                    'Replace invalid characters and avoid conflicts'
                  }
                >
                  {t('accounts.profileSettingsAliasMakeSafe') || 'Make safe'}
                </Button>
              }
            />
          ) : null}

          <div className="flex items-center justify-between gap-3 rounded border border-white/10 bg-white/[0.02] px-3 py-2">
            <div className="text-xs text-slate-300">
              {t('accounts.profileSettingsImportOverwriteLabel') || 'Overwrite target profile'}
            </div>
            <Toggle
              label={
                t('accounts.profileSettingsImportOverwriteLabel') || 'Overwrite target profile'
              }
              checked={importOverwrite}
              onChange={checked => setImportOverwrite(checked)}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={resetImportWorkflow} disabled={importingBundle}>
              {t('common.cancel') || 'Cancel'}
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleConfirmImportProfile()}
              disabled={
                !importSourcePath ||
                importingBundle ||
                (importTargetMode === 'new' && !!importNewAliasError)
              }
              isLoading={importingBundle}
            >
              {t('accounts.profileSettingsImportConfirm') || 'Import'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={addProxyModalOpen}
        onClose={() => {
          if (addProxySaving) return;
          setAddProxyModalOpen(false);
        }}
        title={t('profileProxy.addProxyModalTitle')}
        size="md"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
            <Input
              label={t('profileProxy.addProxyInputLabel')}
              value={addProxyInput}
              onChange={e => setAddProxyInput(e.target.value)}
              placeholder={t('profileProxy.addProxyInputPlaceholder')}
            />
            <div className="flex items-end">
              <Button
                variant="secondary"
                onClick={() => void handleParseAddProxyInput()}
                disabled={addProxyParsing || !addProxyInput.trim()}
              >
                {addProxyParsing
                  ? t('profileProxy.addProxyParsing')
                  : t('profileProxy.addProxyParse')}
              </Button>
            </div>
          </div>

          {addProxyDraft ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input
                  label={t('proxyLibrary.label')}
                  value={addProxyDraft.label ?? ''}
                  onChange={e =>
                    setAddProxyDraft(prev => (prev ? { ...prev, label: e.target.value } : prev))
                  }
                />
                <Select
                  label={t('proxyLibrary.type')}
                  value={addProxyDraft.proxyType}
                  disabled={addProxyParsed}
                  onValueChange={value =>
                    setAddProxyDraft(prev =>
                      prev ? { ...prev, proxyType: value as ProxyLibraryDraft['proxyType'] } : prev
                    )
                  }
                >
                  <option value="http">HTTP</option>
                  <option value="socks5">SOCKS5</option>
                </Select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input
                  label={t('proxyLibrary.host')}
                  value={addProxyDraft.host}
                  disabled={addProxyParsed}
                  onChange={e =>
                    setAddProxyDraft(prev => (prev ? { ...prev, host: e.target.value } : prev))
                  }
                />
                <Input
                  label={t('proxyLibrary.port')}
                  type="number"
                  value={String(addProxyDraft.port)}
                  disabled={addProxyParsed}
                  onChange={e =>
                    setAddProxyDraft(prev =>
                      prev
                        ? {
                            ...prev,
                            port: Number.isFinite(Number(e.target.value))
                              ? Number(e.target.value)
                              : 0,
                          }
                        : prev
                    )
                  }
                />
              </div>

              {addProxyParsed ? (
                <div className="text-xs text-slate-400">{t('profileProxy.addProxyLockHint')}</div>
              ) : null}

              <div className="flex items-center justify-between gap-3 rounded border border-white/10 bg-white/[0.02] px-3 py-2">
                <div className="text-xs text-slate-300">
                  {t('profileProxy.addProxyTestRequiredLabel')}
                </div>
                <Toggle
                  label={t('profileProxy.addProxyTestRequiredLabel')}
                  checked={requireProxyTestBeforeSave}
                  onChange={checked => setRequireProxyTestBeforeSave(checked)}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input
                  label={t('proxyLibrary.username')}
                  value={addProxyDraft.username ?? ''}
                  onChange={e =>
                    setAddProxyDraft(prev => (prev ? { ...prev, username: e.target.value } : prev))
                  }
                />
                <Input
                  label={t('proxyLibrary.password')}
                  type="password"
                  value={addProxyDraft.password ?? ''}
                  onChange={e =>
                    setAddProxyDraft(prev => (prev ? { ...prev, password: e.target.value } : prev))
                  }
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleTestAddProxyDraft()}
                  disabled={addProxyTesting}
                >
                  {addProxyTesting
                    ? t('profileProxy.addProxyTesting')
                    : t('profileProxy.addProxyTest')}
                </Button>
                {addProxyTestResult ? (
                  <div className="text-xs text-slate-300">{addProxyTestResult}</div>
                ) : null}
              </div>
            </>
          ) : null}

          {addProxyError ? (
            <div className="text-xs text-red-300 border border-red-500/20 bg-red-500/10 rounded-lg px-3 py-2">
              {addProxyError}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAddProxyModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleSaveAndUseAddProxy()}
              disabled={!addProxyDraft || addProxySaving}
            >
              {addProxySaving ? t('common.loading') : t('profileProxy.addProxySaveUse')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
