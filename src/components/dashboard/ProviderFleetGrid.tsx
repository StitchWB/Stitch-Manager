import { useCallback, useMemo, useState } from 'react';
import { ChevronRight, Loader2, Plus, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { t } from '@/lib/i18n';
import { Button, GlassCard, IconButton, ProgressBar, StatusBadge, Tooltip } from '@/components/ui';
import { NumberInput } from '@/components/ui/NumberInput';
import { cn } from '@/lib/utils';

import type { Account } from '../../types/ui';
import { useSettingsStore } from '../../stores/settings';
import { useRuntimeStore } from '../../stores/registration/runtime.store';

interface ProviderFleetGridProps {
  accounts: Account[];
  onRefreshProvider: (providerIds: number[], providerName: string) => Promise<void> | void;
  isRefreshing?: boolean;
  refreshingProvider?: string | null;
}

interface ProviderConfig {
  id: 'kiro' | 'windsurf' | 'trae';
  label: string;
  /** Underlying provider ids in the accounts table (Kiro shares aws_builder_id) */
  matches: string[];
  accentClass: string;
  iconClass: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    id: 'kiro',
    label: 'Kiro',
    matches: ['kiro', 'aws_builder_id'],
    accentClass: 'from-purple-500/20 to-indigo-500/10',
    iconClass: 'bg-purple-500/15 text-purple-300',
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    matches: ['windsurf'],
    accentClass: 'from-cyan-400/20 to-blue-500/10',
    iconClass: 'bg-cyan-500/15 text-cyan-300',
  },
  {
    id: 'trae',
    label: 'Trae',
    matches: ['trae'],
    accentClass: 'from-emerald-400/20 to-teal-600/10',
    iconClass: 'bg-emerald-500/15 text-emerald-300',
  },
];

interface ProviderTotals {
  active: number;
  target: number;
  total: number;
  quotaPercent: number | null;
}

function computeTotals(
  accounts: Account[],
  cfg: ProviderConfig,
  targets: Record<string, number>
): ProviderTotals {
  const own = accounts.filter(a => cfg.matches.includes(a.provider));
  const active = own.filter(a => a.status === 'active').length;

  const quotaSamples = own.filter(a => a.quota && a.quota.limit > 0);
  const quotaPercent = quotaSamples.length
    ? Math.round(
        (quotaSamples.reduce((acc, a) => acc + (a.quota!.used / a.quota!.limit) * 100, 0) /
          quotaSamples.length)
      )
    : null;

  return {
    active,
    target: targets[cfg.id] ?? 0,
    total: own.length,
    quotaPercent,
  };
}

export function ProviderFleetGrid({
  accounts,
  onRefreshProvider,
  isRefreshing,
  refreshingProvider,
}: ProviderFleetGridProps) {
  const navigate = useNavigate();
  
  // Read from settings store instead of fetching
  const settings = useSettingsStore(state => state.settings);
  const isRunning = useRuntimeStore(state => state.isRunning);
  const activeProvider = useRuntimeStore(state => state.activeProvider);
  
  const targets = useMemo<Record<string, number>>(() => ({
    kiro: settings?.minActiveKiro ?? 0,
    windsurf: settings?.minActiveWindsurf ?? 0,
    trae: settings?.minActiveTrae ?? 0,
  }), [settings]);
  
  const autoReplenishEnabled = Boolean(settings?.autoReplenishEnabled);
  
  // Derive activeRunner from registration store's activeProvider
  const activeRunner = useMemo(() => {
    if (isRunning && activeProvider && activeProvider !== 'all') {
      return activeProvider.toLowerCase();
    }
    return null;
  }, [isRunning, activeProvider]);
  
  const [counts, setCounts] = useState<Record<string, number>>({
    kiro: 1,
    windsurf: 1,
    trae: 1,
  });

  const handleAdjust = useCallback((id: string, value: number) => {
    setCounts(prev => ({ ...prev, [id]: Math.min(Math.max(value, 1), 99) }));
  }, []);

  const handleStart = useCallback(
    (cfg: ProviderConfig) => {
      const count = counts[cfg.id] ?? 1;
      navigate(`/autoreg?provider=${cfg.id}&count=${count}&autostart=1`);
    },
    [counts, navigate]
  );

  const handleRefresh = useCallback(
    async (cfg: ProviderConfig) => {
      const ids = accounts
        .filter(a => cfg.matches.includes(a.provider) && a.status !== 'banned')
        .map(a => a.id);
      if (!ids.length) {
        toast.info(t('dashboard.fleetGrid.noAccountsToRefresh', { provider: cfg.label }));
        return;
      }
      await onRefreshProvider(ids, cfg.id);
    },
    [accounts, onRefreshProvider]
  );

  const cards = useMemo(
    () => PROVIDERS.map(cfg => ({ cfg, totals: computeTotals(accounts, cfg, targets) })),
    [accounts, targets]
  );

  return (
    <section className="flex flex-wrap gap-3">
      {cards.map(({ cfg, totals }) => {
        const reached = totals.target > 0 && totals.active >= totals.target;
        const progressVariant: 'success' | 'warning' | 'danger' = reached
          ? 'success'
          : totals.active === 0
            ? 'danger'
            : 'warning';

        const isThisRefreshing = isRefreshing && refreshingProvider === cfg.id;
        const isThisRunning = activeRunner === cfg.id;

        return (
          <GlassCard
            key={cfg.id}
            className={cn(
              'relative overflow-hidden p-4 flex flex-col gap-3',
              'flex-1 basis-[280px] min-w-[260px]',
              'bg-gradient-to-br',
              cfg.accentClass
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-lg font-bold text-sm',
                    cfg.iconClass
                  )}
                >
                  {cfg.label[0]}
                </span>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-white tracking-tight">
                    {cfg.label}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">
                    {t('dashboard.fleetGrid.totalAccounts', { count: totals.total })}
                  </span>
                </div>
              </div>
              {isThisRunning ? (
                <StatusBadge status="active" size="sm" withDot withPulse>
                  {t('dashboard.fleetGrid.statusRunning')}
                </StatusBadge>
              ) : autoReplenishEnabled ? (
                <StatusBadge
                  status={reached ? 'success' : 'idle'}
                  size="sm"
                  withDot
                >
                  {reached
                    ? t('dashboard.fleetGrid.statusOnTarget')
                    : t('dashboard.fleetGrid.statusReplenish')}
                </StatusBadge>
              ) : (
                <StatusBadge status="inactive" size="sm">
                  {t('dashboard.fleetGrid.statusManual')}
                </StatusBadge>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">
                  {t('dashboard.fleetGrid.activeOfTarget')}
                </span>
                <span className="text-sm font-semibold tabular-nums text-white">
                  {totals.active}
                  <span className="text-slate-500"> / {totals.target}</span>
                </span>
              </div>
              <ProgressBar
                value={totals.active}
                max={Math.max(totals.target, totals.active, 1)}
                variant={progressVariant}
                size="sm"
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">
                {t('dashboard.fleetGrid.quotaAverage')}
              </span>
              <span className="text-xs text-slate-300 tabular-nums">
                {totals.quotaPercent === null
                  ? t('dashboard.fleetGrid.quotaNoData')
                  : `${totals.quotaPercent}%`}
              </span>
            </div>

            <div className="mt-auto flex items-center gap-2">
              <div className="w-20 shrink-0">
                <NumberInput
                  label=""
                  value={counts[cfg.id] ?? 1}
                  onChange={v => handleAdjust(cfg.id, v)}
                  min={1}
                  max={99}
                  unit={t('dashboard.fleetGrid.unitAccounts')}
                  className="!h-8"
                />
              </div>
              <Tooltip content={t('dashboard.fleetGrid.startTooltip', { count: counts[cfg.id] ?? 1 })}>
                <Button
                  size="sm"
                  variant="primary"
                  className="flex-1 min-w-0"
                  onClick={() => handleStart(cfg)}
                  leftIcon={<Plus size={14} />}
                  disabled={isThisRunning}
                >
                  <span className="truncate">{t('dashboard.fleetGrid.startButton')}</span>
                </Button>
              </Tooltip>
              <Tooltip content={t('dashboard.fleetGrid.refreshTooltip')}>
                <IconButton
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRefresh(cfg)}
                  disabled={isThisRefreshing}
                  aria-label={t('dashboard.fleetGrid.refreshButton')}
                >
                  {isThisRefreshing ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                </IconButton>
              </Tooltip>
            </div>

            <Tooltip content={t('dashboard.fleetGrid.openAccounts')}>
              <IconButton
                size="sm"
                variant="ghost"
                className="absolute top-2 right-2"
                onClick={() => navigate(`/accounts?provider=${cfg.id}`)}
                aria-label={t('dashboard.fleetGrid.openAccounts')}
              >
                <ChevronRight size={14} />
              </IconButton>
            </Tooltip>
          </GlassCard>
        );
      })}
    </section>
  );
}
