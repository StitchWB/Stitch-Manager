import { useMemo } from 'react';
import { Network, Power, Route, Server, Shield } from 'lucide-react';

import { Button, GlassCard, ProviderLogo, StatusBadge } from '@/components/ui';
import { useAppStore } from '@/stores/app';
import type { ProviderModelMapping } from '@/lib/backend/modules/aiProxy';
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
  holoneEnabled: boolean;
  holoneMode: 'monitor' | 'block';
  holoneRuleCount: number;
  holoneFindingsCount: number;
  onOpenHolone: () => void;
}

interface SourceSummary {
  provider: string;
  total: number;
  enabled: number;
}

// ─── Flow Connector ────────────────────────────────────────────────

function FlowConnector({
  active = false,
  fromColor,
  toColor,
}: {
  active?: boolean;
  fromColor: string;
  toColor: string;
}) {
  const lineBase = active ? 'via-white/25' : 'via-white/5';
  const dotClass = active
    ? 'bg-white shadow-[0_0_6px_rgba(255,255,255,0.5)] animate-flow-pulse'
    : 'bg-white/25';

  return (
    <>
      {/* Vertical connector — narrow screens */}
      <div
        className="flex items-center justify-center py-0.5 min-[700px]:hidden"
        aria-hidden="true"
      >
        <div className="relative flex h-6 w-full items-center justify-center">
          <div
            className="absolute inset-x-8 top-1/2 h-px -translate-y-1/2"
            style={{
              background: `linear-gradient(90deg, transparent 0%, ${fromColor} 20%, ${lineBase} 50%, ${toColor} 80%, transparent 100%)`,
              backgroundSize: active ? '200% 100%' : '100% 100%',
            }}
          />
          <div className={cn('relative z-10 h-1.5 w-1.5 rounded-full', dotClass)} />
        </div>
      </div>

      {/* Horizontal connector — wide screens */}
      <div className="hidden min-[700px]:flex h-full items-center justify-center" aria-hidden="true">
        <div className="relative flex h-full w-5 items-center justify-center">
          <div
            className="absolute inset-y-2 left-1/2 w-px -translate-x-1/2"
            style={{
              background: `linear-gradient(180deg, transparent 0%, ${fromColor} 20%, ${lineBase} 50%, ${toColor} 80%, transparent 100%)`,
              backgroundSize: active ? '100% 200%' : '100% 100%',
            }}
          />
          <div className={cn('relative z-10 h-1.5 w-1.5 rounded-full', dotClass)} />
        </div>
      </div>
    </>
  );
}

// ─── Stage Card ────────────────────────────────────────────────────

function StageCard({
  number,
  color,
  active = false,
  children,
}: {
  number: string;
  color: 'sky' | 'violet' | 'emerald' | 'rose';
  active?: boolean;
  children: React.ReactNode;
}) {
  const colorMap = {
    sky: {
      border: 'border-sky-400/15',
      bg: 'bg-sky-500/[0.035]',
      iconBg: 'bg-sky-500/10',
      iconText: 'text-sky-300',
      iconRing: 'ring-sky-400/15',
      numColor: 'text-sky-300/60',
      glow: 'shadow-[0_0_20px_rgba(56,189,248,0.12)]',
    },
    violet: {
      border: 'border-violet-400/15',
      bg: 'bg-violet-500/[0.035]',
      iconBg: 'bg-violet-500/10',
      iconText: 'text-violet-300',
      iconRing: 'ring-violet-400/15',
      numColor: 'text-violet-300/60',
      glow: 'shadow-[0_0_20px_rgba(139,92,246,0.12)]',
    },
    emerald: {
      border: 'border-emerald-400/15',
      bg: 'bg-emerald-500/[0.035]',
      iconBg: 'bg-emerald-500/10',
      iconText: 'text-emerald-300',
      iconRing: 'ring-emerald-400/15',
      numColor: 'text-emerald-300/60',
      glow: 'shadow-[0_0_20px_rgba(16,185,129,0.12)]',
    },
    rose: {
      border: 'border-rose-400/15',
      bg: 'bg-rose-500/[0.035]',
      iconBg: 'bg-rose-500/10',
      iconText: 'text-rose-300',
      iconRing: 'ring-rose-400/15',
      numColor: 'text-rose-300/60',
      glow: 'shadow-[0_0_20px_rgba(251,113,133,0.12)]',
    },
  };

  const c = colorMap[color];

  return (
    <section
      className={cn(
        'relative flex min-w-0 flex-col justify-between gap-3 overflow-hidden rounded-lg border p-3',
        'transition-all duration-300',
        'hover:scale-[1.015] hover:border-white/[0.12]',
        c.border,
        c.bg,
        active && [c.glow, 'border-white/[0.15]'],
      )}
    >
      {/* Watermark stage number */}
      <span
        className={cn(
          'pointer-events-none absolute -right-1 -top-2 select-none text-[42px] font-black leading-none',
          'text-white/[0.025]',
        )}
        aria-hidden="true"
      >
        {number}
      </span>

      {children}
    </section>
  );
}

// ─── Main Component ────────────────────────────────────────────────

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
  holoneEnabled,
  holoneMode,
  holoneRuleCount,
  holoneFindingsCount,
  onOpenHolone,
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
      security: 'Защита',
      securityBlocking: 'Блокировка',
      securityMonitoring: 'Мониторинг',
      securityDisabled: 'Отключена',
      securityRules: 'правил',
      securityFindings: 'находок за последний час',
      securityInactive: 'Инспекция неактивна',
      securitySettings: 'Настройки',
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
      security: 'Security',
      securityBlocking: 'Blocking',
      securityMonitoring: 'Monitoring',
      securityDisabled: 'Disabled',
      securityRules: 'rules',
      securityFindings: 'findings last hour',
      securityInactive: 'Inspection inactive',
      securitySettings: 'Settings',
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

  // ─── Connector gradient colors ──────────────────────────────────
  const SKY = 'rgba(56,189,248,0.4)';
  const VIOLET = 'rgba(139,92,246,0.4)';
  const EMERALD = 'rgba(16,185,129,0.4)';
  const ROSE = 'rgba(251,113,133,0.4)';

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

      <div className="grid gap-1.5 p-2.5 min-[700px]:grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)_20px_minmax(0,1fr)_20px_minmax(0,1fr)] min-[700px]:gap-0">
        {/* ── Stage 01: Sources ── */}
        <StageCard number="01" color="sky">
          <div className="relative z-10 flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300 ring-1 ring-inset ring-sky-400/15">
              <Server size={15} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold tabular-nums text-sky-300/70">01</span>
                <h3 className="truncate text-xs font-semibold text-white">{copy.sources}</h3>
              </div>
              <p className="truncate text-[10px] text-slate-500">
                {enabledAccounts}/{accounts.length} {copy.enabled}
              </p>
            </div>
          </div>

          <div className="relative z-10 flex min-h-6 items-center gap-1.5">
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

          <Button variant="secondary" size="xs" onClick={onOpenProviders} className="relative z-10 self-start">
            {copy.manage}
          </Button>
        </StageCard>

        <FlowConnector fromColor={SKY} toColor={VIOLET} active={running} />

        {/* ── Stage 02: Rules ── */}
        <StageCard number="02" color="violet">
          <div className="relative z-10 flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-300 ring-1 ring-inset ring-violet-400/15">
              <Route size={15} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold tabular-nums text-violet-300/70">02</span>
                <h3 className="truncate text-xs font-semibold text-white">{copy.rules}</h3>
              </div>
              <p className="truncate text-[10px] capitalize text-slate-500">{routingStrategy}</p>
            </div>
          </div>

          <div className="relative z-10 flex min-h-6 items-center gap-1.5 text-[10px] text-slate-500">
            <Network size={12} className="shrink-0 text-violet-300/70" />
            <span className="truncate">
              {mappings.length > 0
                ? `${mappings.length} ${copy.mappings}`
                : copy.noMappings}
              {' · '}
              {copy.automatic}: {autoSwitchLabel}
            </span>
          </div>

          <div className="relative z-10 flex flex-wrap gap-1.5">
            <Button variant="secondary" size="xs" onClick={onOpenMappings}>
              {copy.configureMappings}
            </Button>
            <Button variant="secondary" size="xs" onClick={onOpenRotation}>
              {copy.configureRotation}
            </Button>
          </div>
        </StageCard>

        <FlowConnector fromColor={VIOLET} toColor={EMERALD} active={running} />

        {/* ── Stage 03: Proxy ── */}
        <StageCard number="03" color="emerald" active={running}>
          <div className="relative z-10 flex min-w-0 items-center gap-2.5">
            <span
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset transition-colors duration-300',
                running
                  ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/15'
                  : 'bg-white/[0.04] text-slate-600 ring-white/[0.06]',
              )}
            >
              <Power size={15} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'text-[10px] font-bold tabular-nums transition-colors duration-300',
                    running ? 'text-emerald-300/70' : 'text-slate-600',
                  )}
                >
                  03
                </span>
                <h3 className="truncate text-xs font-semibold text-white">{copy.output}</h3>
              </div>
              <p className="text-[10px] text-slate-500">
                {running ? copy.running : copy.stopped}
                {proxyStatus?.port ? ` · :${proxyStatus.port}` : ''}
              </p>
            </div>
          </div>

          <div
            className="relative z-10 min-h-6 truncate rounded-md border border-white/[0.06] bg-vsc-bg/50 px-2 py-1 font-mono text-[10px] text-slate-300"
            title={baseUrl}
          >
            {baseUrl}
          </div>

          <div className="relative z-10 flex flex-wrap gap-1.5">
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
        </StageCard>

        <FlowConnector fromColor={EMERALD} toColor={ROSE} active={running} />

        {/* ── Stage 04: Security ── */}
        <StageCard number="04" color="rose" active={running && holoneEnabled}>
          <div className="relative z-10 flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-300 ring-1 ring-inset ring-rose-400/15">
              <Shield size={15} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold tabular-nums text-rose-300/70">04</span>
                <h3 className="truncate text-xs font-semibold text-white">
                  {copy.security}
                </h3>
              </div>
              <p className="text-[10px] text-slate-500">
                {holoneEnabled ? (holoneMode === 'block' ? copy.securityBlocking : copy.securityMonitoring) : copy.securityDisabled}
                {holoneEnabled ? ` · ${holoneRuleCount} ${copy.securityRules}` : ''}
              </p>
            </div>
          </div>

          <div className="relative z-10 min-h-6 flex items-center gap-1.5 text-[10px] text-slate-500">
            <Shield size={12} className="shrink-0 text-rose-300/70" />
            <span className="truncate">
              {holoneEnabled ? `${holoneFindingsCount} ${copy.securityFindings}` : copy.securityInactive}
            </span>
          </div>

          <Button variant="secondary" size="xs" onClick={onOpenHolone} className="relative z-10 self-start">
            {copy.securitySettings}
          </Button>
        </StageCard>
      </div>
    </GlassCard>
  );
}