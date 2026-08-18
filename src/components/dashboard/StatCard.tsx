import React from 'react';
import { TrendingUp } from 'lucide-react';
import { t } from '@/lib/i18n';
import { Sparkline } from './Sparkline';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: { value: string; positive: boolean };
  className?: string;
}

export const StatCard = React.memo(function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  className = '',
}: StatCardProps) {
  // Fix NaN display: if value is NaN or null/undefined, show "—"
  // If value is 0, show "0"
  const isValuePresent =
    value !== null && value !== undefined && !(typeof value === 'number' && isNaN(value));
  const displayValue = isValuePresent ? value : t('common.notAvailable');
  const isPlaceholder = !isValuePresent;

  return (
    <div
      className={`relative p-4 flex flex-col gap-3 rounded-xl transition-all duration-300 hover:shadow-glow-purple h-full ${className}`}
      style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.04), transparent)' }}
    >
      {/* Large faint icon in top-right */}
      <div className="absolute top-3 right-3 opacity-[0.08] pointer-events-none">
        {React.cloneElement(icon as React.ReactElement, { size: 56 })}
      </div>

      <div className="flex items-center justify-between relative z-10">
        <span className="w-8 h-8 text-purple-400 flex items-center justify-center rounded-lg bg-purple-500/10">
          {React.cloneElement(icon as React.ReactElement, { size: 18 })}
        </span>
        {trend && !isPlaceholder && (
          <div className="flex items-center gap-2">
            <Sparkline />
            <span
              className={`text-2xs font-medium flex items-center gap-1 ${trend.positive ? 'text-emerald-400' : 'text-red-400'}`}
            >
              <TrendingUp size={12} className={!trend.positive ? 'rotate-180' : ''} />
              {trend.value}
            </span>
          </div>
        )}
      </div>
      <div className="relative z-10 min-w-0">
        <p
          className={`text-3xl font-bold tracking-tight tabular-nums leading-none ${isPlaceholder ? 'text-slate-600' : 'text-white'}`}
        >
          {displayValue}
        </p>
        <p className="text-[10px] uppercase text-slate-500 tracking-wider mt-2 truncate">
          {title}
        </p>
        {subtitle && <p className="text-2xs text-slate-600 mt-0.5 truncate">{subtitle}</p>}
      </div>
    </div>
  );
});
