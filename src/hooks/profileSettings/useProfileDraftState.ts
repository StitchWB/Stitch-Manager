import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { openFileDialog } from '@/lib/fileDialog';
import { t } from '@/lib/i18n';
import {
  getProfileSettings,
  listFingerprintProfiles,
  type ProfileSettingsBrowserWindowMode,
  type ProfileSettingsProxy,
  type ProfileSettingsV1,
} from '@/lib/backend/modules/profiles';
import {
  cloneSettings,
  defaultSettings,
  getAliasValidationKey,
  makeUniqueAlias,
  mergeSettings,
  sanitizeAlias,
  type SettingsTab,
} from './schema';

interface UseProfileDraftStateParams {
  alias: string | null;
  isOpen: boolean;
  activeTab: SettingsTab;
  setShowAdvanced: Dispatch<SetStateAction<boolean>>;
  setShowCookieEditor: Dispatch<SetStateAction<boolean>>;
  setResetAllConfirmOpen: Dispatch<SetStateAction<boolean>>;
}

export function useProfileDraftState({
  alias,
  isOpen,
  activeTab,
  setShowAdvanced,
  setShowCookieEditor,
  setResetAllConfirmOpen,
}: UseProfileDraftStateParams) {
  const [draft, setDraft] = useState<ProfileSettingsV1>(defaultSettings);
  const [aliasDraft, setAliasDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [existingAliases, setExistingAliases] = useState<string[]>([]);
  const initialDraftRef = useRef<ProfileSettingsV1>(defaultSettings);
  const initialAliasRef = useRef('');

  const proxyEnabled = Boolean(draft.network.proxy?.enabled);
  const proxyLibraryId = draft.network.proxy?.proxyLibraryId?.trim() || '';
  const proxyMode: 'none' | 'library' = !proxyEnabled ? 'none' : 'library';
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

  useEffect(() => {
    if (!isOpen) return;

    queueMicrotask(() => {
      void refreshAliases();
    });
  }, [isOpen, refreshAliases]);

  useEffect(() => {
    if (!isOpen || !alias) return;

      let cancelled = false;
      queueMicrotask(() => {
        setLoading(true);
        setError(null);
        setAliasDraft(alias);
        setDirty(false);
        setShowAdvanced(false);
        setShowCookieEditor(false);
      });

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
  }, [alias, applyLoadedState, isOpen, setShowAdvanced, setShowCookieEditor]);

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
    error,
    setError,
    dirty,
    existingAliases,
    proxyEnabled,
    proxyLibraryId,
    proxyMode,
    hasManualGeo,
    localeManual,
    timezoneManual,
    browserWindowMode,
    browserWindowWidth,
    browserWindowHeight,
    browserWindowMaximize,
    currentAlias,
    aliasValidationError,
    summary,
    refreshAliases,
    recomputeDirty,
    applyLoadedState,
    handleMakeAliasSafeBase,
    handleAliasChange,
    handleMakeAliasSafe,
    update,
    patchBrowserWindow,
    patchProxy,
    handleClearMain,
    handleResetMainToDefaults,
    handleClearGeo,
    handleClearData,
    handleResetCurrentTab,
    handleResetAllToDefaults,
    handlePickCookieFile,
  };
}
