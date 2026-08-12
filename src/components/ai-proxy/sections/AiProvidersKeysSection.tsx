import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

import { KeyList } from '@/components/api-keys/KeyList';
import { BulkAddDrawer } from '@/components/api-keys/BulkAddDrawer';
import { FilterBar } from '@/components/api-keys/FilterBar';
import * as apiKeys from '@/lib/backend/modules/apiKeys';
import { testOpenCodeApi } from '@/lib/backend/modules/opencodeConfig';
import type { BulkTestKeyResult } from '@/lib/backend/modules/opencodeConfig';
import { getAiProxyAccounts } from '@/lib/backend/modules/aiProxy';
import type { ApiKeyEntry, KeyFilter } from '@/types/apiKeys';
import type { AiProxyAccount } from '@/types/generated';
import { Button, GlassCard, Modal, Input, MetricStrip } from '@/components/ui';
import type { MetricSegment } from '@/components/ui';
import { FireworksCheckerSection } from './FireworksCheckerSection';
import { FreeModelBridgeSection } from './FreeModelBridgeSection';
import { CustomProvidersSection } from './CustomProvidersSection';
import { t } from '@/lib/i18n';

interface AiProvidersKeysSectionProps {
  providerFilter: string;
}

type SharedApiKey = {
  apiKey: string;
  baseUrl?: string | null;
  prefix?: string | null;
  customHeaders?: string | null;
};

// ponytail: migrate old SharedApiKey format to new ApiKeyEntry with defaults
function migrateKeys(oldKeys: SharedApiKey[]): ApiKeyEntry[] {
  return oldKeys.map(k => ({
    key: k.apiKey,
    baseUrl: k.baseUrl ?? undefined,
    prefix: k.prefix ?? undefined,
    addedAt: Date.now(),
    status: 'unknown' as const,
  }));
}

const providerLabel: Record<string, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  antigravity: 'Antigravity',
  zai: 'Z.AI / GLM',
};

export function AiProvidersKeysSection({ providerFilter }: AiProvidersKeysSectionProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [keys, setKeys] = useState<ApiKeyEntry[]>([]);
  const [activeFilter, setActiveFilter] = useState<KeyFilter>('all');
  const [testingKeys, setTestingKeys] = useState<Set<string>>(new Set());
  const [isBulkDrawerOpen, setIsBulkDrawerOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newApiKey, setNewApiKey] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('');
  const [newPrefix, setNewPrefix] = useState('');
  const [aiProxyAccounts, setAiProxyAccounts] = useState<AiProxyAccount[]>([]);

  const loadKeys = useCallback(async () => {
    if (providerFilter === 'all' || providerFilter === 'custom') {
      setKeys([]);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      let rawKeys: SharedApiKey[] = [];
      
      switch (providerFilter) {
        case 'gemini':
          rawKeys = await apiKeys.getGeminiApiKeys();
          break;
        case 'openai':
          rawKeys = await apiKeys.getOpenAIApiKeys();
          break;
        case 'anthropic':
          rawKeys = await apiKeys.getAnthropicApiKeys();
          break;
        case 'antigravity':
          rawKeys = await apiKeys.getAntigravityApiKeys();
          break;
        case 'zai':
          rawKeys = await apiKeys.getZaiApiKeys();
          break;
      }
      
      setKeys(migrateKeys(rawKeys));
    } catch (error) {
      console.error('Failed to load keys:', error);
      toast.error('Failed to load API keys');
    } finally {
      setIsLoading(false);
    }
  }, [providerFilter]);

  useEffect(() => {
    queueMicrotask(() => void loadKeys());
  }, [loadKeys]);

  const refreshAiProxyAccounts = useCallback(async () => {
    try {
      const accounts = await getAiProxyAccounts();
      setAiProxyAccounts(accounts);
    } catch (error) {
      console.error('Failed to load AI proxy accounts:', error);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refreshAiProxyAccounts());
  }, [refreshAiProxyAccounts]);

  const persistKeys = useCallback(async (newKeys: ApiKeyEntry[]) => {
    const toBackend = (entries: ApiKeyEntry[]) => entries.map(e => ({
      apiKey: e.key,
      baseUrl: e.baseUrl ?? null,
      prefix: e.prefix ?? null,
      customHeaders: null,
    }));
    const normalized = toBackend(newKeys);
    
    try {
      switch (providerFilter) {
        case 'gemini':
          await apiKeys.setGeminiApiKeys(normalized);
          break;
        case 'openai':
          await apiKeys.setOpenAIApiKeys(normalized);
          break;
        case 'anthropic':
          await apiKeys.setAnthropicApiKeys(normalized);
          break;
        case 'antigravity':
          await apiKeys.setAntigravityApiKeys(normalized);
          break;
        case 'zai':
          await apiKeys.setZaiApiKeys(normalized.map(({ apiKey, baseUrl, prefix }) => ({
            apiKey,
            baseUrl,
            prefix,
          })));
          break;
      }
      setKeys(newKeys);
    } catch (error) {
      console.error('Failed to save keys:', error);
      toast.error(t('aiHub.saveKeysFailed'));
    }
  }, [providerFilter]);

  const handleTestKey = useCallback(async (entry: ApiKeyEntry) => {
    setTestingKeys(prev => new Set(prev).add(entry.key));
    try {
      const result = await testOpenCodeApi(entry.baseUrl || 'https://api.openai.com', entry.key);
      const updated: ApiKeyEntry = {
        ...entry,
        lastTested: Date.now(),
        status: result.success ? 'ok' : 'invalid',
        models: result.models?.map(m => m.id),
        lastError: result.error,
      };
      const nextKeys = keys.map(k => k.key === entry.key ? updated : k);
      await persistKeys(nextKeys);
      toast.success(result.success ? t('aiHub.keyValid') : t('aiHub.keyInvalid'));
    } catch {
      toast.error(t('aiHub.testFailed'));
    } finally {
      setTestingKeys(prev => {
        const next = new Set(prev);
        next.delete(entry.key);
        return next;
      });
    }
  }, [keys, persistKeys]);

  const handleDeleteKey = useCallback(async (entry: ApiKeyEntry) => {
    const updated = keys.filter(k => k.key !== entry.key);
    await persistKeys(updated);
    toast.success('Key deleted');
  }, [keys, persistKeys]);

  const handleCopyKey = useCallback((entry: ApiKeyEntry) => {
    navigator.clipboard.writeText(entry.key);
    toast.success('Key copied to clipboard');
  }, []);

  const handleBulkTest = useCallback(async (baseUrl: string, testKeys: string[]): Promise<BulkTestKeyResult[]> => {
    const results = await Promise.all(
      testKeys.map(async (key) => {
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
    const updated = [...keys, entry];
    persistKeys(updated);
    toast.success('Key added');
  }, [keys, persistKeys]);

  const handleAddAllValid = useCallback((entries: ApiKeyEntry[]) => {
    const updated = [...keys, ...entries];
    persistKeys(updated);
    setIsBulkDrawerOpen(false);
  }, [keys, persistKeys]);

  const handleAddKey = async () => {
    const trimmedApiKey = newApiKey.trim();
    if (!trimmedApiKey) {
      toast.error('API key is required');
      return;
    }

    const newEntry: ApiKeyEntry = {
      key: trimmedApiKey,
      baseUrl: newBaseUrl.trim() || undefined,
      prefix: newPrefix.trim() || undefined,
      addedAt: Date.now(),
      status: 'unknown',
    };
    const updatedKeys = [...keys, newEntry];

    setIsSaving(true);
    try {
      await persistKeys(updatedKeys);
      toast.success('Key added');
      setIsAddModalOpen(false);
      setNewApiKey('');
      setNewBaseUrl('');
      setNewPrefix('');
    } catch (error) {
      console.error('Failed to add key:', error);
      toast.error('Failed to add key');
    } finally {
      setIsSaving(false);
    }
  };

  const filterCounts = useMemo(() => {
    return {
      all: keys.length,
      ok: keys.filter(k => k.status === 'ok').length,
      rate_limited: keys.filter(k => k.status === 'rate_limited').length,
      invalid: keys.filter(k => k.status === 'invalid' || k.status === 'error').length,
    };
  }, [keys]);

  const linkedAccountsForProvider = useMemo(
    () => aiProxyAccounts.filter(account => account.provider === providerFilter),
    [aiProxyAccounts, providerFilter]
  );

  const metricSegments = useMemo<MetricSegment[]>(() => {
    return [
      {
        id: 'configured-keys',
        label: t('aiHub.apiKeys.metrics.configuredKeys'),
        value: keys.length,
        icon: <Plus size={11} />,
        tone: keys.length > 0 ? 'info' : 'neutral',
      },
      {
        id: 'linked-accounts',
        label: t('aiHub.apiKeys.metrics.linkedAccounts'),
        value: linkedAccountsForProvider.length,
        icon: <UserPlus size={11} />,
        tone: linkedAccountsForProvider.length > 0 ? 'success' : 'neutral',
      },
    ];
  }, [keys.length, linkedAccountsForProvider.length]);

  if (providerFilter === 'all') {
    return null;
  }

  // Special sections for specific providers
  if (providerFilter === 'fireworks') {
    return <FireworksCheckerSection />;
  }

  if (providerFilter === 'freemodel') {
    return <FreeModelBridgeSection />;
  }

  if (providerFilter === 'custom') {
    return <CustomProvidersSection />;
  }

  if (isLoading) {
    return (
      <GlassCard className="p-4">
        <div className="flex items-center justify-center py-8">
            <div className="text-sm text-slate-500">{t('aiHub.loadingKeys')}</div>
        </div>
      </GlassCard>
    );
  }

  return (
    <>
      <MetricStrip segments={metricSegments} density="compact" />

      <GlassCard className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">{t('aiHub.apiKeysTitle')}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {t('aiHub.keysConfigured', { count: keys.length })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="xs"
              leftIcon={<Plus size={12} />}
              onClick={() => setIsAddModalOpen(true)}
            >
              {t('aiHub.addKey')}
            </Button>
            <Button
              variant="secondary"
              size="xs"
              leftIcon={<Plus size={12} />}
              onClick={() => setIsBulkDrawerOpen(true)}
            >
              {t('aiHub.bulkAdd')}
            </Button>
          </div>
        </div>

        <div className="mb-3">
          <FilterBar
            active={activeFilter}
            onChange={setActiveFilter}
            counts={filterCounts}
          />
        </div>

        <KeyList
          entries={keys}
          filter={activeFilter}
          provider={providerLabel[providerFilter] || providerFilter}
          testingKeys={testingKeys}
          onTest={handleTestKey}
          onDelete={handleDeleteKey}
          onCopy={handleCopyKey}
        />
      </GlassCard>

      <Modal
        isOpen={isAddModalOpen}
        onClose={() => {
          if (isSaving) return;
          setIsAddModalOpen(false);
          setNewApiKey('');
          setNewBaseUrl('');
          setNewPrefix('');
        }}
        title={t('aiHub.addKeyTitle', { provider: providerLabel[providerFilter] || providerFilter })}
        size="md"
        isLoading={isSaving}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (isSaving) return;
                setIsAddModalOpen(false);
                setNewApiKey('');
                setNewBaseUrl('');
                setNewPrefix('');
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button variant="primary" size="sm" onClick={handleAddKey} isLoading={isSaving}>
              {t('aiHub.addKey')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input
            label="API Key"
            type="password"
            placeholder="sk-..."
            value={newApiKey}
            onChange={event => setNewApiKey(event.target.value)}
            required
          />

          <Input
            label="Base URL (optional)"
            placeholder="https://api.openai.com"
            value={newBaseUrl}
            onChange={event => setNewBaseUrl(event.target.value)}
          />

          <Input
            label="Model Prefix (optional)"
            placeholder="gpt-4"
            value={newPrefix}
            onChange={event => setNewPrefix(event.target.value)}
          />
        </div>
      </Modal>

      <BulkAddDrawer
        isOpen={isBulkDrawerOpen}
        onClose={() => setIsBulkDrawerOpen(false)}
        provider={providerLabel[providerFilter] || providerFilter}
        defaultBaseUrl={providerFilter === 'openai' ? 'https://api.openai.com' : ''}
        existingKeys={keys}
        onBulkTest={handleBulkTest}
        onAddKey={handleAddKeyFromBulk}
        onAddAllValid={handleAddAllValid}
        prefillKeys={[]}
      />
    </>
  );
}
