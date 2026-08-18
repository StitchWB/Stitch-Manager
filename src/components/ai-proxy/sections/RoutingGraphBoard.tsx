import { useMemo } from 'react';
import { Server, Route, Power, Shield, CheckCircle2, Minimize2 } from 'lucide-react';
import { Button, GlassCard, ProviderLogo, StatusBadge } from '@/components/ui';
import type { ProviderModelMapping } from '@/lib/backend/modules/aiProxy';
import type { AiProxyAccount, ProxySettings, ProxyStatus } from '@/types/generated';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app';

// ponytail: CSS-only routing graph — no ReactFlow, no deps, just divs

// ─── Types ───────────────────────────────────────────────────────────────────

type NodeColor = 'sky' | 'violet' | 'amber' | 'emerald' | 'rose' | 'indigo';

interface StageNodeData {
  label: string;
  subtitle: string;
  detail: string;
  icon: React.ReactNode;
  color: NodeColor;
  active: boolean;
  statusLabel?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionVariant?: 'primary' | 'secondary' | 'danger';
  actionDisabled?: boolean;
  action2Label?: string;
  onAction2?: () => void;
  providerLogos?: { provider: string; enabled: number; total: number }[];
}

// ─── Color config ────────────────────────────────────────────────────────────

const COLORS: Record<NodeColor, {
  ring: string;
  iconBg: string;
  iconText: string;
  glow: string;
  dot: string;
}> = {
  sky:     { ring: 'ring-sky-400/30',     iconBg: 'bg-sky-500/20',     iconText: 'text-sky-300',     glow: 'shadow-[0_0_24px_rgba(56,189,248,0.25)]',     dot: 'bg-sky-400'     },
  violet:  { ring: 'ring-violet-400/30',  iconBg: 'bg-violet-500/20',  iconText: 'text-violet-300',  glow: 'shadow-[0_0_24px_rgba(139,92,246,0.25)]',  dot: 'bg-violet-400'  },
  amber:   { ring: 'ring-amber-400/30',   iconBg: 'bg-amber-500/20',   iconText: 'text-amber-300',   glow: 'shadow-[0_0_24px_rgba(245,158,11,0.25)]',   dot: 'bg-amber-400'   },
  emerald: { ring: 'ring-emerald-400/30', iconBg: 'bg-emerald-500/20', iconText: 'text-emerald-300', glow: 'shadow-[0_0_24px_rgba(16,185,129,0.25)]',   dot: 'bg-emerald-400' },
  rose:    { ring: 'ring-rose-400/30',    iconBg: 'bg-rose-500/20',    iconText: 'text-rose-300',    glow: 'shadow-[0_0_24px_rgba(251,113,133,0.25)]', dot: 'bg-rose-400'    },
  indigo:  { ring: 'ring-indigo-400/30',  iconBg: 'bg-indigo-500/20',  iconText: 'text-indigo-300',  glow: 'shadow-[0_0_24px_rgba(99,102,241,0.25)]',  dot: 'bg-indigo-400'  },
};

// ─── Node ────────────────────────────────────────────────────────────────────

function NodeCard({ data, stageNumber }: { data: StageNodeData; stageNumber: number }) {
  const c = COLORS[data.color];
  return (
    <div
      className={cn(
        'group relative flex w-[200px] flex-col gap-2.5 rounded-xl border p-3.5',
        'bg-gradient-to-br from-[#1a2340] to-[#0f172a]',
        'transition-all duration-200',
        'hover:scale-[1.03] hover:border-white/30',
        c.ring,
        data.active && [c.glow, 'animate-pulse-slow'],
      )}
    >
      {/* Stage number badge */}
      <div className={cn('absolute -top-2 -left-2 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-[#0f172a]', c.iconBg)}>
        {stageNumber}
      </div>

      {/* Icon + Title */}
      <div className="flex items-center gap-2.5">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-white/10', c.iconBg, c.iconText)}>
          {data.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold text-white">{data.label}</div>
          <div className="truncate text-[11px] text-slate-400">{data.subtitle}</div>
        </div>
      </div>

      {/* Detail */}
      <div className="min-h-[20px]">
        {data.providerLogos ? (
          <div className="flex items-center gap-2">
            <div className="flex -space-x-0.5">
              {data.providerLogos.slice(0, 3).map(p => (
                  <span key={p.provider} className="flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-slate-800" title={`${p.provider}: ${p.enabled}/${p.total}`}>
                  <ProviderLogo provider={p.provider} size={12} colored />
                </span>
              ))}
            </div>
            <span className="truncate text-[11px] text-slate-400">{data.detail}</span>
          </div>
        ) : (
            <div className="truncate rounded-md border border-white/[0.06] bg-slate-800/50 px-2 py-1 text-[11px] text-slate-300" title={data.detail}>
            {data.detail}
          </div>
        )}
      </div>

      {/* Status + Action */}
      <div className="flex items-center justify-between gap-1.5">
        {data.statusLabel ? (
          <div className="flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', data.active ? c.dot : 'bg-slate-600')} />
            <span className="text-[10px] text-slate-400">{data.statusLabel}</span>
          </div>
        ) : <span />}
        <div className="flex items-center gap-1">
          {data.actionLabel && data.onAction && (
            <Button variant={data.actionVariant || 'secondary'} size="xs" onClick={data.onAction} disabled={data.actionDisabled}>
              {data.actionLabel}
            </Button>
          )}
          {data.action2Label && data.onAction2 && (
            <Button variant="secondary" size="xs" onClick={data.onAction2}>{data.action2Label}</Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Connector ───────────────────────────────────────────────────────────────

function HConnector({ active, fromColor, toColor }: { active: boolean; fromColor: string; toColor: string }) {
  return (
    <div className="relative flex h-10 w-10 items-center justify-center">
      <div
        className="absolute h-[2px] w-full rounded-full"
        style={{
          background: `linear-gradient(90deg, ${fromColor}, ${toColor})`,
          opacity: active ? 0.7 : 0.2,
        }}
      />
      <div
        className={cn(
          'relative z-10 h-2 w-2 rounded-full transition-all',
          active ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]' : 'bg-slate-600',
        )}
      />
      {active && (
        <div
          className="absolute h-2 w-2 rounded-full bg-white"
          style={{
            animation: 'flow-dot-h 2s ease-in-out infinite',
            boxShadow: '0 0 6px rgba(255,255,255,0.6)',
          }}
        />
      )}
    </div>
  );
}

function VConnector({ active, fromColor, toColor }: { active: boolean; fromColor: string; toColor: string }) {
  return (
    <div className="relative flex h-10 w-10 items-center justify-center">
      <div
        className="absolute w-[2px] h-full rounded-full"
        style={{
          background: `linear-gradient(180deg, ${fromColor}, ${toColor})`,
          opacity: active ? 0.7 : 0.2,
        }}
      />
      <div
        className={cn(
          'relative z-10 h-2 w-2 rounded-full transition-all',
          active ? 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]' : 'bg-slate-600',
        )}
      />
      {active && (
        <div
          className="absolute h-2 w-2 rounded-full bg-white"
          style={{
            animation: 'flow-dot-v 2s ease-in-out infinite',
            boxShadow: '0 0 6px rgba(255,255,255,0.6)',
          }}
        />
      )}
    </div>
  );
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface RoutingGraphBoardProps {
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
  cavemanEnabled: boolean;
  cavemanLevel: 'lite' | 'full' | 'ultra';
  compressionEnabled: boolean;
  onOpenCompression: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RoutingGraphBoard(props: RoutingGraphBoardProps) {
  const language = useAppStore(state => state.language);
  const isRu = language === 'ru';
  const running = Boolean(props.proxyStatus?.running);
  const routingStrategy = (props.proxySettings?.routingStrategy || 'round-robin').replace(/-/g, ' ');

  const c = isRu
    ? {
        sources: 'Источники', avail: 'доступно', manage: 'Открыть',
        rules: 'Правила', mappings: 'маппингов', def: 'По умолчанию', map: 'Маппинги', rot: 'Ротация', auto: 'Авто', on: 'вкл', off: 'выкл',
        caveman: 'Caveman', comp: 'Компрессия', off2: 'Выкл', cfg: 'Настр.',
        proxy: 'AI Proxy', run: 'Работает', stop: 'Остановлен', set: 'Настр.', start: 'Старт', stop2: 'Стоп',
        holone: 'Holone', block: 'Блок', mon: 'Монитор', dis: 'Выкл', rules2: 'правил', find: 'находок', sec: 'Безоп.',
        resp: 'Ответ', done: 'Готово',
      }
    : {
        sources: 'Sources', avail: 'avail', manage: 'Open',
        rules: 'Rules', mappings: 'mappings', def: 'Default', map: 'Mappings', rot: 'Rotation', auto: 'Auto', on: 'on', off: 'off',
        caveman: 'Caveman', comp: 'Compress', off2: 'Off', cfg: 'Config',
        proxy: 'AI Proxy', run: 'Running', stop: 'Stopped', set: 'Config', start: 'Start', stop2: 'Stop',
        holone: 'Holone', block: 'Block', mon: 'Monitor', dis: 'Off', rules2: 'rules', find: 'finds', sec: 'Security',
        resp: 'Response', done: 'Done',
      };

  const sourceSummary = useMemo(() => {
    const grouped = new Map<string, { provider: string; total: number; enabled: number }>();
    for (const a of props.accounts) {
      const cur = grouped.get(a.provider) ?? { provider: a.provider, total: 0, enabled: 0 };
      cur.total++; if (a.enabled) cur.enabled++; grouped.set(a.provider, cur);
    }
    return Array.from(grouped.values()).sort((a, b) => b.enabled - a.enabled);
  }, [props.accounts]);
  const enabledAccounts = sourceSummary.reduce((s, x) => s + x.enabled, 0);
  const autoLabel = props.autoSwitchEnabled === null ? '?' : props.autoSwitchEnabled ? c.on : c.off;

  // 6 nodes, zigzag layout
  const nodes: StageNodeData[] = [
    // Row 1 (L→R)
    {
      label: c.sources, subtitle: `${enabledAccounts}/${props.accounts.length} ${c.avail}`,
      detail: `${sourceSummary.length} prov`,
      icon: <Server size={16} />, color: 'sky', active: running,
      providerLogos: sourceSummary.slice(0, 3),
      actionLabel: c.manage, onAction: props.onOpenProviders,
    },
    {
      label: c.rules, subtitle: routingStrategy,
      detail: props.mappings.length > 0 ? `${props.mappings.length} ${c.mappings} · ${c.auto}:${autoLabel}` : `${c.def} · ${c.auto}:${autoLabel}`,
      icon: <Route size={16} />, color: 'violet', active: running,
      actionLabel: c.map, onAction: props.onOpenMappings,
      action2Label: c.rot, onAction2: props.onOpenRotation,
    },
    {
      label: c.caveman, subtitle: c.comp,
      detail: props.cavemanEnabled ? `${props.cavemanLevel}` : c.off2,
      icon: <Minimize2 size={16} />, color: 'amber', active: running && props.cavemanEnabled,
      statusLabel: props.cavemanEnabled ? props.cavemanLevel.toUpperCase() : c.off2,
      actionLabel: c.cfg, onAction: props.onOpenCompression,
    },
    // Row 2 (L→R)
    {
      label: c.proxy, subtitle: running ? c.run : c.stop,
      detail: props.baseUrl,
      icon: <Power size={16} />, color: 'emerald', active: running,
      statusLabel: running ? c.run : c.stop,
      actionLabel: running ? c.stop2 : c.start,
      actionVariant: running ? 'danger' : 'primary',
      onAction: props.onStartStopProxy, actionDisabled: props.proxyBusy,
      action2Label: c.set, onAction2: props.onOpenProxy,
    },
    {
      label: c.holone, subtitle: props.holoneEnabled ? (props.holoneMode === 'block' ? c.block : c.mon) : c.dis,
      detail: props.holoneEnabled ? `${props.holoneRuleCount} ${c.rules2}` : c.dis,
      icon: <Shield size={16} />, color: 'rose', active: running && props.holoneEnabled,
      statusLabel: props.holoneEnabled ? (props.holoneMode === 'block' ? c.block : c.mon) : c.dis,
      actionLabel: c.sec, onAction: props.onOpenHolone,
    },
    {
      label: c.resp, subtitle: c.done,
      detail: running ? '200' : '—',
      icon: <CheckCircle2 size={16} />, color: 'indigo', active: running,
    },
  ];

  const colors = ['#38bdf8', '#8b5cf6', '#f59e0b', '#10b981', '#fb7185', '#6366f1'];

  return (
    <GlassCard className="overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-3.5 py-2.5">
        <div className="min-w-0">
          <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-indigo-300/70">
            {isRu ? 'Путь запроса' : 'Request path'}
          </span>
          <h2 className="text-sm font-semibold leading-tight text-white">
            {isRu ? 'Маршрутизация' : 'Routing'}
          </h2>
        </div>
        <StatusBadge status={running ? 'active' : 'inactive'} size="sm" withDot>
          {running ? c.run : c.stop}
        </StatusBadge>
      </div>

      {/* Graph — zigzag 2×3 */}
      <div
        className="relative p-5"
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
        }}
      >
        {/* Subtle grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        />

        {/* Row 1: sources → rules → caveman */}
        <div className="relative flex items-center justify-center gap-0">
          <NodeCard data={nodes[0]} stageNumber={1} />
          <HConnector active={running} fromColor={colors[0]} toColor={colors[1]} />
          <NodeCard data={nodes[1]} stageNumber={2} />
          <HConnector active={running} fromColor={colors[1]} toColor={colors[2]} />
          <NodeCard data={nodes[2]} stageNumber={3} />
        </div>

        {/* Vertical: caveman → proxy */}
        <div className="relative flex justify-end pr-[100px]">
          <VConnector active={running} fromColor={colors[2]} toColor={colors[3]} />
        </div>

        {/* Row 2: proxy → holone → response */}
        <div className="relative flex items-center justify-center gap-0">
          <NodeCard data={nodes[3]} stageNumber={4} />
          <HConnector active={running} fromColor={colors[3]} toColor={colors[4]} />
          <NodeCard data={nodes[4]} stageNumber={5} />
          <HConnector active={running} fromColor={colors[4]} toColor={colors[5]} />
          <NodeCard data={nodes[5]} stageNumber={6} />
        </div>
      </div>

      <style>{`
        @keyframes flow-dot-h {
          0% { transform: translateX(-16px); opacity: 0; }
          20% { opacity: 1; }
          80% { opacity: 1; }
          100% { transform: translateX(16px); opacity: 0; }
        }
        @keyframes flow-dot-v {
          0% { transform: translateY(-16px); opacity: 0; }
          20% { opacity: 1; }
          80% { opacity: 1; }
          100% { transform: translateY(16px); opacity: 0; }
        }
        @keyframes pulse-slow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.85; }
        }
        .animate-pulse-slow {
          animation: pulse-slow 3s ease-in-out infinite;
        }
      `}</style>
    </GlassCard>
  );
}
