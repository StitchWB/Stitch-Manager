import { useState } from 'react';
import { AlertCircle, PenSquare, PlugZap, Server, Trash2, Wand2 } from 'lucide-react';
import {
  Badge,
  ButtonBase,
  ConfirmActionButton,
  GlassCard,
  ProviderLogo,
  StatusBadge,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import type { AiProxyAccount } from '@/types/generated';
import type { ProviderEndpoint, UpstreamModel } from '@/lib/backend/modules/aiGateway';
import type { ConnectionStateMap } from './sections/types';

const MODEL_CHIP_LIMIT = 12;

export const ADAPTER_PROVIDER_LOGO: Record<string, string> = {
  openai_compatible: 'openai',
  anthropic: 'anthropic',
  gemini: 'gemini',
};

interface ProviderCardProps {
  endpoint: ProviderEndpoint | null;
  accounts: AiProxyAccount[];
  models: UpstreamModel[];
  connectionState: ConnectionStateMap;
  discovering?: boolean;
  onAccountClick: (account: AiProxyAccount) => void;
  onEditAccount: (account: AiProxyAccount) => void;
  onDeleteAccount: (id: number) => void;
  onTestConnection: (account: AiProxyAccount) => void;
  onEditEndpoint?: (endpoint: ProviderEndpoint) => void;
  onDeleteEndpoint?: (endpoint: ProviderEndpoint) => void;
  onDiscoverModels?: (endpoint: ProviderEndpoint) => void;
}

function accountStatus(
  account: AiProxyAccount,
  conn?: { status: string }
): 'active' | 'inactive' | 'error' {
  if (!account.enabled) return 'inactive';
  if (conn?.status === 'error') return 'error';
  return 'active';
}

export function endpointStatusDot(
  endpoint: ProviderEndpoint,
  accountCount: number
): { className: string; label: string } {
  if (endpoint.circuitState === 'open') {
    return { className: 'animate-pulse bg-amber-400', label: t('aiGateway.status.degraded') };
  }
  if (!endpoint.enabled) {
    return { className: 'bg-red-400', label: t('aiGateway.disabled') };
  }
  if (accountCount > 0) {
    return { className: 'bg-emerald-400', label: t('aiGateway.enabled') };
  }
  return {
    className: 'bg-transparent ring-1 ring-inset ring-slate-500',
    label: t('aiGateway.cards.accountsEmpty'),
  };
}

const LEGACY_ACCOUNT_NAME = /^migrated from api_keys:\s*(.+)$/i;

export function accountDisplayName(account: AiProxyAccount): { text: string; title?: string } {
  const match = LEGACY_ACCOUNT_NAME.exec(account.name);
  if (match) {
    return {
      text: t('aiGateway.cards.legacyAccountName', { provider: match[1] }),
      title: account.name,
    };
  }
  return { text: account.name };
}

export function modelChipLabel(model: UpstreamModel): string {
  if (model.displayName) return model.displayName;
  const lastSlash = model.upstreamModelId.lastIndexOf('/');
  return lastSlash >= 0 ? model.upstreamModelId.slice(lastSlash + 1) : model.upstreamModelId;
}

export function isPlaceholderBaseUrl(baseUrl: string): boolean {
  return baseUrl.includes('.invalid');
}

export function ProviderCard({
  endpoint,
  accounts,
  models,
  connectionState,
  discovering = false,
  onAccountClick,
  onEditAccount,
  onDeleteAccount,
  onTestConnection,
  onEditEndpoint,
  onDeleteEndpoint,
  onDiscoverModels,
}: ProviderCardProps) {
  const [modelsExpanded, setModelsExpanded] = useState(false);

  const enabledModels = models.filter(m => m.enabled);
  const visibleModels = modelsExpanded
    ? enabledModels
    : enabledModels.slice(0, MODEL_CHIP_LIMIT);
  const statusDot = endpoint ? endpointStatusDot(endpoint, accounts.length) : null;

  return (
    <div data-testid={`provider-card-${endpoint?.id ?? 'unlinked'}`}>
    <GlassCard className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
        {endpoint ? (
          <>
            <span
              className={cn('h-2 w-2 shrink-0 rounded-full', statusDot?.className)}
              aria-label={statusDot?.label}
            />
            <span className="shrink-0 text-slate-400">
              <ProviderLogo
                provider={ADAPTER_PROVIDER_LOGO[endpoint.adapterType] ?? endpoint.adapterType}
                size={18}
              />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-white">
                  {endpoint.name}
                </span>
                <Badge variant="indigo" size="sm">
                  {endpoint.adapterType}
                </Badge>
              </div>
              {isPlaceholderBaseUrl(endpoint.baseUrl) ? (
                <Badge
                  variant="warning"
                  size="sm"
                  className="mt-0.5 normal-case tracking-normal"
                >
                  {t('aiGateway.cards.urlNotConfigured')}
                </Badge>
              ) : (
                <div
                  className="truncate font-mono text-[11px] text-slate-500"
                  title={endpoint.baseUrl}
                >
                  {endpoint.baseUrl}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {onDiscoverModels && (
                <ButtonBase
                  type="button"
                  className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white"
                  title={t('aiGateway.discoverModels')}
                  onClick={() => onDiscoverModels(endpoint)}
                >
                  <Wand2 size={15} className={cn(discovering && 'animate-pulse')} />
                </ButtonBase>
              )}
              {onEditEndpoint && (
                <ButtonBase
                  type="button"
                  className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white"
                  title={t('aiGateway.cards.editEndpoint')}
                  onClick={() => onEditEndpoint(endpoint)}
                >
                  <PenSquare size={15} />
                </ButtonBase>
              )}
              {onDeleteEndpoint && (
                <ConfirmActionButton
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-auto w-auto p-1 text-red-400 hover:text-red-300"
                  title={t('aiGateway.cards.deleteEndpoint')}
                  armedLabel={<Trash2 size={15} />}
                  onConfirm={() => onDeleteEndpoint(endpoint)}
                >
                  <Trash2 size={15} />
                </ConfirmActionButton>
              )}
            </div>
          </>
        ) : (
          <>
            <span className="shrink-0 text-amber-400">
              <AlertCircle size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white">
                {t('aiGateway.cards.unlinkedTitle')}
              </div>
              <div className="truncate text-[11px] text-slate-500">
                {t('aiGateway.accountPanel.noLinkDesc')}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="divide-y divide-white/[0.04]">
        {accounts.map(account => {
          const conn = account.id ? connectionState[account.id] : undefined;
          const displayName = accountDisplayName(account);
          return (
            <div
              key={account.id ?? `${account.provider}:${account.name}`}
              className="group relative flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.03]"
            >
              <ButtonBase
                type="button"
                className="absolute inset-0 z-10 focus:outline-none"
                onClick={() => onAccountClick(account)}
                aria-label={account.name}
              />
              <span className="relative z-0 shrink-0">
                <ProviderLogo provider={account.provider} size={16} />
              </span>
              <div className="relative z-0 min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-white" title={displayName.title}>
                  {displayName.text}
                </div>
                <div className="text-[10px] tabular-nums text-slate-500">
                  {t('aiHub.table.requestsLine', {
                    requests: account.requestsToday.toLocaleString(),
                    tokens: account.tokensUsed.toLocaleString(),
                  })}
                </div>
              </div>
              <div className="relative z-0 shrink-0">
                <StatusBadge status={accountStatus(account, conn)} withDot size="sm" />
              </div>
              <div className="relative z-20 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <ButtonBase
                  type="button"
                  className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white"
                  title={t('aiHub.table.testConnection')}
                  disabled={!account.id}
                  onClick={() => onTestConnection(account)}
                >
                  <PlugZap size={14} className={cn(conn?.status === 'loading' && 'animate-pulse')} />
                </ButtonBase>
                <ButtonBase
                  type="button"
                  className="rounded p-1 text-slate-400 hover:bg-white/5 hover:text-white"
                  title={t('aiHub.table.edit')}
                  onClick={() => onEditAccount(account)}
                >
                  <PenSquare size={14} />
                </ButtonBase>
                <ConfirmActionButton
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-auto w-auto p-1 text-red-400 hover:text-red-300"
                  title={t('aiHub.table.delete')}
                  disabled={!account.id}
                  armedLabel={<Trash2 size={14} />}
                  onConfirm={() => {
                    if (account.id) onDeleteAccount(account.id);
                  }}
                >
                  <Trash2 size={14} />
                </ConfirmActionButton>
              </div>
            </div>
          );
        })}

        {accounts.length === 0 && (
          <div className="px-4 py-3">
            <div className="text-xs font-medium text-slate-400">
              {t('aiGateway.cards.accountsEmpty')}
            </div>
            <div className="mt-0.5 text-[10px] text-slate-600">
              {t('aiGateway.cards.accountsEmptyDesc')}
            </div>
          </div>
        )}
      </div>

      {endpoint && (
        <div className="border-t border-white/[0.06] px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            <Server size={12} />
            {t('aiGateway.cards.modelsCount', { count: enabledModels.length })}
            {enabledModels.length > MODEL_CHIP_LIMIT && (
              <ButtonBase
                type="button"
                className="ml-auto normal-case tracking-normal text-slate-400 hover:text-white"
                onClick={() => setModelsExpanded(v => !v)}
              >
                {modelsExpanded
                  ? t('aiGateway.cards.hideModels')
                  : t('aiGateway.cards.showAllModels')}
              </ButtonBase>
            )}
          </div>
          {visibleModels.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {visibleModels.map(model => (
                <Badge
                  key={model.id}
                  variant="default"
                  size="sm"
                  className="normal-case tracking-normal border-white/15 text-slate-300"
                  title={model.upstreamModelId}
                >
                  {modelChipLabel(model)}
                </Badge>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-slate-600">
              {t('aiGateway.list.noUpstreamModels')}
            </div>
          )}
        </div>
      )}
    </GlassCard>
    </div>
  );
}
