import { useCallback, useEffect, useMemo, useState } from 'react';
import { appToast } from '@/lib/observability/toast';
import {
  getAiProxyAccounts,
  deleteAiProxyAccount,
  updateAiProxyAccount,
  debugRunAiProxyMigration,
  getAvailableModelsSafe,
  getProviderCapabilities,
  getProviderModelMappings,
  setProviderModelMappings,
  testProviderConnection,
  getRequestHistory,
  startAiProxy,
  stopAiProxy,
  getProxyStatus,
  getProxySettings,
  updateProxySettings,
  exportAiProxyAccountsPayload,
  importAiProxyAccountsPayload,
  fetchAllQuotasSafe,
  fetchOpenAiAccountQuotasSafe,
  scanAuthFiles as scanAuthFilesCmd,
  type ProviderCapability,
  type ProviderModelMapping,
} from '@/lib/tauri/modules/aiProxy';
import type { AiProxyAccount, AuthFile, ProxySettings, ProxyStatus } from '../../types/generated';
import type { ConnectionStateMap, HistorySummary } from '../../components/ai-proxy/sections/types';
import { useAiProxyStore } from '../../stores/aiProxy';
import { t } from '../../lib/i18n';

const hasTauriBridge = (): boolean => {
  if (typeof window === 'undefined') return false;
  const w = window as typeof window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: { invoke?: unknown };
  };
  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__?.invoke);
};

export function maskKey(key: string, visibleTail: number = 4): string {
  if (!key) return '';
  if (key.length <= visibleTail) return '•'.repeat(Math.max(0, key.length));
  return `${'•'.repeat(Math.max(0, key.length - visibleTail))}${key.slice(-visibleTail)}`;
}

export function useAiProvidersController() {
  const setProviderQuotas = useAiProxyStore(state => state.setProviderQuotas);
  const setOpenAiAccountQuotas = useAiProxyStore(state => state.setOpenAiAccountQuotas);
  const openAiAccountQuotasMap = useAiProxyStore(state => state.openAiAccountQuotas);
  const [accounts, setAccounts] = useState<AiProxyAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; provider: string }>>(
    []
  );
  const [providerCapabilities, setProviderCapabilities] = useState<ProviderCapability[]>([]);
  const [modelMappings, setModelMappings] = useState<ProviderModelMapping[]>([]);
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null);
  const [proxySettings, setProxySettings] = useState<ProxySettings | null>(null);
  const [proxyDraft, setProxyDraft] = useState<ProxySettings | null>(null);
  const [proxyBusy, setProxyBusy] = useState(false);
  const [proxySaving, setProxySaving] = useState(false);
  const [proxyError, setProxyError] = useState<string | null>(null);
  const [authScan, setAuthScan] = useState<AuthFile[] | null>(null);
  const [authScanLoading, setAuthScanLoading] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionStateMap>({});
  const [historySummary, setHistorySummary] = useState<HistorySummary>({ total: 0, errors: 0 });
  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json');
  const [exportIncludeSecrets, setExportIncludeSecrets] = useState(false);
  const [exportPayload, setExportPayload] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [importPayload, setImportPayload] = useState('');
  const [importLoading, setImportLoading] = useState(false);

  const fetchAccounts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getAiProxyAccounts();
      setAccounts(data);
    } catch (e) {
      appToast.error(
        t('aiHub.controller.errors.loadAccountsFailed', {
          msg: e instanceof Error ? e.message : String(e),
        })
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCapabilitiesAndModels = useCallback(async () => {
    const [modelsResult, capabilitiesResult, mappingsResult] = await Promise.allSettled([
      getAvailableModelsSafe(),
      getProviderCapabilities(),
      getProviderModelMappings(),
    ]);

    if (modelsResult.status === 'fulfilled') {
      setAvailableModels(
        modelsResult.value.map(m => ({ id: m.id, provider: m.provider || m.ownedBy || 'unknown' }))
      );
    } else {
      setAvailableModels([]);
    }

    if (capabilitiesResult.status === 'fulfilled') {
      setProviderCapabilities(capabilitiesResult.value);
    } else {
      setProviderCapabilities([]);
    }

    if (mappingsResult.status === 'fulfilled') {
      setModelMappings(mappingsResult.value);
    } else {
      setModelMappings([]);
    }
  }, []);

  const fetchHistorySummary = useCallback(async () => {
    try {
      const rows = await getRequestHistory(20, 0);
      setHistorySummary({
        total: rows.length,
        errors: rows.filter(r => r.status >= 400).length,
      });
    } catch {
      // non-blocking
    }
  }, []);

  const fetchProviderQuotas = useCallback(async () => {
    try {
      const [providerQuotasResult, openAiQuotasResult] = await Promise.allSettled([
        fetchAllQuotasSafe(),
        fetchOpenAiAccountQuotasSafe(),
      ]);

      if (providerQuotasResult.status === 'fulfilled') {
        setProviderQuotas(providerQuotasResult.value);
      }
      if (openAiQuotasResult.status === 'fulfilled') {
        setOpenAiAccountQuotas(openAiQuotasResult.value);
      }
    } catch {
      // non-blocking
    }
  }, [setProviderQuotas, setOpenAiAccountQuotas]);

  const refreshProxyInfo = useCallback(async () => {
    if (!hasTauriBridge()) {
      setProxyStatus(null);
      setProxySettings(null);
      setProxyDraft(null);
      setProxyError(null);
      return;
    }

    try {
      setProxyError(null);
      const [status, settings] = await Promise.all([getProxyStatus(), getProxySettings()]);
      setProxyStatus(status);
      setProxySettings(settings);
      setProxyDraft(settings);
    } catch (e) {
      setProxyError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const handleSaveProxySettings = useCallback(async () => {
    if (!proxyDraft) {
      appToast.error(t('aiHub.proxy.errors.notLoaded'));
      return;
    }
    if (
      !Number.isInteger(proxyDraft.proxyPort) ||
      proxyDraft.proxyPort < 1024 ||
      proxyDraft.proxyPort > 65535
    ) {
      appToast.error(t('aiHub.proxy.errors.invalidPort'));
      return;
    }
    if (!proxyDraft.managementKey.trim()) {
      appToast.error(t('aiHub.proxy.errors.emptyManagementKey'));
      return;
    }

    setProxySaving(true);
    setProxyError(null);
    try {
      await updateProxySettings(proxyDraft);
      setProxySettings(proxyDraft);
      await refreshProxyInfo();
      appToast.success(t('aiHub.proxy.toasts.saved'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setProxyError(msg);
      appToast.error(t('aiHub.proxy.toasts.saveFailed', { msg }));
    } finally {
      setProxySaving(false);
    }
  }, [proxyDraft, refreshProxyInfo]);

  const handleResetProxyDraft = useCallback(() => {
    if (!proxySettings) return;
    setProxyDraft(proxySettings);
    setProxyError(null);
  }, [proxySettings]);

  const handleStartStopProxy = useCallback(async () => {
    if (proxyBusy) return;
    if (!hasTauriBridge()) {
      appToast.error(t('aiHub.desktopOnly.proxyControlsUnavailable'));
      return;
    }

    setProxyBusy(true);
    setProxyError(null);
    try {
      const next = proxyStatus?.running ? await stopAiProxy() : await startAiProxy();
      setProxyStatus(next);
      await refreshProxyInfo();
      appToast.success(
        proxyStatus?.running ? t('aiHub.proxy.toasts.stopped') : t('aiHub.proxy.toasts.started')
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setProxyError(msg);
      appToast.error(msg);
    } finally {
      setProxyBusy(false);
    }
  }, [proxyBusy, proxyStatus?.running, refreshProxyInfo]);

  const scanAuthFiles = useCallback(async () => {
    if (authScanLoading) return;
    if (!hasTauriBridge()) {
      appToast.error(t('aiHub.desktopOnly.actionUnavailable'));
      return;
    }
    setAuthScanLoading(true);
    try {
      const files = await scanAuthFilesCmd();

      // Compatibility: legacy codex auth files map to OpenAI.
      const normalized = files.map(f =>
        f.provider.toLowerCase() === 'codex' ? { ...f, provider: 'openai' } : f
      );

      setAuthScan(normalized);
      appToast.success(t('aiHub.authScan.found', { count: normalized.length }));
    } catch (e) {
      appToast.error(
        t('aiHub.authScan.failed', { msg: e instanceof Error ? e.message : String(e) })
      );
    } finally {
      setAuthScanLoading(false);
    }
  }, [authScanLoading]);

  const importValidation = useMemo(() => {
    const trimmed = importPayload.trim();
    if (!trimmed) return { isValid: false, error: null as string | null, includeSecrets: false };
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const parsedObject =
        typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
      const version = parsedObject?.version;
      const accountsArr = parsedObject?.accounts;
      const includeSecrets = parsedObject?.includeSecrets === true;
      let error: string | null = null;
      if (!parsedObject) error = t('aiHub.controller.importValidation.payloadMustBeObject');
      else if (typeof version !== 'number' || !Number.isFinite(version)) {
        error = t('aiHub.controller.importValidation.payloadVersionRequired');
      } else if (!Array.isArray(accountsArr)) {
        error = t('aiHub.controller.importValidation.payloadAccountsRequired');
      }
      return { isValid: !error, error, includeSecrets };
    } catch {
      return {
        isValid: false,
        error: t('aiHub.controller.importValidation.invalidJson'),
        includeSecrets: false,
      };
    }
  }, [importPayload]);

  const filteredAccounts = useMemo(() => {
    let filtered = [...accounts];
    if (providerFilter !== 'all') filtered = filtered.filter(a => a.provider === providerFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        a => a.name.toLowerCase().includes(q) || a.provider.toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [accounts, providerFilter, searchQuery]);

  const providerCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0 };
    accounts.forEach(acc => {
      counts.all++;
      counts[acc.provider] = (counts[acc.provider] || 0) + 1;
    });
    return counts;
  }, [accounts]);

  const accountReadiness = useMemo(() => {
    const enabled = accounts.filter(a => a.enabled);
    const totalEnabled = enabled.length;

    let inCooldown = 0;
    let weeklyLimitReached = 0;
    let withQuotaSignal = 0;

    for (const account of enabled) {
      const name = account.name.toLowerCase().trim();
      const quota = openAiAccountQuotasMap[name];
      const meta = account as AiProxyAccount & { cooldownUntil?: number | null };

      if (meta.cooldownUntil && meta.cooldownUntil * 1000 > Date.now()) {
        inCooldown += 1;
      }

      if (quota) {
        withQuotaSignal += 1;
        if ((quota.secondary?.usedPercent ?? 0) >= 100) {
          weeklyLimitReached += 1;
        }
      }
    }

    const ready = Math.max(0, totalEnabled - inCooldown - weeklyLimitReached);
    return {
      enabled: totalEnabled,
      ready,
      inCooldown,
      weeklyLimitReached,
      withQuotaSignal,
    };
  }, [accounts, openAiAccountQuotasMap]);

  const baseUrl = useMemo(() => {
    const port = proxySettings?.proxyPort || proxyStatus?.port;
    if (!port) return 'http://127.0.0.1:—/v1';
    return `http://127.0.0.1:${port}/v1`;
  }, [proxySettings?.proxyPort, proxyStatus?.port]);

  const isProxyDraftDirty = useMemo(() => {
    if (!proxyDraft || !proxySettings) return false;
    return (
      proxyDraft.proxyPort !== proxySettings.proxyPort ||
      proxyDraft.appMode !== proxySettings.appMode ||
      proxyDraft.routingStrategy !== proxySettings.routingStrategy ||
      proxyDraft.managementKey !== proxySettings.managementKey ||
      proxyDraft.autoStart !== proxySettings.autoStart
    );
  }, [proxyDraft, proxySettings]);

  const effectiveExportIncludeSecrets = exportFormat === 'csv' ? false : exportIncludeSecrets;

  useEffect(() => {
    if (exportFormat === 'csv' && exportIncludeSecrets) setExportIncludeSecrets(false);
  }, [exportFormat, exportIncludeSecrets]);

  const handleDelete = useCallback(
    async (id: number) => {
      if (!window.confirm(t('aiHub.controller.confirm.deleteAccount'))) return;
      try {
        await deleteAiProxyAccount(id);
        appToast.success(t('aiHub.controller.toasts.accountDeleted'));
        await fetchAccounts();
      } catch (e) {
        appToast.error(
          t('aiHub.controller.errors.deleteAccountFailed', {
            msg: e instanceof Error ? e.message : String(e),
          })
        );
      }
    },
    [fetchAccounts]
  );

  const handleToggleEnabled = useCallback(
    async (account: AiProxyAccount) => {
      try {
        const updated = { ...account, enabled: !account.enabled };
        await updateAiProxyAccount(updated);
        appToast.success(
          updated.enabled
            ? t('aiHub.controller.toasts.accountEnabled')
            : t('aiHub.controller.toasts.accountDisabled')
        );
        await fetchAccounts();
      } catch (e) {
        appToast.error(
          t('aiHub.controller.errors.updateAccountFailed', {
            msg: e instanceof Error ? e.message : String(e),
          })
        );
      }
    },
    [fetchAccounts]
  );

  const handleDebugMigration = useCallback(async () => {
    try {
      appToast.info(t('aiHub.controller.toasts.migrationRunning'));
      await debugRunAiProxyMigration();
      appToast.success(t('aiHub.controller.toasts.migrationCompleted'));
      await fetchAccounts();
    } catch (e) {
      appToast.error(
        t('aiHub.controller.errors.migrationFailed', {
          msg: e instanceof Error ? e.message : String(e),
        })
      );
    }
  }, [fetchAccounts]);

  const handleTestConnection = useCallback(async (account: AiProxyAccount) => {
    if (!account.id) return;
    setConnectionState(prev => ({ ...prev, [account.id as number]: { status: 'loading' } }));
    try {
      const result = await testProviderConnection(account.provider);
      setConnectionState(prev => ({
        ...prev,
        [account.id as number]: {
          status: result.success ? 'ok' : 'error',
          message: result.message,
        },
      }));
      if (result.success)
        appToast.success(t('aiHub.controller.toasts.connectionOk', { provider: account.provider }));
      else appToast.error(result.message);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setConnectionState(prev => ({
        ...prev,
        [account.id as number]: { status: 'error', message: msg },
      }));
      appToast.error(t('aiHub.controller.errors.connectionTestFailed', { msg }));
    }
  }, []);

  const upsertMapping = useCallback((index: number, patch: Partial<ProviderModelMapping>) => {
    setModelMappings(prev => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }, []);

  const addMapping = useCallback(() => {
    setModelMappings(prev => [...prev, { modelPattern: '', provider: 'openai', modelId: null }]);
  }, []);

  const removeMapping = useCallback((index: number) => {
    setModelMappings(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleSaveMappings = useCallback(async () => {
    try {
      await setProviderModelMappings(modelMappings);
      appToast.success(t('aiHub.controller.toasts.mappingsSaved'));
      return true;
    } catch (e) {
      appToast.error(
        t('aiHub.controller.errors.saveMappingsFailed', {
          msg: e instanceof Error ? e.message : String(e),
        })
      );
      return false;
    }
  }, [modelMappings]);

  const downloadText = useCallback((fileName: string, text: string, mime: string) => {
    try {
      const blob = new Blob([text], { type: mime });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      appToast.success(t('aiHub.controller.toasts.downloadStarted'));
    } catch {
      appToast.error(t('aiHub.controller.errors.downloadFailed'));
    }
  }, []);

  const buildExportFileName = useCallback((format: 'json' | 'csv', includeSecrets: boolean) => {
    const day = new Date().toISOString().split('T')[0];
    const suffix = format === 'csv' ? 'redacted' : includeSecrets ? 'with_secrets' : 'redacted';
    return `ai_proxy_accounts_${suffix}_${day}.${format}`;
  }, []);

  const handleGenerateExport = useCallback(async () => {
    if (!hasTauriBridge()) {
      appToast.error(t('aiHub.desktopOnly.actionUnavailable'));
      return;
    }
    setExportLoading(true);
    try {
      const payload = await exportAiProxyAccountsPayload(
        exportFormat,
        exportFormat === 'csv' ? false : exportIncludeSecrets
      );
      setExportPayload(payload);
      appToast.success(t('aiHub.controller.toasts.exportGenerated'));
    } catch (e) {
      appToast.error(
        t('aiHub.controller.errors.exportFailed', {
          msg: e instanceof Error ? e.message : String(e),
        })
      );
    } finally {
      setExportLoading(false);
    }
  }, [exportFormat, exportIncludeSecrets]);

  const handleImportPayload = useCallback(async () => {
    if (!hasTauriBridge()) {
      appToast.error(t('aiHub.desktopOnly.actionUnavailable'));
      return;
    }
    if (!importPayload.trim()) {
      appToast.error(t('aiHub.controller.errors.importPayloadRequired'));
      return;
    }
    if (!importValidation.isValid) {
      appToast.error(importValidation.error ?? t('aiHub.controller.errors.invalidImportPayload'));
      return;
    }
    const ok = window.confirm(t('aiHub.controller.confirm.importPayload'));
    if (!ok) return;
    setImportLoading(true);
    try {
      const imported = await importAiProxyAccountsPayload(importPayload);
      appToast.success(t('aiHub.controller.toasts.importedAccounts', { count: imported }));
      setImportPayload('');
      setAuthScan(null);
      await fetchAccounts();
    } catch (e) {
      appToast.error(
        t('aiHub.controller.errors.importFailed', {
          msg: e instanceof Error ? e.message : String(e),
        })
      );
    } finally {
      setImportLoading(false);
    }
  }, [fetchAccounts, importPayload, importValidation.error, importValidation.isValid]);

  const handlePrepareImportFromScan = useCallback(() => {
    if (!authScan || authScan.length === 0) {
      appToast.error(t('aiHub.controller.errors.noScanResultsToImport'));
      return;
    }
    const ok = window.confirm(
      t('aiHub.controller.confirm.prepareFromScan', { count: authScan.length })
    );
    if (!ok) return;
    const payload = JSON.stringify(
      {
        version: 1,
        exportedAt: new Date().toISOString(),
        includeSecrets: true,
        accounts: authScan.map(f => {
          const fileTail = f.path.split(/[\\/]/).pop() || 'auth';
          return {
            provider: f.provider,
            name: `${f.provider} (${fileTail})`,
            enabled: true,
            accountType: null,
            oauthToken: f.token,
            apiKey: null,
            sessionToken: null,
          };
        }),
      },
      null,
      2
    );
    setImportPayload(payload);
    appToast.success(t('aiHub.controller.toasts.preparedImportFromScan'));
  }, [authScan]);

  const handleImportAllFromScan = useCallback(async () => {
    if (!authScan || authScan.length === 0) {
      appToast.error(t('aiHub.controller.errors.noScanResultsToImport'));
      return;
    }
    if (!hasTauriBridge()) {
      appToast.error(t('aiHub.desktopOnly.actionUnavailable'));
      return;
    }

    const ok = window.confirm(
      t('aiHub.controller.confirm.importAllFromScan', { count: authScan.length })
    );
    if (!ok) return;

    const payload = JSON.stringify(
      {
        version: 1,
        exportedAt: new Date().toISOString(),
        includeSecrets: true,
        accounts: authScan.map(f => {
          const fileTail = f.path.split(/[\\/]/).pop() || 'auth';
          return {
            provider: f.provider,
            name: `${f.provider} (${fileTail})`,
            enabled: true,
            accountType: null,
            oauthToken: f.token,
            apiKey: null,
            sessionToken: null,
          };
        }),
      },
      null,
      2
    );

    setImportLoading(true);
    try {
      const imported = await importAiProxyAccountsPayload(payload);
      const skipped = Math.max(authScan.length - imported, 0);
      appToast.success(
        skipped > 0
          ? t('aiHub.controller.toasts.importedAccountsWithSkipped', { imported, skipped })
          : t('aiHub.controller.toasts.importedAccounts', { count: imported })
      );
      setImportPayload('');
      setAuthScan(null);
      await fetchAccounts();
    } catch (e) {
      appToast.error(
        t('aiHub.controller.errors.importFailed', {
          msg: e instanceof Error ? e.message : String(e),
        })
      );
    } finally {
      setImportLoading(false);
    }
  }, [authScan, fetchAccounts]);

  useEffect(() => {
    void fetchAccounts();
    void fetchCapabilitiesAndModels();
    void fetchProviderQuotas();
    void fetchHistorySummary();
    void refreshProxyInfo();
  }, [
    fetchAccounts,
    fetchCapabilitiesAndModels,
    fetchProviderQuotas,
    fetchHistorySummary,
    refreshProxyInfo,
  ]);

  return {
    accounts,
    loading,
    setAccounts,
    searchQuery,
    setSearchQuery,
    providerFilter,
    setProviderFilter,
    availableModels,
    providerCapabilities,
    modelMappings,
    setModelMappings,
    proxyStatus,
    proxySettings,
    proxyDraft,
    setProxyDraft,
    proxyBusy,
    proxySaving,
    proxyError,
    authScan,
    authScanLoading,
    connectionState,
    historySummary,
    exportFormat,
    setExportFormat,
    exportIncludeSecrets,
    setExportIncludeSecrets,
    exportPayload,
    exportLoading,
    importPayload,
    setImportPayload,
    importLoading,
    importValidation,
    filteredAccounts,
    providerCounts,
    accountReadiness,
    baseUrl,
    isProxyDraftDirty,
    effectiveExportIncludeSecrets,
    fetchAccounts,
    refreshProxyInfo,
    handleSaveProxySettings,
    handleResetProxyDraft,
    handleStartStopProxy,
    scanAuthFiles,
    handleDelete,
    handleToggleEnabled,
    handleDebugMigration,
    handleTestConnection,
    upsertMapping,
    addMapping,
    removeMapping,
    handleSaveMappings,
    downloadText,
    buildExportFileName,
    handleGenerateExport,
    handleImportPayload,
    handlePrepareImportFromScan,
    handleImportAllFromScan,
  };
}
