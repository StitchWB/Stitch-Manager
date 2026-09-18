import { useEffect, useState } from 'react';
import { AlertCircle, Key, Server } from 'lucide-react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { AiProxyAccount } from '@/types/generated';
import {
  listCredentials,
  listProviderEndpoints,
  listUpstreamModels,
} from '@/lib/backend/modules/aiGateway';
import type {
  Credential,
  ProviderEndpoint,
  UpstreamModel,
} from '@/lib/backend/modules/aiGateway';
import { CredentialStatusBadge } from '@/components/ai-gateway/CredentialStatusBadge';

interface AccountGatewayPanelProps {
  account: AiProxyAccount;
}

interface PanelData {
  endpoint: ProviderEndpoint | null;
  credential: Credential | null;
  models: UpstreamModel[];
}

function providerDisplayName(provider: string): string {
  return provider
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, m => m.toUpperCase());
}

export function AccountGatewayPanel({ account }: AccountGatewayPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PanelData | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [endpoints, credentials] = await Promise.all([
          listProviderEndpoints(),
          listCredentials(),
        ]);
        const migratedLabels = new Set([
          `migrated from ai_proxy_accounts: ${account.name}`,
          `migrated from api_keys: ${account.provider}`,
        ]);
        const linked = credentials.find(c => c.label && migratedLabels.has(c.label));
        const endpoint =
          (linked ? endpoints.find(e => e.id === linked.providerEndpointId) : undefined) ??
          endpoints.find(
            e => e.name.toLowerCase() === providerDisplayName(account.provider).toLowerCase()
          ) ??
          null;
        const scoped = endpoint
          ? credentials.filter(c => c.providerEndpointId === endpoint.id)
          : [];
        const credential =
          scoped.find(c => c.label && migratedLabels.has(c.label)) ??
          linked ??
          scoped[0] ??
          null;
        const models = endpoint ? await listUpstreamModels(endpoint.id) : [];
        if (!cancelled) setData({ endpoint, credential, models });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account.name, account.provider]);

  if (loading) {
    return (
      <div className="border-b border-white/5 bg-black/20 px-4 py-4 text-xs text-slate-400">
        {t('common.loading')}
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-b border-white/5 bg-black/20 px-4 py-4 text-xs text-red-300">
        {t('aiGateway.list.error')}: {error}
      </div>
    );
  }

  if (!data?.endpoint) {
    return (
      <div className="border-b border-white/5 bg-black/20 px-4 py-4">
        <div className="text-xs font-medium text-slate-300">
          {t('aiGateway.accountPanel.noLink')}
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          {t('aiGateway.accountPanel.noLinkDesc')}
        </div>
      </div>
    );
  }

  const { endpoint, credential, models } = data;
  const enabledModels = models.filter(m => m.enabled);

  return (
    <div
      className="grid grid-cols-1 gap-4 border-b border-white/5 bg-black/20 px-4 py-4 md:grid-cols-3"
      data-testid={`account-gateway-panel-${account.id ?? account.name}`}
    >
      <div className="min-w-0">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          <Server size={12} />
          {t('aiGateway.accountPanel.endpoint')}
        </div>
        <div className="text-sm font-semibold text-white truncate">{endpoint.name}</div>
        <div className="mt-1 space-y-0.5 text-[11px] text-slate-400">
          <div>
            {t('aiGateway.adapter')}: {endpoint.adapterType}
          </div>
          <div className="truncate" title={endpoint.baseUrl}>
            {t('aiGateway.baseUrl')}: {endpoint.baseUrl}
          </div>
          <div>
            {t('aiGateway.statusLabel')}:{' '}
            {endpoint.enabled ? t('aiGateway.enabled') : t('aiGateway.disabled')}
          </div>
        </div>
      </div>

      <div className="min-w-0">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          <Key size={12} />
          {t('aiGateway.accountPanel.credential')}
        </div>
        {credential ? (
          <>
            <div className="flex items-center gap-2">
              <CredentialStatusBadge status={credential.runtimeStatus} />
              {credential.consecutiveFailures > 0 && (
                <span className="text-[10px] text-amber-400">
                  <AlertCircle className="mr-1 inline h-3 w-3" />
                  {t('aiGateway.list.failures', { count: credential.consecutiveFailures })}
                </span>
              )}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              {credential.authType} • {(credential.label || credential.fingerprint).slice(0, 40)}
            </div>
          </>
        ) : (
          <div className="text-[11px] text-slate-500">
            {t('aiGateway.list.noCredentials')}
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          {t('aiGateway.list.upstreamModelsTitle')} ({enabledModels.length})
        </div>
        {enabledModels.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {enabledModels.slice(0, 12).map(model => (
              <span
                key={model.id}
                className={cn(
                  'rounded-full border border-white/10 bg-white/5 px-2 py-0.5',
                  'text-[10px] text-slate-300'
                )}
              >
                {model.displayName || model.upstreamModelId}
              </span>
            ))}
            {enabledModels.length > 12 && (
              <span className="px-1 py-0.5 text-[10px] text-slate-500">
                +{enabledModels.length - 12}
              </span>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-slate-500">
            {t('aiGateway.list.noUpstreamModels')}
          </div>
        )}
      </div>
    </div>
  );
}
