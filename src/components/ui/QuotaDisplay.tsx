import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';
import { t } from '../../lib/i18n';

interface QuotaDisplayProps {
  used: number;
  limit: number;
  className?: string;
  variant?: 'default' | 'compact';
}

const formatValue = (val: number, compact = true) => {
  if (val < 0) return '∞';
  return new Intl.NumberFormat('en-US', {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(val);
};

export const QuotaDisplay = React.memo(function QuotaDisplay({
  used,
  limit,
  className,
  variant = 'default',
}: QuotaDisplayProps) {
  const isUnlimited = limit < 0;
  const isUnknown = !isUnlimited && limit === 0 && used === 0;
  const isOver = !isUnlimited && limit > 0 && used > limit;
  const percent = isUnlimited
    ? 100
    : isUnknown
      ? 0
      : limit > 0
        ? Math.min((used / limit) * 100, 100)
        : 0;

  const getStatusColor = () => {
    if (isOver) return 'text-red-400';
    if (percent > 90) return 'text-orange-400';
    if (percent > 75) return 'text-amber-400';
    return 'text-emerald-400';
  };

  const getBarColor = () => {
    if (isOver) return 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]';
    if (percent > 90) return 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.4)]';
    if (percent > 75) return 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]';
    return 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]';
  };

  if (variant === 'compact') {
    return (
      <div className={cn('flex flex-col gap-0.5 w-full min-w-0', className)}>
        <div className="flex items-baseline gap-1.5">
          <span
            className={cn(
              'text-xs font-bold tabular-nums leading-none',
              getStatusColor()
            )}
          >
            {isUnknown ? '—' : `${Math.round(percent)}%`}
          </span>
          <span className="text-[9px] text-slate-500 tabular-nums truncate">
            {isUnknown ? '' : `${formatValue(used)} / ${formatValue(limit)}`}
          </span>
        </div>
        <div className="h-1 w-full bg-white/[0.04] rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full', getBarColor())}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-2 w-full', className)}>
      <div className="flex justify-between items-end">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase font-black tracking-widest text-slate-500 mb-0.5">
            {t('dashboard.quotaUsage')}
          </span>
          <div className="flex items-baseline gap-1.5">
            <span
              className={cn(
                'text-2xl font-black tracking-tighter tabular-nums leading-none',
                getStatusColor()
              )}
            >
              {isUnknown ? '—' : `${Math.round(percent)}%`}
            </span>
            <span className="text-xs text-slate-400 font-bold tabular-nums uppercase tracking-tight">
              {t('usageBar.used')}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end">
          <div className="text-[11px] font-bold tabular-nums text-slate-300">
            {isUnknown ? 'Unknown' : formatValue(used, false)}
          </div>
          <div className="text-[10px] font-bold tabular-nums text-slate-500 uppercase tracking-tighter">
            / {isUnlimited ? 'Unlimited' : isUnknown ? 'Unknown' : formatValue(limit, false)}
          </div>
        </div>
      </div>

      <div className="h-2 w-full bg-white/5 rounded-full p-0.5 border border-white/5 relative overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 1.2, ease: 'circOut' }}
          className={cn('h-full rounded-full relative z-10', getBarColor())}
        />
        {/* Glow effect */}
        <div
          className={cn('absolute inset-0 opacity-20 blur-sm', getBarColor())}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
});
