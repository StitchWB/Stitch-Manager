import { cn } from '../../lib/utils';
import { t } from '../../lib/i18n';

interface UsageBarProps {
  used: number;
  limit: number;
  className?: string;
  isError?: boolean;
}

export function UsageBar({ used, limit, className, isError = false }: UsageBarProps) {
  // Error state
  if (isError && limit === 0) {
    return (
      <span className="text-[10px] text-red-400 font-semibold px-2 py-0.5 rounded bg-red-500/10">
        {t('usageBar.errorBanned')}
      </span>
    );
  }

  // Unlimited quota
  if (limit < 0) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-slate-400 font-medium tabular-nums">{used} / {t('usageBar.infinity')}</span>
        <div className="h-1 bg-emerald-500/20 rounded-full overflow-hidden">
          <div className="h-full w-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
        </div>
      </div>
    );
  }

  // Empty quota
  if (limit === 0 && used === 0) {
    return <span className="text-xs text-slate-600 font-medium">{t('usageBar.unknown')}</span>;
  }

  const usedPercent = Math.min((used / limit) * 100, 100);
  const remaining = Math.max(limit - used, 0);

  const getBarColor = () => {
    if (remaining === 0) return 'bg-slate-600';
    if (usedPercent >= 90) return 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]';
    if (usedPercent >= 70) return 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]';
    return 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]';
  };

  const barColor = getBarColor();

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="text-[10px] text-slate-400 font-medium tabular-nums">
        {used} / {limit}
      </span>
      <div className="h-1 bg-white/5 rounded-full overflow-hidden">
        <div
          className={cn('h-full transition-all duration-700', barColor)}
          style={{ width: `${usedPercent}%` }}
        />
      </div>
    </div>
  );
}
