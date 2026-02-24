import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Plus,
  Search,
  Zap,
  LayoutGrid,
  Bug,
  Power,
  Copy,
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import Header from '../components/layout/Header';
import AccountCard from '../components/ai-proxy/AccountCard';
import AccountModal from '../components/ai-proxy/AccountModal';
import { QuotaDashboard } from '../components/ai-proxy/QuotaDashboard';
import { IdeConfigWizard } from '../components/ai-proxy/IdeConfigWizard';
import { EmptyState, SkeletonLoader, Button, Modal, Input } from '../components/ui';
import { useAiProxyStore } from '../stores/aiProxy';
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
  exportAiProxyAccountsPayload,
  importAiProxyAccountsPayload,
  scanAuthFiles as scanAuthFilesCmd,
  type ProviderCapability,
  type ProviderModelMapping,
} from '@/lib/tauri/modules/aiProxy';
import type { AiProxyAccount, AuthFile, ProxySettings, ProxyStatus } from '../types/generated';
import { cn } from '../lib/utils';
import { AI_PROXY_PROVIDER_FILTERS } from '../components/ai-proxy/providerMeta';

const CLIENT_API_KEY = 'proxypal-local';

const hasTauriBridge = (): boolean => {
  if (typeof window === 'undefined') return false;
  const w = window as typeof window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: { invoke?: unknown };
  };
  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__?.invoke);
};

const maskKey = (key: string, visibleTail: number = 4): string => {
  if (!key) return '';
  if (key.length <= visibleTail) return '•'.repeat(Math.max(0, key.length));
  return `${'•'.repeat(Math.max(0, key.length - visibleTail))}${key.slice(-visibleTail)}`;
};

export default function AiProviders() {
  const navigate = useNavigate();
  const { accounts, setAccounts, loading, setLoading } = useAiProxyStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AiProxyAccount | null>(null);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; provider: string }>>(
    []
  );
  const [providerCapabilities, setProviderCapabilities] = useState<ProviderCapability[]>([]);
  const [modelMappings, setModelMappings] = useState<ProviderModelMapping[]>([]);
  const [isMappingsModalOpen, setIsMappingsModalOpen] = useState(false);
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null);
  const [proxySettings, setProxySettings] = useState<ProxySettings | null>(null);
  const [proxyBusy, setProxyBusy] = useState(false);
  const [proxyError, setProxyError] = useState<string | null>(null);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferMode, setTransferMode] = useState<'import' | 'export'>('import');
  const [authScan, setAuthScan] = useState<AuthFile[] | null>(null);
  const [authScanLoading, setAuthScanLoading] = useState(false);
  const [isIdeWizardOpen, setIsIdeWizardOpen] = useState(false);
  const [connectionState, setConnectionState] = useState<
    Record<
      number,
      {
        status: 'idle' | 'loading' | 'ok' | 'error';
        message?: string;
      }
    >
  >({});
  const [historySummary, setHistorySummary] = useState({
    total: 0,
    errors: 0,
  });

  const fetchAccounts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getAiProxyAccounts();
      setAccounts(data);
    } catch (e) {
      console.error('[AiProviders] Error fetching accounts:', e);
      toast.error(`Failed to load accounts: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [setAccounts, setLoading]);

  const fetchCapabilitiesAndModels = useCallback(async () => {
    // Models are fetched via sidecar Management API. Use safe wrapper to avoid noisy errors
    // when proxy isn't running or not ready.
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
      // Should be rare since we use the safe wrapper above.
      console.error('[AiProviders] Failed loading models:', modelsResult.reason);
      setAvailableModels([]);
    }

    // Note: model list may legitimately be empty if proxy isn't running.

    if (capabilitiesResult.status === 'fulfilled') {
      setProviderCapabilities(capabilitiesResult.value);
    } else {
      console.error('[AiProviders] Failed loading capabilities:', capabilitiesResult.reason);
      setProviderCapabilities([]);
    }

    if (mappingsResult.status === 'fulfilled') {
      setModelMappings(mappingsResult.value);
    } else {
      console.error('[AiProviders] Failed loading mappings:', mappingsResult.reason);
      setModelMappings([]);
    }

    const failedParts = [
      modelsResult.status === 'rejected' ? 'models' : null,
      capabilitiesResult.status === 'rejected' ? 'capabilities' : null,
      mappingsResult.status === 'rejected' ? 'mappings' : null,
    ].filter(Boolean);

    if (failedParts.length > 0) {
      // Avoid spamming users for models if proxy is stopped; the safe wrapper should already
      // suppress common management API failures.
      const toastParts = failedParts.filter(p => p !== 'models');
      if (toastParts.length > 0) {
        toast.error(`Failed to load AI Proxy data: ${toastParts.join(', ')}`);
      }
    }
  }, []);

  const fetchHistorySummary = useCallback(async () => {
    try {
      const rows = await getRequestHistory(20, 0);
      setHistorySummary({
        total: rows.length,
        errors: rows.filter(r => r.status >= 400).length,
      });
    } catch (e) {
      console.error('[AiProviders] Failed loading request history summary:', e);
    }
  }, []);

  const refreshProxyInfo = useCallback(async () => {
    // Avoid hard failing in tests / non-tauri environments.
    if (!hasTauriBridge()) {
      setProxyStatus(null);
      setProxySettings(null);
      setProxyError(null);
      return;
    }

    try {
      setProxyError(null);
      const [status, settings] = await Promise.all([getProxyStatus(), getProxySettings()]);
      setProxyStatus(status);
      setProxySettings(settings);
    } catch (e) {
      console.error('[AiProviders] Failed loading proxy status/settings:', e);
      setProxyError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const baseUrl = useMemo(() => {
    const port = proxySettings?.proxyPort || proxyStatus?.port;
    if (!port) return 'http://127.0.0.1:—/v1';
    return `http://127.0.0.1:${port}/v1`;
  }, [proxySettings?.proxyPort, proxyStatus?.port]);

  const handleCopy = useCallback(async (label: string, value: string, requireConfirm = false) => {
    if (!value) {
      toast.error('Nothing to copy');
      return;
    }

    if (requireConfirm) {
      const ok = window.confirm(
        `Copy ${label} to clipboard? This is sensitive and may be visible to other apps.`
      );
      if (!ok) return;
    }

    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch (e) {
      console.error('[AiProviders] Copy failed:', e);
      toast.error(`Failed to copy ${label}`);
    }
  }, []);

  const handleStartStopProxy = useCallback(async () => {
    if (proxyBusy) return;
    if (!hasTauriBridge()) {
      toast.error('Proxy controls are unavailable outside Tauri');
      return;
    }

    setProxyBusy(true);
    setProxyError(null);
    try {
      const next = proxyStatus?.running ? await stopAiProxy() : await startAiProxy();
      setProxyStatus(next);
      // Port can change if occupied; always re-read settings.
      await refreshProxyInfo();
      toast.success(proxyStatus?.running ? 'Proxy stopped' : 'Proxy started');
    } catch (e) {
      console.error('[AiProviders] Proxy start/stop failed:', e);
      const msg = e instanceof Error ? e.message : String(e);
      setProxyError(msg);
      toast.error(msg);
    } finally {
      setProxyBusy(false);
    }
  }, [proxyBusy, proxyStatus?.running, refreshProxyInfo]);

  const scanAuthFiles = useCallback(async () => {
    if (authScanLoading) return;
    if (!hasTauriBridge()) {
      toast.error('This action is only available in the desktop app');
      return;
    }

    setAuthScanLoading(true);
    try {
      const files = await scanAuthFilesCmd();
      setAuthScan(files);
      toast.success(`Found ${files.length} auth file${files.length === 1 ? '' : 's'}`);
    } catch (e) {
      console.error('[AiProviders] Failed scanning auth files:', e);
      toast.error(`Scan failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAuthScanLoading(false);
    }
  }, [authScanLoading]);

  const downloadText = useCallback((fileName: string, text: string, mime: string) => {
    try {
      const blob = new Blob([text], { type: mime });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      link.click();
      toast.success('Download started');
    } catch (e) {
      console.error('[AiProviders] Download failed:', e);
      toast.error('Failed to download');
    }
  }, []);

  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('json');
  const [exportIncludeSecrets, setExportIncludeSecrets] = useState(false);
  const [exportPayload, setExportPayload] = useState<string>('');
  const [exportLoading, setExportLoading] = useState(false);
  const effectiveExportIncludeSecrets = exportFormat === 'csv' ? false : exportIncludeSecrets;

  useEffect(() => {
    if (exportFormat === 'csv' && exportIncludeSecrets) {
      setExportIncludeSecrets(false);
    }
  }, [exportFormat, exportIncludeSecrets]);

  const buildExportFileName = useCallback((format: 'json' | 'csv', includeSecrets: boolean) => {
    const day = new Date().toISOString().split('T')[0];
    const suffix = format === 'csv' ? 'redacted' : includeSecrets ? 'with_secrets' : 'redacted';
    return `ai_proxy_accounts_${suffix}_${day}.${format}`;
  }, []);

  const handleGenerateExport = useCallback(async () => {
    if (!hasTauriBridge()) {
      toast.error('This action is only available in the desktop app');
      return;
    }
    setExportLoading(true);
    try {
      const payload = await exportAiProxyAccountsPayload(
        exportFormat,
        exportFormat === 'csv' ? false : exportIncludeSecrets
      );
      setExportPayload(payload);
      toast.success('Export generated');
    } catch (e) {
      console.error('[AiProviders] Export failed:', e);
      toast.error(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExportLoading(false);
    }
  }, [exportFormat, exportIncludeSecrets]);

  const [importPayload, setImportPayload] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const importValidation = useMemo(() => {
    const trimmed = importPayload.trim();
    if (!trimmed) {
      return { isValid: false, error: null as string | null, includeSecrets: false };
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const parsedObject =
        typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
      const version = parsedObject?.version;
      const accounts = parsedObject?.accounts;
      const includeSecrets = parsedObject?.includeSecrets === true;

      let error: string | null = null;
      if (!parsedObject) {
        error = 'Payload must be a JSON object.';
      } else if (typeof version !== 'number' || !Number.isFinite(version)) {
        error = 'Payload must include a numeric version.';
      } else if (!Array.isArray(accounts)) {
        error = 'Payload must include an accounts array.';
      }

      return { isValid: !error, error, includeSecrets };
    } catch {
      return {
        isValid: false,
        error: 'Invalid JSON. Check for syntax errors.',
        includeSecrets: false,
      };
    }
  }, [importPayload]);

  const handleImportPayload = useCallback(async () => {
    if (!hasTauriBridge()) {
      toast.error('This action is only available in the desktop app');
      return;
    }
    if (!importPayload.trim()) {
      toast.error('Paste JSON payload first');
      return;
    }
    if (!importValidation.isValid) {
      toast.error(importValidation.error ?? 'Invalid import payload');
      return;
    }

    const ok = window.confirm(
      'Import accounts from payload? This may create duplicates. Continue?'
    );
    if (!ok) return;

    setImportLoading(true);
    try {
      const imported = await importAiProxyAccountsPayload(importPayload);
      toast.success(`Imported ${imported} account(s)`);
      setImportPayload('');
      setAuthScan(null);
      await fetchAccounts();
    } catch (e) {
      console.error('[AiProviders] Import failed:', e);
      toast.error(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImportLoading(false);
    }
  }, [fetchAccounts, importPayload, importValidation.error, importValidation.isValid]);

  const handlePrepareImportFromScan = useCallback(() => {
    if (!authScan || authScan.length === 0) {
      toast.error('No scan results to import');
      return;
    }

    const ok = window.confirm(
      `Prepare import payload from ${authScan.length} scanned credential(s)? You'll be able to review before importing.`
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
    toast.success('Prepared import JSON from scan (review then import)');
  }, [authScan]);

  useEffect(() => {
    fetchAccounts();
    fetchCapabilitiesAndModels();
    fetchHistorySummary();
    refreshProxyInfo();
  }, [fetchAccounts, fetchCapabilitiesAndModels, fetchHistorySummary, refreshProxyInfo]);

  const providerCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0 };
    accounts.forEach(acc => {
      counts.all++;
      counts[acc.provider] = (counts[acc.provider] || 0) + 1;
    });
    return counts;
  }, [accounts]);

  const filteredAccounts = useMemo(() => {
    let filtered = [...accounts];

    if (providerFilter !== 'all') {
      filtered = filtered.filter(a => a.provider === providerFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        a => a.name.toLowerCase().includes(q) || a.provider.toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [accounts, providerFilter, searchQuery]);

  const handleDelete = useCallback(
    async (id: number) => {
      if (!window.confirm('Are you sure you want to delete this account?')) {
        return;
      }

      try {
        await deleteAiProxyAccount(id);
        toast.success('Account deleted successfully');
        await fetchAccounts();
      } catch (e) {
        console.error('[AiProviders] Error deleting account:', e);
        toast.error(`Failed to delete account: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [fetchAccounts]
  );

  const handleToggleEnabled = useCallback(
    async (account: AiProxyAccount) => {
      try {
        const updated = { ...account, enabled: !account.enabled };
        await updateAiProxyAccount(updated);
        toast.success(`Account ${updated.enabled ? 'enabled' : 'disabled'}`);
        await fetchAccounts();
      } catch (e) {
        console.error('[AiProviders] Error toggling account:', e);
        toast.error(`Failed to update account: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [fetchAccounts]
  );

  const handleEdit = useCallback((account: AiProxyAccount) => {
    setEditingAccount(account);
    setIsModalOpen(true);
  }, []);

  const handleAddNew = useCallback(() => {
    setEditingAccount(null);
    setIsModalOpen(true);
  }, []);

  const handleModalClose = useCallback(() => {
    setIsModalOpen(false);
    setEditingAccount(null);
  }, []);

  const handleModalSubmit = useCallback(async () => {
    await fetchAccounts();
    handleModalClose();
  }, [fetchAccounts, handleModalClose]);

  const handleDebugMigration = useCallback(async () => {
    try {
      toast.info('Running migration...');
      const result = await debugRunAiProxyMigration();
      console.log('[Debug Migration]', result);
      toast.success('Migration completed! Check console for details.');
      await fetchAccounts();
    } catch (e) {
      console.error('[Debug Migration] Error:', e);
      toast.error(`Migration failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [fetchAccounts]);

  const handleTestConnection = useCallback(async (account: AiProxyAccount) => {
    if (!account.id) return;

    setConnectionState(prev => ({
      ...prev,
      [account.id as number]: { status: 'loading' },
    }));

    try {
      const result = await testProviderConnection(account.provider);
      setConnectionState(prev => ({
        ...prev,
        [account.id as number]: {
          status: result.success ? 'ok' : 'error',
          message: result.message,
        },
      }));
      if (result.success) {
        toast.success(`${account.provider} connection OK`);
      } else {
        toast.error(result.message);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setConnectionState(prev => ({
        ...prev,
        [account.id as number]: { status: 'error', message: msg },
      }));
      toast.error(`Connection test failed: ${msg}`);
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
      toast.success('Provider model mappings saved');
      setIsMappingsModalOpen(false);
    } catch (e) {
      toast.error(`Failed to save mappings: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [modelMappings]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#050508]">
      <Header title="AI Providers" icon={<Zap size={18} />} />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Filter Panel */}
        <aside className="w-[200px] lg:w-[220px] shrink-0 bg-[#111116]/50 backdrop-blur-md border-r border-white/5 flex flex-col overflow-hidden hidden md:flex">
          <div className="p-3 flex-1 overflow-y-auto">
            <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 px-2">
              Providers
            </h3>
            <div className="space-y-0.5 mb-6">
              {AI_PROXY_PROVIDER_FILTERS.map(provider => (
                <button
                  key={provider.id}
                  onClick={() => setProviderFilter(provider.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors duration-150 relative',
                    providerFilter === provider.id
                      ? 'bg-indigo-500/15 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  )}
                >
                  {providerFilter === provider.id && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-indigo-500 rounded-r shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
                  )}
                  <LayoutGrid size={16} className="shrink-0 ml-2" />
                  <span className="flex-1 text-left">{provider.label}</span>
                  {providerCounts[provider.id] > 0 && (
                    <span className="text-xs text-slate-400 font-medium tabular-nums">
                      {providerCounts[provider.id]}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Quota Dashboard */}
            <div className="mt-auto pt-4 border-t border-white/5">
              <QuotaDashboard />
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header Bar */}
          <div className="shrink-0 flex items-center justify-between gap-4 px-6 py-4 border-b border-white/5 bg-[#0a0a0c]/80 backdrop-blur-xl">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div className="relative group flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-400 transition-colors" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full h-9 bg-black/40 rounded-lg pl-10 pr-4 text-sm text-white border border-white/10 focus:border-indigo-500/50 focus:bg-black/60 outline-none transition-colors placeholder-slate-400"
                  placeholder="Search accounts..."
                />
              </div>
            </div>

            <div className="hidden xl:flex items-center gap-2 px-3 py-2 rounded-lg bg-black/30 border border-white/10 whitespace-nowrap">
              <div
                className={cn(
                  'w-2 h-2 rounded-full',
                  proxyStatus?.running ? 'bg-emerald-400' : 'bg-slate-500'
                )}
              />
              <span className="text-xs text-slate-300">Proxy</span>
              <span className="text-xs text-slate-500">•</span>
              <span className="text-xs text-slate-400 tabular-nums">
                {proxyStatus?.running ? `Running :${proxyStatus.port}` : 'Stopped'}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                onClick={handleAddNew}
                variant="primary"
                size="sm"
                leftIcon={<Plus size={18} />}
              >
                Add Account
              </Button>

              <Button
                onClick={() => {
                  setTransferMode('import');
                  setIsTransferModalOpen(true);
                }}
                variant="secondary"
                size="sm"
                leftIcon={<ArrowDownToLine size={16} />}
              >
                Import
              </Button>

              <Button
                onClick={() => {
                  setTransferMode('export');
                  setIsTransferModalOpen(true);
                }}
                variant="secondary"
                size="sm"
                leftIcon={<ArrowUpFromLine size={16} />}
              >
                Export
              </Button>

              <Button
                onClick={handleDebugMigration}
                variant="secondary"
                size="sm"
                leftIcon={<Bug size={18} />}
              >
                Debug: Run Migration
              </Button>

              <Button variant="secondary" size="sm" onClick={() => navigate('/api-keys')}>
                API Keys
              </Button>
              <Button variant="secondary" size="sm" onClick={() => navigate('/chat')}>
                Chat
              </Button>
              <Button variant="secondary" size="sm" onClick={() => navigate('/ai-analytics')}>
                Analytics
              </Button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto p-6">
            {/* Proxy Controls */}
            <div className="mb-4 bg-[#111116]/80 border border-white/10 rounded-xl p-4 md:p-6">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Power
                      size={16}
                      className={proxyStatus?.running ? 'text-emerald-400' : 'text-slate-500'}
                    />
                    <h3 className="text-sm font-semibold text-white">IDE Proxy</h3>
                    <span
                      className={cn(
                        'text-2xs px-2 py-0.5 rounded border',
                        proxyStatus?.running
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                          : 'bg-white/5 border-white/10 text-slate-400'
                      )}
                    >
                      {proxyStatus?.running ? 'Running' : 'Stopped'}
                    </span>
                    {proxySettings?.appMode && (
                      <span className="text-2xs px-2 py-0.5 rounded border border-white/10 bg-white/5 text-slate-300">
                        Mode: {proxySettings.appMode}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="flex items-center justify-between gap-2 bg-black/30 border border-white/10 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500">
                          Base URL
                        </div>
                        <div className="text-xs font-mono text-slate-200 truncate max-w-[240px]">
                          {baseUrl}
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => handleCopy('Base URL', baseUrl)}
                        leftIcon={<Copy size={14} />}
                      >
                        Copy
                      </Button>
                    </div>

                    <div className="flex items-center justify-between gap-2 bg-black/30 border border-white/10 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500">
                          Client API key
                        </div>
                        <div className="text-xs font-mono text-slate-200 truncate max-w-[240px]">
                          {CLIENT_API_KEY}
                        </div>
                      </div>
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => handleCopy('Client API key', CLIENT_API_KEY)}
                        leftIcon={<Copy size={14} />}
                      >
                        Copy
                      </Button>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="tabular-nums">
                      Port:{' '}
                      <span className="text-slate-200">
                        {proxySettings?.proxyPort ?? proxyStatus?.port ?? '—'}
                      </span>
                    </span>
                    <span className="text-slate-600">•</span>
                    <span className="min-w-0">
                      Management key:{' '}
                      <span className="font-mono text-slate-200 truncate max-w-[180px] inline-block align-middle">
                        {proxySettings?.managementKey ? maskKey(proxySettings.managementKey) : '—'}
                      </span>
                    </span>
                    {proxySettings?.managementKey && (
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() =>
                          handleCopy('Management key', proxySettings.managementKey, true)
                        }
                        leftIcon={<Copy size={14} />}
                      >
                        Copy
                      </Button>
                    )}
                  </div>
                  {proxyError && (
                    <div className="mt-2 text-xs text-red-400">Proxy error: {proxyError}</div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Button variant="secondary" size="sm" onClick={() => setIsIdeWizardOpen(true)}>
                    Configure IDE/CLI
                  </Button>
                  <Button
                    variant={proxyStatus?.running ? 'danger' : 'primary'}
                    size="sm"
                    onClick={handleStartStopProxy}
                    disabled={proxyBusy}
                    leftIcon={<Power size={16} />}
                  >
                    {proxyBusy ? 'Working...' : proxyStatus?.running ? 'Stop Proxy' : 'Start Proxy'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={refreshProxyInfo}
                    disabled={proxyBusy}
                    leftIcon={<RefreshCw size={16} />}
                  >
                    Refresh
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
              <div className="bg-[#111116]/80 border border-white/10 rounded-xl p-4 md:p-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-white">Available Models</h3>
                  <span className="text-xs text-slate-400">{availableModels.length}</span>
                </div>
                <div className="space-y-1 max-h-40 overflow-auto pr-1 min-h-[120px]">
                  {availableModels.slice(0, 20).map(m => (
                    <div
                      key={m.id}
                      className="text-xs text-slate-300 flex items-center justify-between gap-2"
                    >
                      <span className="truncate">{m.id}</span>
                      <span className="text-slate-500 capitalize shrink-0">{m.provider}</span>
                    </div>
                  ))}
                  {availableModels.length === 0 && (
                    <div className="text-xs text-slate-500">No models available</div>
                  )}
                </div>
              </div>

              <div className="bg-[#111116]/80 border border-white/10 rounded-xl p-4 md:p-6">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h3 className="text-sm font-semibold text-white">Provider Capabilities</h3>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => setIsMappingsModalOpen(true)}
                  >
                    Edit mappings
                  </Button>
                </div>
                <div className="space-y-2 min-h-[120px]">
                  {providerCapabilities.map(c => (
                    <div
                      key={c.provider}
                      className="text-xs text-slate-300 flex items-center justify-between gap-3"
                    >
                      <span className="capitalize">{c.provider}</span>
                      <span className="text-slate-400 font-mono tabular-nums whitespace-nowrap">
                        {c.enabledAccounts} active / {c.totalAccounts} acc / {c.totalApiKeys} keys
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[#111116]/80 border border-white/10 rounded-xl p-4 md:p-6">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h3 className="text-sm font-semibold text-white">Recent Request History</h3>
                  <Button variant="secondary" size="xs" onClick={() => navigate('/ai-analytics')}>
                    Open
                  </Button>
                </div>
                <div className="space-y-3 text-xs min-h-[120px]">
                  <div className="flex items-center justify-between text-slate-300">
                    <span>Last 20 requests</span>
                    <span className="text-white font-medium">{historySummary.total}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-300">
                    <span>Errors</span>
                    <span
                      className={cn(
                        'font-medium',
                        historySummary.errors > 0 ? 'text-red-400' : 'text-emerald-400'
                      )}
                    >
                      {historySummary.errors}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {loading && filteredAccounts.length === 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <SkeletonLoader variant="card" count={6} />
              </div>
            ) : filteredAccounts.length === 0 ? (
              <EmptyState
                icon={Zap}
                title="No AI provider accounts found"
                description={
                  searchQuery || providerFilter !== 'all'
                    ? 'Try adjusting your filters'
                    : 'Add your first AI provider account to get started'
                }
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredAccounts.map(account => (
                  <div
                    key={account.id ?? `${account.provider}:${account.name}`}
                    className="space-y-2"
                  >
                    <AccountCard
                      account={account}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      onToggleEnabled={handleToggleEnabled}
                      onTestConnection={handleTestConnection}
                      connectionTestStatus={
                        account.id ? connectionState[account.id]?.status || 'idle' : 'idle'
                      }
                      connectionTestMessage={
                        account.id ? connectionState[account.id]?.message : undefined
                      }
                    />

                    {/* MVP status chips (graceful fallback) */}
                    <div className="px-1 flex flex-wrap gap-1.5">
                      <span className="text-2xs px-2 py-0.5 rounded border border-white/10 bg-black/30 text-slate-300">
                        Refresh: <span className="text-slate-400">Unknown</span>
                      </span>
                      <span className="text-2xs px-2 py-0.5 rounded border border-white/10 bg-black/30 text-slate-300">
                        Cooldown: <span className="text-slate-400">Unknown</span>
                      </span>
                      <span className="text-2xs px-2 py-0.5 rounded border border-white/10 bg-black/30 text-slate-300">
                        Quota: <span className="text-slate-400">Unknown</span>
                      </span>
                      {(account as any).oauthExpiresAt ? (
                        <span className="text-2xs px-2 py-0.5 rounded border border-white/10 bg-black/30 text-slate-300">
                          OAuth exp:{' '}
                          <span className="text-slate-400">
                            {new Date(
                              ((account as any).oauthExpiresAt as number) * 1000
                            ).toLocaleString()}
                          </span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        title={transferMode === 'import' ? 'Import AI Proxy Accounts' : 'Export AI Proxy Accounts'}
        size="lg"
        footer={
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400">
              Exports are redacted by default. Enabling “include secrets” exports tokens in
              plaintext.
            </div>
            <Button variant="secondary" onClick={() => setIsTransferModalOpen(false)}>
              Close
            </Button>
          </div>
        }
      >
        {transferMode === 'import' ? (
          <div className="space-y-4">
            <div className="bg-black/30 border border-white/10 rounded-lg p-3">
              <div className="text-sm text-white font-medium">Import</div>
              <div className="text-xs text-slate-400 mt-1">
                You can import from scanned auth files (legacy locations) or paste an export JSON
                payload.
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={scanAuthFiles}
                  disabled={authScanLoading}
                  leftIcon={<RefreshCw size={16} />}
                >
                  {authScanLoading ? 'Scanning...' : 'Scan auth files'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handlePrepareImportFromScan}
                  disabled={!authScan || authScan.length === 0}
                >
                  Prepare JSON from scan
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleImportPayload}
                  disabled={importLoading || !importValidation.isValid}
                >
                  {importLoading ? 'Importing…' : 'Import JSON'}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-slate-400">Import payload (JSON)</div>
              <textarea
                value={importPayload}
                onChange={e => setImportPayload(e.target.value)}
                className="w-full min-h-[140px] rounded-lg bg-black/30 border border-white/10 p-3 text-xs font-mono text-slate-200 outline-none focus:border-indigo-500/50"
                placeholder="Paste export JSON here…"
              />
              {importValidation.error && (
                <div className="text-xs text-red-400">{importValidation.error}</div>
              )}
            </div>

            {importValidation.includeSecrets && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
                <div className="font-medium text-amber-200">Warning</div>
                <div className="mt-1 text-amber-200/80">
                  This payload includes secrets (tokens/keys). Importing will store them locally.
                </div>
              </div>
            )}

            {authScan && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-white">
                    Scan results <span className="text-slate-400">({authScan.length})</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => handleCopy('Scan report', JSON.stringify(authScan, null, 2))}
                    leftIcon={<Copy size={14} />}
                  >
                    Copy JSON
                  </Button>
                </div>
                {authScan.length === 0 ? (
                  <div className="text-xs text-slate-400">No auth files found.</div>
                ) : (
                  <div className="max-h-64 overflow-auto pr-1 space-y-1">
                    {authScan.map((f, idx) => (
                      <div
                        key={`${f.provider}-${f.path}-${idx}`}
                        className="text-xs text-slate-300 bg-white/5 border border-white/10 rounded-lg px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="capitalize text-white">{f.provider}</span>
                          <span className="text-slate-500 tabular-nums">
                            {f.expiresAt
                              ? `exp ${new Date(f.expiresAt * 1000).toLocaleDateString()}`
                              : 'no expiry'}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 break-all mt-1">
                          {f.path}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-3">
              <div>
                <div className="text-sm text-white font-medium">Export</div>
                <div className="text-xs text-slate-400 mt-1">
                  By default exports are redacted. Enabling “include secrets” will export tokens in
                  plaintext.
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={exportFormat}
                  onChange={e => setExportFormat(e.target.value as any)}
                  className="h-9 rounded-lg bg-white/[0.03] border border-white/10 px-2 text-sm text-slate-200"
                >
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                </select>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={exportIncludeSecrets}
                    disabled={exportFormat === 'csv'}
                    onChange={e => {
                      const next = e.target.checked;
                      if (next) {
                        const ok = window.confirm(
                          'Including secrets will export tokens/keys in plaintext. Continue?'
                        );
                        if (!ok) return;
                      }
                      setExportIncludeSecrets(next);
                    }}
                  />
                  Include secrets
                </label>
                {exportFormat === 'csv' && (
                  <span className="text-xs text-slate-500">CSV export never includes secrets.</span>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleGenerateExport}
                  disabled={exportLoading}
                >
                  {exportLoading ? 'Generating…' : 'Generate'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!exportPayload}
                  onClick={() =>
                    downloadText(
                      buildExportFileName(exportFormat, effectiveExportIncludeSecrets),
                      exportPayload,
                      exportFormat === 'csv' ? 'text/csv' : 'application/json'
                    )
                  }
                >
                  Download
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!exportPayload}
                  onClick={() =>
                    handleCopy('Export payload', exportPayload, effectiveExportIncludeSecrets)
                  }
                  leftIcon={<Copy size={16} />}
                >
                  Copy
                </Button>
              </div>

              <div className="rounded-lg border border-white/10 bg-black/20 p-3 max-h-64 overflow-auto">
                {exportPayload ? (
                  <pre className="text-[11px] text-slate-300 whitespace-pre-wrap break-words">
                    {exportPayload}
                  </pre>
                ) : (
                  <div className="text-xs text-slate-500">Generate an export to view payload.</div>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={isMappingsModalOpen}
        onClose={() => setIsMappingsModalOpen(false)}
        title="Provider Model Mappings"
        size="lg"
        footer={
          <div className="flex items-center justify-between">
            <Button variant="secondary" onClick={addMapping}>
              Add mapping
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setIsMappingsModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleSaveMappings}>
                Save
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          {modelMappings.length === 0 ? (
            <p className="text-sm text-slate-400">No mappings configured</p>
          ) : (
            modelMappings.map((mapping, index) => (
              <div
                key={`${mapping.modelPattern}-${index}`}
                className="grid grid-cols-12 gap-2 items-center"
              >
                <div className="col-span-5">
                  <Input
                    value={mapping.modelPattern}
                    onChange={e => upsertMapping(index, { modelPattern: e.target.value })}
                    placeholder="^gpt-"
                  />
                </div>
                <div className="col-span-3">
                  <select
                    className="w-full h-9 rounded-lg bg-white/[0.03] border border-white/10 px-2 text-sm text-slate-200"
                    value={mapping.provider}
                    onChange={e => upsertMapping(index, { provider: e.target.value })}
                  >
                    {AI_PROXY_PROVIDER_FILTERS.filter(p => p.id !== 'all').map(p => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3">
                  <Input
                    value={mapping.modelId || ''}
                    onChange={e => upsertMapping(index, { modelId: e.target.value || null })}
                    placeholder="target model id"
                  />
                </div>
                <div className="col-span-1 flex justify-end">
                  <Button variant="danger" size="xs" onClick={() => removeMapping(index)}>
                    Del
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>

      <AccountModal
        isOpen={isModalOpen}
        account={editingAccount}
        onClose={handleModalClose}
        onSubmit={handleModalSubmit}
      />

      <IdeConfigWizard isOpen={isIdeWizardOpen} onClose={() => setIsIdeWizardOpen(false)} />
    </div>
  );
}
