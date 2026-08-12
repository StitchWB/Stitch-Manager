import { useState } from 'react';
import { t } from '@/lib/i18n';
import { ChevronDown, Plus, Trash2, RefreshCw, MoreVertical, ShieldCheck, AlertTriangle, XOctagon, HelpCircle } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { KeyRow } from './KeyRow';
import { getHealthSummary } from './KeyHealthBadge';
import type { ApiKeyEntry } from '@/types/apiKeys';
import type { CustomProvider } from '@/lib/backend/modules/customProviders';
import type { KeyHealthRecord, KeyHealthStatus } from '@/lib/backend/modules/keyHealth';
import { ButtonBase } from '@/components/ui/ButtonBase';

interface ProviderCardProps {
  provider: CustomProvider;
  keys: ApiKeyEntry[];
  keyHealth?: KeyHealthRecord[];
  onAddKeys: () => void;
  onTestAll: () => void;
  onDelete: () => void;
  onTestKey: (key: ApiKeyEntry) => void;
  onDeleteKey: (key: ApiKeyEntry) => void;
  onCopyKey: (key: ApiKeyEntry) => void;
  isTestingAll?: boolean;
}

export function ProviderCard({
  provider,
  keys,
  keyHealth,
  onAddKeys,
  onTestAll,
  onDelete,
  onTestKey,
  onDeleteKey,
  onCopyKey,
  isTestingAll = false,
}: ProviderCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Calculate stats
  const totalKeys = keys.length;
  const validKeys = keys.filter(k => k.status === 'ok').length;
  const successRate = totalKeys > 0 ? Math.round((validKeys / totalKeys) * 100) : 0;

  // Health summary - filter by this provider
  const healthRecords = keyHealth?.filter(r => 
    r.providerId === provider.name || 
    r.providerId === provider.id || 
    r.providerId === `custom_${provider.id}`
  ) ?? [];
  const healthSummary = getHealthSummary(healthRecords);

  // Calculate average latency (mock for now)
  const avgLatency = '1.2s'; // TODO: get from metrics API

  // Extract unique models from keys
  const allModels = new Set<string>();
  keys.forEach(key => {
    key.models?.forEach(model => allModels.add(model));
  });
  const models = Array.from(allModels).slice(0, 5); // Show first 5
  const moreModelsCount = allModels.size - 5;

  const HEALTH_ICONS: Record<KeyHealthStatus, React.ReactNode> = {
    healthy: <ShieldCheck className="w-3 h-3 text-emerald-400" />,
    flaky: <AlertTriangle className="w-3 h-3 text-amber-400" />,
    broken: <XOctagon className="w-3 h-3 text-red-400" />,
    expired: <HelpCircle className="w-3 h-3 text-slate-400" />,
    unknown: <HelpCircle className="w-3 h-3 text-slate-500" />,
  };

  return (
    <GlassCard className="overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-white/[0.06]">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
              <h3 className="text-sm font-semibold text-white truncate">
                {provider.name}
              </h3>
            </div>
            <p className="text-xs text-slate-400 font-mono truncate">
              {provider.base_url}
            </p>
          </div>
          <IconButton variant="ghost" size="sm">
            <MoreVertical className="w-4 h-4" />
          </IconButton>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
            <div className="text-xs text-slate-400 mb-0.5">{t('apiKeys.keys')}</div>
            <div className="text-sm font-semibold text-white">{totalKeys}</div>
          </div>
          <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
            <div className="text-xs text-slate-400 mb-0.5">{t('apiKeys.success')}</div>
            <div className="text-sm font-semibold text-emerald-400">{successRate}%</div>
          </div>
          <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]">
            <div className="text-xs text-slate-400 mb-0.5">{t('apiKeys.latency')}</div>
            <div className="text-sm font-semibold text-sky-400">{avgLatency}</div>
          </div>
        </div>

        {/* Health Summary */}
        {healthSummary.total > 0 && (
          <div className="mb-3 flex items-center gap-1.5 flex-wrap">
            {healthSummary.healthy > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                {HEALTH_ICONS.healthy}
                {healthSummary.healthy}
              </span>
            )}
            {healthSummary.flaky > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-amber-400">
                {HEALTH_ICONS.flaky}
                {healthSummary.flaky}
              </span>
            )}
            {healthSummary.broken > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-red-400">
                {HEALTH_ICONS.broken}
                {healthSummary.broken}
              </span>
            )}
            {healthSummary.expired > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                {HEALTH_ICONS.expired}
                {healthSummary.expired}
              </span>
            )}
            {healthSummary.unknown > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                {HEALTH_ICONS.unknown}
                {healthSummary.unknown}
              </span>
            )}
          </div>
        )}

        {/* Models */}
        {models.length > 0 && (
          <div className="mb-3">
            <div className="text-xs text-slate-400 mb-1.5">{t('apiKeys.modelsLabel')}</div>
            <div className="flex flex-wrap gap-1.5">
              {models.map(model => (
                <Badge key={model} variant="info" size="sm">
                  {model}
                </Badge>
              ))}
              {moreModelsCount > 0 && (
                <Badge variant="outline" size="sm">
                  {t('apiKeys.moreCount', { count: moreModelsCount })}
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus className="w-3.5 h-3.5" />}
            onClick={onAddKeys}
          >
            {t('apiKeys.addKeys')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${isTestingAll ? 'animate-spin' : ''}`} />}
            onClick={onTestAll}
            disabled={isTestingAll || totalKeys === 0}
          >
            {t('apiKeys.testAllLabel')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            leftIcon={<Trash2 className="w-3.5 h-3.5" />}
            onClick={onDelete}
          >
            {t('common.delete')}
          </Button>
        </div>
      </div>

      {/* Expandable Keys List */}
      {totalKeys > 0 && (
        <div>
          <ButtonBase
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
          >
            <span className="text-xs font-medium text-slate-300">
              {t('apiKeys.keysCount', { count: totalKeys })}
            </span>
            <ChevronDown
              className={`w-4 h-4 text-slate-400 transition-transform ${
                isExpanded ? 'rotate-180' : ''
              }`}
            />
          </ButtonBase>

          {isExpanded && (
            <div className="px-4 pb-4 space-y-2">
              {keys.map(key => (
                <KeyRow
                  key={key.key}
                  entry={key}
                  provider={provider.name}
                  isTesting={false}
                  onTest={onTestKey}
                  onDelete={onDeleteKey}
                  onCopy={onCopyKey}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}