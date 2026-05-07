import { Activity, ArrowRight, Loader2 } from 'lucide-react';
import { GlassCard, StatusBadge, Toggle } from '@/components/ui';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/Tooltip';
import { RegistrationStatus } from '@/types/generated';

export interface AutomationHeaderCardProps {
  autoReplenishEnabled: boolean;
  totalActive: number;
  totalTarget: number;
  replenishmentStatus: RegistrationStatus | null;
  onToggle: (val: boolean) => void;
  disabled?: boolean;
}

export function AutomationHeaderCard({
  autoReplenishEnabled,
  totalActive,
  totalTarget,
  replenishmentStatus,
  onToggle,
  disabled,
}: AutomationHeaderCardProps) {
  return (
    <GlassCard
      className={cn(
        'p-3 flex items-center justify-between gap-3 relative overflow-hidden transition-all duration-500',
        autoReplenishEnabled && 'shadow-[0_0_20px_rgba(16,185,129,0.1)]'
      )}
    >
      <div className="flex items-center gap-3 z-10">
        <div
          className={cn(
            'p-2 rounded-lg bg-white/[0.05] text-slate-400 transition-colors',
            autoReplenishEnabled && 'bg-emerald-500/10 text-emerald-400'
          )}
        >
          <Activity className="w-5 h-5" />
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white tracking-tight leading-none">
              Автоматизация
            </h3>
            <StatusBadge
              status={autoReplenishEnabled ? 'active' : 'inactive'}
              size="sm"
              withDot
            />
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-slate-500 font-semibold uppercase tracking-wide leading-none">
              Статус:
            </span>
            <Tooltip content={`Текущее количество активных аккаунтов / целевое количество`}>
              <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-black/30 border border-white/5 font-mono">
                <span
                  className={cn(
                    'text-xs font-bold tabular-nums',
                    totalActive < totalTarget ? 'text-amber-400' : 'text-emerald-400'
                  )}
                >
                  {totalActive}
                </span>
                <ArrowRight className="w-2.5 h-2.5 text-slate-700" />
                <span className="text-xs font-bold text-white/20">{totalTarget}</span>
              </div>
            </Tooltip>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {replenishmentStatus?.isRunning && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-xs text-white/80 animate-pulse font-semibold">
            <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
            <span className="uppercase truncate max-w-20">
              {replenishmentStatus.provider}
            </span>
          </div>
        )}
        <Toggle
          label=""
          checked={autoReplenishEnabled}
          onChange={val => onToggle(val)}
          disabled={disabled}
          tooltip="Автоматическое пополнение аккаунтов при нехватке"
        />
      </div>
    </GlassCard>
  );
}
