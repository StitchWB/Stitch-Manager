import { AlertTriangle, Blocks, Users, Zap } from 'lucide-react';

import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { StatItem } from '@/components/ui/StatItem';

import { TweenNumber } from './TweenNumber';

interface MicroStatsProps {
  total: number;
  delta7d: number;
  activePct: number;
  nearLimit: number;
  pluginsRunning: number;
  pluginsTotal: number;
  onNearLimitClick: () => void;
}

export function MicroStats({
  total,
  delta7d,
  activePct,
  nearLimit,
  pluginsRunning,
  pluginsTotal,
  onNearLimitClick,
}: MicroStatsProps) {
  const nearLimitAlert = nearLimit > 0;

  return (
    <div className="flex items-center gap-0.5" data-testid="micro-stats">
      <StatItem
        tooltip={t('dashboard.cc.stats.totalAccounts')}
        icon={<Users size={14} />}
        value={
          <>
            <TweenNumber
              value={total}
              className="text-[24px] bg-gradient-to-r from-indigo-300 via-violet-300 to-indigo-200 bg-clip-text text-transparent font-semibold tabular-nums leading-none"
            />
            {delta7d > 0 && (
              <span className="text-[10px] tabular-nums text-emerald-400 leading-none">
                +{delta7d}
              </span>
            )}
          </>
        }
      />

      <StatItem
        tooltip={t('dashboard.cc.stats.activeShare', { pct: activePct })}
        icon={<Zap size={14} />}
        value={
          <span className="text-[13px] tabular-nums font-medium leading-none">{activePct}%</span>
        }
      />

      <StatItem
        tooltip={t('dashboard.cc.stats.nearLimit', { count: nearLimit })}
        icon={
          <AlertTriangle size={14} className={nearLimitAlert ? 'text-red-400' : undefined} />
        }
        onClick={nearLimitAlert ? onNearLimitClick : undefined}
        value={
          <TweenNumber
            value={nearLimit}
            className={cn(
              'text-[13px] tabular-nums font-medium leading-none',
              nearLimitAlert && 'text-red-400',
            )}
          />
        }
      />

      <StatItem
        tooltip={t('dashboard.cc.stats.plugins', {
          running: pluginsRunning,
          total: pluginsTotal,
        })}
        icon={<Blocks size={14} />}
        value={
          <span className="text-[13px] tabular-nums font-medium leading-none">
            {pluginsRunning}
            <span className="text-slate-600">/{pluginsTotal}</span>
          </span>
        }
      />
    </div>
  );
}
