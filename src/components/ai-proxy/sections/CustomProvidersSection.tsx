import { useState, useCallback, useEffect, useRef } from 'react';
import { t } from '@/lib/i18n';
import { Plus, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { BulkAddDrawer } from '@/components/api-keys/BulkAddDrawer';
import { QuickAddProvider } from '@/components/api-keys/QuickAddProvider';
import { ProviderCard } from '@/components/api-keys/ProviderCard';
import { MetricsSummaryDisplay } from '@/components/api-keys/MetricsSummaryDisplay';
import { getHealthSummary } from '@/components/api-keys/KeyHealthBadge';
import { parseProviderText } from '@/lib/utils/parseProviderText';
import { testOpenCodeApi } from '@/lib/backend/modules/opencodeConfig';
import type { BulkTestKeyResult } from '@/lib/backend/modules/opencodeConfig';
import type { CustomProvider } from '@/lib/backend/modules/customProviders';
import * as customProviders from '@/lib/backend/modules/customProviders';
import type { ApiKeyEntry } from '@/types/apiKeys';
import type { KeyHealthRecord, KeyHealthResponse } from '@/lib/backend/modules/keyHealth';
import * as keyHealth from '@/lib/backend/modules/keyHealth';
import { Button, GlassCard, Toggle } from '@/components/ui';

type SharedApiKey = {
  apiKey: string;
  baseUrl?: string | null;
  prefix?: string | null;
  customHeaders?: string | null;
};

// ── Health Summary Bar ─────────────────────────────────────────────────
const HealthSummaryBar = ({ records }: { records: KeyHealthRecord[] }) => {
  const summary = getHealthSummary(records);
  return (
    <GlassCard className="p-3">
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-slate-400 font-medium">{t('aiHub.keyHealth')}</span>
        {summary.healthy > 0 && (
          <span className="inline-flex items-center gap-1 text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            {t('aiHub.healthHealthy', { count: summary.healthy })}
          </span>
        )}
        {summary.flaky > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            {t('aiHub.healthFlaky', { count: summary.flaky })}
          </span>
        )}
        {summary.broken > 0 && (
          <span className="inline-flex items-center gap-1 text-red-400">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
            {t('aiHub.healthBroken', { count: summary.broken })}
          </span>
        )}
        {summary.expired > 0 && (
          <span className="inline-flex items-center gap-1 text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            {t('aiHub.healthExpired', { count: summary.expired })}
          </span>
        )}
        {summary.unknown > 0 && (
          <span className="inline-flex items-center gap-1 text-slate-500">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
            {t('aiHub.healthUnknown', { count: summary.unknown })}
          </span>
        )}
        {summary.total === 0 && (
          <span className="text-slate-500">{t('aiHub.noData')}</span>
        )}
      </div>
    </GlassCard>
  );
};

export function CustomProvidersSection() {
  const [customProvidersList, setCustomProvidersList] = useState<CustomProvider[]>([]);
  const [selectedCustomProvider, setSelectedCustomProvider] = useState<string | null>(null);
  const [customProviderKeys, setCustomProviderKeys] = useState<Record<string, SharedApiKey[]>>({});
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isBulkDrawerOpen, setIsBulkDrawerOpen] = useState(false);
  const [isCreateProviderDrawerOpen, setIsCreateProviderDrawerOpen] = useState(false);
  const [isRetestingAll, setIsRetestingAll] = useState(false);
  const [prefillKeys, setPrefillKeys] = useState<string[]>([]);
  const [healthData, setHealthData] = useState<KeyHealthResponse | null>(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadCustomProviders() {
    try {
      const providers = await customProviders.getCustomProviders();
      setCustomProvidersList(providers);

      // Fetch persisted keys for every provider in parallel. A failure for
      // one provider must not block the others from loading their keys.
      const results = await Promise.allSettled(
        providers.map(async (provider) => {
          const rawKeys = await customProviders.getCustomProviderKeys(provider.id);
          const normalized: SharedApiKey[] = rawKeys.map(k => ({
            apiKey: k.apiKey,
            baseUrl: k.baseUrl ?? null,
            prefix: k.prefix ?? null,
            customHeaders: null,
          }));
          return { providerId: provider.id, keys: normalized };
        })
      );

      const keysByProvider: Record<string, SharedApiKey[]> = {};
      for (const result of results) {
        if (result.status === 'fulfilled') {
          keysByProvider[result.value.providerId] = result.value.keys;
        }
      }
      setCustomProviderKeys(prev => ({ ...prev, ...keysByProvider }));
    } catch {
      // Custom providers may not be available yet
    }
  }

  useEffect(() => {
    queueMicrotask(() => void loadCustomProviders());
  }, []);

  const loadHealthData = useCallback(async () => {
    try {
      const data = await keyHealth.getKeyHealth();
      setHealthData(data);
    } catch {
      // Health data may not be available yet
    }
  }, []);

  // Load health data on mount
  useEffect(() => {
    queueMicrotask(() => {
    loadHealthData();
    });
  }, [loadHealthData]);

  // Auto-refresh health data
  useEffect(() => {
    if (autoRefreshEnabled) {
      refreshTimerRef.current = setInterval(loadHealthData, 30_000);
      // Persist setting
      keyHealth.updateKeyHealthSettings({ enabled: true, interval_seconds: 30 }).catch(() => {});
    } else {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      keyHealth.updateKeyHealthSettings({ enabled: false, interval_seconds: 30 }).catch(() => {});
    }
    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [autoRefreshEnabled, loadHealthData]);

  const toggleAutoRefresh = useCallback((checked: boolean) => {
    setAutoRefreshEnabled(checked);
  }, []);

  const handleRemoveProvider = async (providerId: string) => {
    try {
      await customProviders.removeCustomProvider(providerId);
      setCustomProvidersList(prev => prev.filter(p => p.id !== providerId));
      if (selectedCustomProvider === providerId) {
        setSelectedCustomProvider(null);
        setCustomProviderKeys(prev => {
          const next = { ...prev };
          delete next[providerId];
          return next;
        });
      }
      toast.success('Custom provider removed');
    } catch (error) {
      toast.error(`Failed to remove provider: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleTestKey = useCallback(async (entry: ApiKeyEntry) => {
    if (!selectedCustomProvider) return;
    try {
      const provider = customProvidersList.find(p => p.id === selectedCustomProvider);
      const baseUrl = provider?.base_url || '';
      const result = await testOpenCodeApi(entry.baseUrl || baseUrl, entry.key);
      const updated: ApiKeyEntry = {
        ...entry,
        lastTested: Date.now(),
        status: result.success ? 'ok' : 'invalid',
        models: result.models?.map(m => m.id),
        lastError: result.error,
      };
      const keys = customProviderKeys[selectedCustomProvider] || [];
      const nextKeys = keys.map(k => k.apiKey === entry.key ? { ...k, apiKey: updated.key } : k);
      await customProviders.setCustomProviderKeys(selectedCustomProvider, nextKeys);
      setCustomProviderKeys(prev => ({ ...prev, [selectedCustomProvider]: nextKeys }));
      toast.success(result.success ? t('aiHub.keyValid') : t('aiHub.keyInvalid'));
    } catch {
      toast.error(t('aiHub.testFailed'));
    }
  }, [selectedCustomProvider, customProvidersList, customProviderKeys]);

  const handleDeleteKey = useCallback(async (entry: ApiKeyEntry) => {
    if (!selectedCustomProvider) return;
    const keys = customProviderKeys[selectedCustomProvider] || [];
    const updated = keys.filter(k => k.apiKey !== entry.key);
    await customProviders.setCustomProviderKeys(selectedCustomProvider, updated);
    setCustomProviderKeys(prev => ({ ...prev, [selectedCustomProvider]: updated }));
    toast.success('Key deleted');
  }, [selectedCustomProvider, customProviderKeys]);

  const handleCopyKey = useCallback((entry: ApiKeyEntry) => {
    navigator.clipboard.writeText(entry.key);
    toast.success('Key copied to clipboard');
  }, []);

  const handleBulkTest = useCallback(async (baseUrl: string, keys: string[]): Promise<BulkTestKeyResult[]> => {
    const results = await Promise.all(
      keys.map(async (key) => {
        try {
          const result = await testOpenCodeApi(baseUrl, key);
          return {
            key,
            status: result.success ? 'ok' as const : 'invalid' as const,
            models: result.models?.map(m => m.id),
            error: result.error,
          };
        } catch {
          return { key, status: 'error' as const, error: 'Test failed' };
        }
      })
    );
    return results;
  }, []);

  const handleAddKeyFromBulk = useCallback((entry: ApiKeyEntry) => {
    if (!selectedCustomProvider) return;
    const keys = customProviderKeys[selectedCustomProvider] || [];
    const normalized: SharedApiKey = {
      apiKey: entry.key,
      baseUrl: entry.baseUrl ?? null,
      prefix: entry.prefix ?? null,
      customHeaders: null,
    };
    const updated = [...keys, normalized];
    customProviders.setCustomProviderKeys(selectedCustomProvider, updated);
    setCustomProviderKeys(prev => ({ ...prev, [selectedCustomProvider]: updated }));
    toast.success('Key added');
  }, [selectedCustomProvider, customProviderKeys]);

  const handleAddAllValid = useCallback((entries: ApiKeyEntry[]) => {
    if (!selectedCustomProvider) return;
    const keys = customProviderKeys[selectedCustomProvider] || [];
    const normalized: SharedApiKey[] = entries.map(e => ({
      apiKey: e.key,
      baseUrl: e.baseUrl ?? null,
      prefix: e.prefix ?? null,
      customHeaders: null,
    }));
    const updated = [...keys, ...normalized];
    customProviders.setCustomProviderKeys(selectedCustomProvider, updated);
    setCustomProviderKeys(prev => ({ ...prev, [selectedCustomProvider]: updated }));
    setIsBulkDrawerOpen(false);
  }, [selectedCustomProvider, customProviderKeys]);

  const handleRetestAll = useCallback(async () => {
    if (!selectedCustomProvider) return;
    const keys = customProviderKeys[selectedCustomProvider] || [];
    if (keys.length === 0) {
      toast.error('No keys to test');
      return;
    }

    setIsRetestingAll(true);
    const provider = customProvidersList.find(p => p.id === selectedCustomProvider);
    const baseUrl = provider?.base_url || '';

    try {
      const results = await Promise.all(
        keys.map(async (entry) => {
          try {
            const result = await testOpenCodeApi(entry.baseUrl || baseUrl, entry.apiKey);
            return {
              ...entry,
              status: result.success ? 'ok' as const : 'invalid' as const,
              };
            } catch {
              return {
                ...entry,
                status: 'error' as const,
              };
          }
        })
      );

      await customProviders.setCustomProviderKeys(selectedCustomProvider, results);
      setCustomProviderKeys(prev => ({ ...prev, [selectedCustomProvider]: results }));
      const okCount = results.filter(r => r.status === 'ok').length;
      toast.success(`Tested ${keys.length} keys: ${okCount} valid, ${keys.length - okCount} invalid`);
    } catch (error) {
      toast.error(`Re-test failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsRetestingAll(false);
    }
  }, [selectedCustomProvider, customProvidersList, customProviderKeys]);

  const handleProviderAdded = useCallback((providerId: string, _baseUrl: string) => {
    setSelectedCustomProvider(providerId);
    setIsBulkDrawerOpen(true);
  }, []);

  const handleCreateProvider = useCallback(async (name: string, baseUrl: string, validKeys: ApiKeyEntry[]) => {
    try {
      const result = await customProviders.addCustomProvider(name, baseUrl, 'openai/*');
      if (!result.success || !result.provider) {
        toast.error(result.error || 'Failed to create provider');
        return;
      }
      const providerId = result.provider.id;
      const normalized: SharedApiKey[] = validKeys.map(e => ({
        apiKey: e.key,
        baseUrl: e.baseUrl ?? null,
        prefix: e.prefix ?? null,
        customHeaders: null,
      }));
      await customProviders.setCustomProviderKeys(providerId, normalized);
      setCustomProvidersList(prev => [...prev, result.provider!]);
      setSelectedCustomProvider(providerId);
      setCustomProviderKeys(prev => ({ ...prev, [providerId]: normalized }));
      toast.success(t('aiHub.providerCreatedWithKeys', { name, count: validKeys.length }));
      setIsCreateProviderDrawerOpen(false);
    } catch (error) {
      toast.error(t('aiHub.failedGeneric', { msg: error instanceof Error ? error.message : String(error) }));
    }
  }, []);

  const handleSmartPasteFromPost = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseProviderText(text);

      if (!parsed.baseUrl || parsed.keys.length === 0) {
        toast.error(t('aiHub.clipboardNoUrlKeys'));
        return;
      }

      const existingProvider = customProvidersList.find(p => p.base_url === parsed.baseUrl);
      let providerId: string;

      if (existingProvider) {
        providerId = existingProvider.id;
        setSelectedCustomProvider(providerId);
        toast.success(t('aiHub.existingProviderFound', { name: existingProvider.name }));
      } else {
        const name = parsed.name || new URL(parsed.baseUrl).hostname;
        const result = await customProviders.addCustomProvider(name, parsed.baseUrl, 'openai/*');
        if (!result.success || !result.provider) {
          toast.error(result.error || t('aiHub.providerCreateFailed'));
          return;
        }
        providerId = result.provider.id;
        setCustomProvidersList(prev => [...prev, result.provider!]);
        setSelectedCustomProvider(providerId);
        toast.success(t('aiHub.providerCreated', { name }));
      }

      setPrefillKeys(parsed.keys);
      setIsBulkDrawerOpen(true);
    } catch {
      toast.error(t('aiKeys.clipboardReadFailed'));
    }
  }, [customProvidersList]);

return (
    <div className="space-y-4">
      <MetricsSummaryDisplay />

      <QuickAddProvider
        isOpen={isQuickAddOpen}
        onClose={() => setIsQuickAddOpen(false)}
        onProviderAdded={handleProviderAdded}
      />

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">{t('aiHub.customProviders')}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {t('aiHub.customProvidersDesc')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Toggle
              label={t('aiHub.healthToggle')}
              checked={autoRefreshEnabled}
              onChange={toggleAutoRefresh}
              size="sm"
              tooltip={t('aiHub.healthToggleTip')}
            />
            <Button
              variant="primary"
              size="xs"
              leftIcon={<Sparkles size={12} />}
              onClick={handleSmartPasteFromPost}
            >
              {t('aiHub.smartPasteFromPost')}
            </Button>
            <Button
              variant="secondary"
              size="xs"
              leftIcon={<Plus size={12} />}
              onClick={() => setIsCreateProviderDrawerOpen(true)}
            >
              {t('aiHub.addProvider')}
            </Button>
          </div>
        </div>

        {/* Global Health Summary */}
        {healthData && healthData.records.length > 0 && (
          <HealthSummaryBar records={healthData.records} />
        )}

        {customProvidersList.length === 0 ? (
          <GlassCard className="p-8">
            <div className="text-center">
              <p className="text-sm text-slate-400 mb-1">{t('aiHub.noCustom')}</p>
              <p className="text-xs text-slate-500">
                {t('aiHub.customEmpty', { smart: t('aiHub.smartPasteFromPost'), add: t('aiHub.addProvider') })}
              </p>
            </div>
          </GlassCard>
        ) : (
          <div className="space-y-3">
            {customProvidersList.map(provider => {
              const keys = customProviderKeys[provider.id] || [];
              return (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  keys={keys.map(k => ({
                    key: k.apiKey,
                    baseUrl: k.baseUrl ?? undefined,
                    prefix: k.prefix ?? undefined,
                    addedAt: 0,
                    status: 'unknown' as const,
                  }))}
                  keyHealth={healthData?.records ?? []}
                  onAddKeys={() => {
                    setSelectedCustomProvider(provider.id);
                    setIsBulkDrawerOpen(true);
                  }}
                  onTestAll={() => {
                    setSelectedCustomProvider(provider.id);
                    handleRetestAll();
                  }}
                  onDelete={() => handleRemoveProvider(provider.id)}
                  onTestKey={(key) => {
                    setSelectedCustomProvider(provider.id);
                    handleTestKey(key);
                  }}
                  onDeleteKey={(key) => {
                    setSelectedCustomProvider(provider.id);
                    handleDeleteKey(key);
                  }}
                  onCopyKey={handleCopyKey}
                  isTestingAll={isRetestingAll && selectedCustomProvider === provider.id}
                />
              );
            })}
          </div>
        )}
      </div>

      <BulkAddDrawer
        isOpen={isBulkDrawerOpen}
        onClose={() => {
          setIsBulkDrawerOpen(false);
          setPrefillKeys([]);
        }}
        provider={selectedCustomProvider
          ? customProvidersList.find(p => p.id === selectedCustomProvider)?.name || 'Custom'
          : 'Custom'
        }
        defaultBaseUrl={selectedCustomProvider
          ? customProvidersList.find(p => p.id === selectedCustomProvider)?.base_url || ''
          : ''
        }
        existingKeys={selectedCustomProvider
          ? (customProviderKeys[selectedCustomProvider] || []).map(k => ({
              key: k.apiKey,
              baseUrl: k.baseUrl ?? undefined,
              prefix: k.prefix ?? undefined,
              addedAt: 0,
              status: 'unknown' as const,
            }))
          : []
        }
        onBulkTest={handleBulkTest}
        onAddKey={handleAddKeyFromBulk}
        onAddAllValid={handleAddAllValid}
        prefillKeys={prefillKeys}
      />

      <BulkAddDrawer
        isOpen={isCreateProviderDrawerOpen}
        onClose={() => setIsCreateProviderDrawerOpen(false)}
        provider=""
        defaultBaseUrl=""
        existingKeys={[]}
        onBulkTest={handleBulkTest}
        onAddKey={() => {}}
        onAddAllValid={() => {}}
        createProviderMode
        onCreateProvider={handleCreateProvider}
      />
    </div>
  );
}