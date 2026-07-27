import { useMemo } from 'react';
import { ArrowDown, ArrowRight, Network, Power, Route, Server } from 'lucide-react';

import { Button, GlassCard, ProviderLogo, StatusBadge } from '@/components/ui';
import { useAppStore } from '@/stores/app';
import type { ProviderModelMapping } from '@/lib/tauri/modules/aiProxy';
import type { AiProxyAccount, ProxySettings, ProxyStatus } from '@/types/generated';
import { cn } from '@/lib/utils';

interface RoutingFlowBoardProps {
  accounts: AiProxyAccount[];
  mappings: ProviderModelMapping[];
  proxyStatus: ProxyStatus | null;
  proxySettings: ProxySettings | null;
  baseUrl: string;
  autoSwitchEnabled: boolean | null;
  proxyBusy: boolean;
  onOpenProviders: () => void;
  onOpenMappings: () => void;
  onOpenRotation: () => void;
  onOpenProxy: () => void;
  onStartStopProxy: () => void;
}

interface SourceSummary {
  provider: string;
  total: number;
  enabled: number;
}

function FlowConnector() {
  return (
    <div className="flex items-center justify-center text-slate-700" aria-hidden="true">
      <ArrowDown size={15} className="min-[700px]:hidden" />
      <ArrowRight size={15} className="hidden min-[700px]:block" />
    </div>
  );
}

export function RoutingFlowBoard({
  accounts,
  mappings,
  proxyStatus,
  proxySettings,
  baseUrl,
  autoSwitchEnabled,
  proxyBusy,
  onOpenProviders,
  onOpenMappings,
  onOpenRotation,
  onOpenProxy,
  onStartStopProxy,
}: RoutingFlowBoardProps) {
  const language = useAppStore(state => state.language);
  const isRu = language === 'ru';
  const copy = isRu
    ? {
      eyebrow: 'Путь запроса',
      title: 'Маршрутизация',
      sources: 'Источники',
      accounts: 'аккаунтов',
      enabled: 'доступно',
      manage: 'Источники',
      noSources: 'Нет подключённых источников',
      rules: 'Правила выбора',
      mappings: 'маппингов',
      configureMappings: 'Маппинги',
      configureRotation: 'Ротация',
      noMappings: 'Стратегия по умолчанию',
      output: 'AI Proxy',
      configureProxy: 'Настройки',
      start: 'Запустить',
      stop: 'Остановить',
      running: 'Работает',
      stopped: 'Остановлен',
      automatic: 'Автопереключение',
      on: 'вкл.',
      off: 'выкл.',
      unknown: 'неизвестно',
    }
    : {
      eyebrow: 'Request path',
      title: 'Routing',
      sources: 'Sources',
      accounts: 'accounts',
      enabled: 'available',
      manage: 'Sources',
      noSources: 'No connected sources',
      rules: 'Selection rules',
      mappings: 'mappings',
      configureMappings: 'Mappings',
      configureRotation: 'Rotation',
      noMappings: 'Default strategy',
      output: 'AI Proxy',
      configureProxy: 'Settings',
      start: 'Start',
      stop: 'Stop',
      running: 'Running',
      stopped: 'Stopped',
      automatic: 'Auto switch',
      on: 'on',
      off: 'off',
      unknown: 'unknown',
    };

  const sources = useMemo<SourceSummary[]>(() => {
    const grouped = new Map<string, SourceSummary>();
    for (const account of accounts) {
      const current = grouped.get(account.provider) ?? {
        provider: account.provider,
        total: 0,
        enabled: 0,
      };
      current.total += 1;
      if (account.enabled) current.enabled += 1;
      grouped.set(account.provider, current);
    }
    return Array.from(grouped.values()).sort((left, right) => right.enabled - left.enabled);
  }, [accounts]);

  const enabledAccounts = sources.reduce((total, source) => total + source.enabled, 0);
  const running = Boolean(proxyStatus?.running);
  const routingStrategy = (proxySettings?.routingStrategy || 'round-robin').replace(/-/g, ' ');
  const visibleSources = sources.slice(0, 4);
  const autoSwitchLabel =
    autoSwitchEnabled === null ? copy.unknown : autoSwitchEnabled ? copy.on : copy.off;

  return (
    <GlassCard className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-3.5 py-2.5">
        <div className="min-w-0">
          <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-indigo-300/70">
            {copy.eyebrow}
          </span>
          <h2 className="text-sm font-semibold leading-tight text-white">{copy.title}</h2>
        </div>
        <StatusBadge status={running ? 'active' : 'inactive'} size="sm" withDot>
          {running ? copy.running : copy.stopped}
        </StatusBadge>
      </div>

      <div className="grid gap-1.5 p-2.5 min-[700px]:grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)_20px_minmax(0,1fr)] min-[700px]:gap-0">
        <section className="flex min-w-0 flex-col justify-between gap-3 rounded-lg border border-sky-400/15 bg-sky-500/[0.035] p-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300 ring-1 ring-inset ring-sky-400/15">
              <Server size={15} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-semibold tabular-nums text-sky-300/60">01</span>
                <h3 className="truncate text-xs font-semibold text-white">{copy.sources}</h3>
              </div>
              <p className="truncate text-[10px] text-slate-500">
                {enabledAccounts}/{accounts.length} {copy.enabled}
              </p>
            </div>
          </div>

          <div className="flex min-h-6 items-center gap-1.5">
            {visibleSources.length > 0 ? (
              <>
                <div className="flex -space-x-1">
                  {visibleSources.map(source => (
                    <span
                      key={source.provider}
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-vsc-border bg-vsc-bg"
                      title={`${source.provider}: ${source.enabled}/${source.total}`}
                    >
                      <ProviderLogo provider={source.provider} size={14} colored />
                    </span>
                  ))}
                </div>
                <span className="min-w-0 truncate text-[10px] text-slate-500">
                  {sources.length} · {accounts.length} {copy.accounts}
                </span>
              </>
            ) : (
              <span className="truncate text-[10px] text-slate-600">{copy.noSources}</span>
            )}
          </div>

          <Button variant="secondary" size="xs" onClick={onOpenProviders} className="self-start">
            {copy.manage}
          </Button>
        </section>

        <FlowConnector />

        <section className="flex min-w-0 flex-col justify-between gap-3 rounded-lg border border-violet-400/15 bg-violet-500/[0.035] p-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-300 ring-1 ring-inset ring-violet-400/15">
              <Route size={15} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-semibold tabular-nums text-violet-300/60">02</span>
                <h3 className="truncate text-xs font-semibold text-white">{copy.rules}</h3>
              </div>
              <p className="truncate text-[10px] capitalize text-slate-500">{routingStrategy}</p>
            </div>
          </div>

          <div className="flex min-h-6 items-center gap-1.5 text-[10px] text-slate-500">
            <Network size={12} className="shrink-0 text-violet-300/70" />
            <span className="truncate">
              {mappings.length > 0
                ? `${mappings.length} ${copy.mappings}`
                : copy.noMappings}
              {' · '}
              {copy.automatic}: {autoSwitchLabel}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Button variant="secondary" size="xs" onClick={onOpenMappings}>
              {copy.configureMappings}
            </Button>
            <Button variant="secondary" size="xs" onClick={onOpenRotation}>
              {copy.configureRotation}
            </Button>
          </div>
        </section>

        <FlowConnector />

        <section className="flex min-w-0 flex-col justify-between gap-3 rounded-lg border border-emerald-400/15 bg-emerald-500/[0.035] p-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
                running
                  ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/15'
                  : 'bg-white/[0.04] text-slate-600 ring-white/[0.06]'
              )}
            >
              <Power size={15} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-semibold tabular-nums text-emerald-300/60">03</span>
                <h3 className="truncate text-xs font-semibold text-white">{copy.output}</h3>
              </div>
              <p className="text-[10px] text-slate-500">
                {running ? copy.running : copy.stopped}
                {proxyStatus?.port ? ` · :${proxyStatus.port}` : ''}
              </p>
            </div>
          </div>

          <div className="min-h-6 truncate rounded-md border border-white/[0.06] bg-vsc-bg/50 px-2 py-1 font-mono text-[10px] text-slate-300" title={baseUrl}>
            {baseUrl}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Button variant="secondary" size="xs" onClick={onOpenProxy}>
              {copy.configureProxy}
            </Button>
            <Button
              variant={running ? 'danger' : 'primary'}
              size="xs"
              onClick={onStartStopProxy}
              disabled={proxyBusy}
            >
              {running ? copy.stop : copy.start}
            </Button>
          </div>
        </section>
      </div>
    </GlassCard>
  );
}
