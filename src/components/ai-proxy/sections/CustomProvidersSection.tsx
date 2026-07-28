import { useState, useCallback, useEffect } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { BulkAddDrawer } from '@/components/api-keys/BulkAddDrawer';
import { QuickAddProvider } from '@/components/api-keys/QuickAddProvider';
import { ProviderCard } from '@/components/api-keys/ProviderCard';
import { MetricsSummaryDisplay } from '@/components/api-keys/MetricsSummaryDisplay';
import { parseProviderText } from '@/lib/utils/parseProviderText';
import { testOpenCodeApi } from '@/lib/backend/modules/opencodeConfig';
import type { BulkTestKeyResult } from '@/lib/backend/modules/opencodeConfig';
import type { CustomProvider } from '@/lib/backend/modules/customProviders';
import * as customProviders from '@/lib/backend/modules/customProviders';
import type { ApiKeyEntry } from '@/types/apiKeys';
import { Button, GlassCard } from '@/components/ui';

type SharedApiKey = {
  apiKey: string;
  baseUrl?: string | null;
  prefix?: string | null;
  customHeaders?: string | null;
};

export function CustomProvidersSection() {
  const [customProvidersList, setCustomProvidersList] = useState<CustomProvider[]>([]);
  const [selectedCustomProvider, setSelectedCustomProvider] = useState<string | null>(null);
  const [customProviderKeys, setCustomProviderKeys] = useState<Record<string, SharedApiKey[]>>({});
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isBulkDrawerOpen, setIsBulkDrawerOpen] = useState(false);
  const [isRetestingAll, setIsRetestingAll] = useState(false);
  const [prefillKeys, setPrefillKeys] = useState<string[]>([]);

  useEffect(() => {
    loadCustomProviders();
  }, []);

  const loadCustomProviders = async () => {
    try {
      const providers = await customProviders.getCustomProviders();
      setCustomProvidersList(providers);
    } catch {
      // Custom providers may not be available yet
    }
  };

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
      toast.success(result.success ? 'Key is valid' : 'Key is invalid');
    } catch (error) {
      toast.error('Test failed');
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
          } catch (error) {
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

  const handleSmartPasteFromPost = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parseProviderText(text);

      if (!parsed.baseUrl || parsed.keys.length === 0) {
        toast.error('Не удалось найти URL или ключи в буфере обмена');
        return;
      }

      const existingProvider = customProvidersList.find(p => p.base_url === parsed.baseUrl);
      let providerId: string;

      if (existingProvider) {
        providerId = existingProvider.id;
        setSelectedCustomProvider(providerId);
        toast.success(`Найден существующий провайдер: ${existingProvider.name}`);
      } else {
        const name = parsed.name || new URL(parsed.baseUrl).hostname;
        const result = await customProviders.addCustomProvider(name, parsed.baseUrl, 'openai/*');
        if (!result.success || !result.provider) {
          toast.error(result.error || 'Failed to create provider');
          return;
        }
        providerId = result.provider.id;
        setCustomProvidersList(prev => [...prev, result.provider!]);
        setSelectedCustomProvider(providerId);
        toast.success(`Создан провайдер: ${name}`);
      }

      setPrefillKeys(parsed.keys);
      setIsBulkDrawerOpen(true);
    } catch {
      toast.error('Failed to read clipboard');
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
            <h3 className="text-sm font-semibold text-slate-200">Custom Providers</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Add any OpenAI-compatible provider with custom base URL
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="xs"
              leftIcon={<Sparkles size={12} />}
              onClick={handleSmartPasteFromPost}
            >
              Smart Paste from Post
            </Button>
            <Button
              variant="secondary"
              size="xs"
              leftIcon={<Plus size={12} />}
              onClick={() => setIsQuickAddOpen(true)}
            >
              Add Provider
            </Button>
          </div>
        </div>

        {customProvidersList.length === 0 ? (
          <GlassCard className="p-8">
            <div className="text-center">
              <p className="text-sm text-slate-400 mb-1">No custom providers yet</p>
              <p className="text-xs text-slate-500">
                Use <span className="text-sky-400">Smart Paste</span> to add from a post, or{' '}
                <span className="text-sky-400">Add Provider</span> manually
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
    </div>
  );
}
