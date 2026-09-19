import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardPaste, Plus, RotateCw, Server } from 'lucide-react';
import { Button } from '@/components/ui';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { appToast } from '@/lib/observability/toast';
import { t } from '@/lib/i18n';
import { useAiGatewayStore } from '@/stores/aiGateway';
import { discoverModelsForEndpoint } from '@/lib/backend/modules/aiGateway';
import type {
  Credential,
  ProviderEndpoint,
  UpstreamModel,
} from '@/lib/backend/modules/aiGateway';
import { ProviderEndpointForm } from '@/components/ai-gateway/ProviderEndpointForm';
import { PROVIDER_REGISTRY, type ProviderRegistryId } from '@/constants/providerRegistry';
import type { AiProxyAccount } from '@/types/generated';
import { ProviderCard } from './ProviderCard';
import type { ConnectionStateMap } from './sections/types';

interface ProviderCardsSectionProps {
  accounts: AiProxyAccount[];
  loading: boolean;
  providerFilter: string;
  searchQuery: string;
  connectionState: ConnectionStateMap;
  onAccountClick: (account: AiProxyAccount) => void;
  onEditAccount: (account: AiProxyAccount) => void;
  onDeleteAccount: (id: number) => void;
  onTestConnection: (account: AiProxyAccount) => void;
  onPastePackage: () => void;
}

function providerDisplayName(provider: string): string {
  return provider
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, m => m.toUpperCase());
}

function findEndpointForAccount(
  account: AiProxyAccount,
  endpoints: ProviderEndpoint[],
  credentials: Credential[]
): ProviderEndpoint | null {
  const migratedLabels = new Set([
    `migrated from ai_proxy_accounts: ${account.name}`,
    `migrated from api_keys: ${account.provider}`,
  ]);
  const linked = credentials.find(c => c.label && migratedLabels.has(c.label));
  return (
    (linked ? endpoints.find(e => e.id === linked.providerEndpointId) : undefined) ??
    endpoints.find(
      e => e.name.toLowerCase() === providerDisplayName(account.provider).toLowerCase()
    ) ??
    null
  );
}

function endpointMatchesProviderFilter(
  endpoint: ProviderEndpoint,
  filter: string,
  groupAccounts: AiProxyAccount[]
): boolean {
  if (filter === 'all') return true;
  if (groupAccounts.some(a => a.provider === filter)) return true;
  if (endpoint.adapterType === filter) return true;
  if (filter === 'openai' && endpoint.adapterType === 'openai_compatible') return true;
  const name = endpoint.name.toLowerCase();
  if (name === filter) return true;
  const label = PROVIDER_REGISTRY[filter as ProviderRegistryId]?.label?.toLowerCase();
  return Boolean(label && name.includes(label));
}

export function ProviderCardsSection({
  accounts,
  loading,
  providerFilter,
  searchQuery,
  connectionState,
  onAccountClick,
  onEditAccount,
  onDeleteAccount,
  onTestConnection,
  onPastePackage,
}: ProviderCardsSectionProps) {
  const endpoints = useAiGatewayStore(s => s.endpoints);
  const credentials = useAiGatewayStore(s => s.credentials);
  const upstreamModels = useAiGatewayStore(s => s.upstreamModels);
  const gwLoading = useAiGatewayStore(s => s.loading);
  const gwErrors = useAiGatewayStore(s => s.errors);
  const fetchEndpoints = useAiGatewayStore(s => s.fetchEndpoints);
  const fetchCredentials = useAiGatewayStore(s => s.fetchCredentials);
  const fetchUpstreamModels = useAiGatewayStore(s => s.fetchUpstreamModels);
  const deleteEndpoint = useAiGatewayStore(s => s.deleteEndpoint);

  const [endpointForm, setEndpointForm] = useState<{
    open: boolean;
    endpoint: ProviderEndpoint | null;
  }>({ open: false, endpoint: null });
  const [discoveringIds, setDiscoveringIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    void fetchEndpoints();
    void fetchCredentials();
    void fetchUpstreamModels();
  }, [fetchEndpoints, fetchCredentials, fetchUpstreamModels]);

  const endpointList = useMemo(
    () => (Array.isArray(endpoints) ? endpoints : []),
    [endpoints]
  );
  const credentialList = useMemo(
    () => (Array.isArray(credentials) ? credentials : []),
    [credentials]
  );
  const modelList = useMemo(
    () => (Array.isArray(upstreamModels) ? upstreamModels : []),
    [upstreamModels]
  );

  const modelsByEndpoint = useMemo(() => {
    const map = new Map<string, UpstreamModel[]>();
    for (const model of modelList) {
      const bucket = map.get(model.providerEndpointId);
      if (bucket) bucket.push(model);
      else map.set(model.providerEndpointId, [model]);
    }
    return map;
  }, [modelList]);

  const { groups, unlinked } = useMemo(() => {
    const byEndpoint = new Map<string, AiProxyAccount[]>();
    const unlinkedAccounts: AiProxyAccount[] = [];
    for (const account of accounts) {
      const endpoint = findEndpointForAccount(account, endpointList, credentialList);
      if (!endpoint) {
        unlinkedAccounts.push(account);
        continue;
      }
      const bucket = byEndpoint.get(endpoint.id);
      if (bucket) bucket.push(account);
      else byEndpoint.set(endpoint.id, [account]);
    }
    return { groups: byEndpoint, unlinked: unlinkedAccounts };
  }, [accounts, endpointList, credentialList]);

  const query = searchQuery.trim().toLowerCase();

  const visibleEndpoints = useMemo(
    () =>
      endpointList.filter(endpoint => {
        const groupAccounts = groups.get(endpoint.id) ?? [];
        if (!endpointMatchesProviderFilter(endpoint, providerFilter, groupAccounts)) {
          return false;
        }
        if (query === '') return true;
        return (
          endpoint.name.toLowerCase().includes(query) ||
          endpoint.baseUrl.toLowerCase().includes(query) ||
          groupAccounts.length > 0
        );
      }),
    [endpointList, groups, providerFilter, query]
  );

  const handleDiscover = useCallback(
    async (endpoint: ProviderEndpoint) => {
      setDiscoveringIds(prev => new Set(prev).add(endpoint.id));
      try {
        const result = await discoverModelsForEndpoint(endpoint.id);
        appToast.success(
          t('aiGateway.cards.discoveredModels', { count: result.models_count ?? 0 }),
          'ai-gateway'
        );
        await fetchUpstreamModels();
      } catch (e) {
        appToast.error(
          e instanceof Error ? e.message : String(e),
          'ai-gateway'
        );
      } finally {
        setDiscoveringIds(prev => {
          const next = new Set(prev);
          next.delete(endpoint.id);
          return next;
        });
      }
    },
    [fetchUpstreamModels]
  );

  const handleDeleteEndpoint = useCallback(
    async (endpoint: ProviderEndpoint) => {
      const ok = await askConfirm({
        title: t('aiGateway.cards.deleteEndpoint'),
        message: t('aiGateway.cards.deleteEndpointConfirm'),
        confirmText: t('common.delete'),
        cancelText: t('common.cancel'),
        variant: 'danger',
      });
      if (!ok) return;
      try {
        await deleteEndpoint(endpoint.id);
        appToast.success(t('aiGateway.cards.endpointDeleted'), 'ai-gateway');
      } catch (e) {
        appToast.error(
          e instanceof Error ? e.message : String(e),
          'ai-gateway'
        );
      }
    },
    [deleteEndpoint]
  );

  const nothingToShow =
    endpointList.length === 0 && accounts.length === 0 && !loading && !gwLoading.endpoints;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          {t('aiGateway.cards.sectionTitle')}
        </h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setEndpointForm({ open: true, endpoint: null })}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t('aiGateway.list.addEndpointShort')}
        </Button>
      </div>

      {gwErrors.endpoints && (
        <div className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-300">
          <span>
            {t('aiGateway.list.error')}: {gwErrors.endpoints}
          </span>
          <Button size="sm" variant="outline" onClick={() => void fetchEndpoints()}>
            <RotateCw className="mr-2 h-4 w-4" />
            {t('aiGateway.list.retry')}
          </Button>
        </div>
      )}

      {nothingToShow && !gwErrors.endpoints ? (
        <div className="rounded-lg border border-white/10 bg-white/5 p-8 text-center">
          <Server className="mx-auto mb-4 h-12 w-12 text-slate-400" />
          <h3 className="mb-2 text-lg font-semibold">{t('aiGateway.list.noEndpoints')}</h3>
          <p className="mb-4 text-slate-400">{t('aiGateway.list.noEndpointsDesc')}</p>
          <div className="flex items-center justify-center gap-2">
            <Button onClick={() => setEndpointForm({ open: true, endpoint: null })}>
              <Plus className="mr-2 h-4 w-4" />
              {t('aiGateway.list.addEndpoint')}
            </Button>
            <Button variant="outline" onClick={onPastePackage}>
              <ClipboardPaste className="mr-2 h-4 w-4" />
              {t('aiGateway.paste.button')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid items-start gap-3 xl:grid-cols-2">
          {visibleEndpoints.map(endpoint => (
            <ProviderCard
              key={endpoint.id}
              endpoint={endpoint}
              accounts={groups.get(endpoint.id) ?? []}
              models={modelsByEndpoint.get(endpoint.id) ?? []}
              connectionState={connectionState}
              discovering={discoveringIds.has(endpoint.id)}
              onAccountClick={onAccountClick}
              onEditAccount={onEditAccount}
              onDeleteAccount={onDeleteAccount}
              onTestConnection={onTestConnection}
              onEditEndpoint={ep => setEndpointForm({ open: true, endpoint: ep })}
              onDeleteEndpoint={ep => void handleDeleteEndpoint(ep)}
              onDiscoverModels={ep => void handleDiscover(ep)}
            />
          ))}

          {unlinked.length > 0 && (
            <ProviderCard
              endpoint={null}
              accounts={unlinked}
              models={[]}
              connectionState={connectionState}
              onAccountClick={onAccountClick}
              onEditAccount={onEditAccount}
              onDeleteAccount={onDeleteAccount}
              onTestConnection={onTestConnection}
            />
          )}
        </div>
      )}

      <ProviderEndpointForm
        key={`endpoint-${endpointForm.endpoint?.id ?? 'new'}`}
        endpoint={endpointForm.endpoint}
        open={endpointForm.open}
        onClose={() => setEndpointForm({ open: false, endpoint: null })}
      />
    </section>
  );
}
