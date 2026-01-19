import { cn } from '../../lib/utils';
import { useState } from 'react';
import { t } from '../../lib/i18n';
import { AlertTriangle } from 'lucide-react';

interface UsageBarProps {
  used: number;
  limit: number;
  showLabel?: boolean;
  className?: string;
  isError?: boolean;
}

export function UsageBar({ used, limit, showLabel = true, className, isError = false }: UsageBarProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  // If error state (banned/expired), show error message
  if (isError && limit === 0) {
    return (
      <span className="text-[10px] text-red-400 font-medium">
        {t('usageBar.errorBanned')}
      </span>
    );
  }
  
  // limit < 0 means unlimited (API returns -1 for unlimited plans)
  if (limit < 0) {
    return (
      <span className="text-[10px] text-emerald-500 font-medium">
        {used > 0 ? `${used} / ∞` : `∞ ${t('usageBar.unlimited')}`}
      </span>
    );
  }
  
  // Hide bar entirely when quota is null/0 (uninitialized or no quota)
  if (limit === 0 && used === 0) {
    return (
      <span className="text-[10px] text-slate-600 font-medium">
        —
      </span>
    );
  }

  const remaining = Math.max(limit - used, 0);
  const usedPercent = Math.min((used / limit) * 100, 100);
  
  // Color based on usage percentage (0-70% green, 70-90% yellow, 90-100% red)
  const getBarStyles = () => {
    if (remaining === 0) {
      // Empty - gray, no glow
      return {
        colorClass: 'bg-slate-600',
        glowClass: ''
      };
    }
    if (usedPercent >= 90) {
      // Critical (90-100%) - red with glow
      return {
        colorClass: 'bg-red-500',
        glowClass: 'shadow-[0_0_8px_rgba(239,68,68,0.4)]'
      };
    }
    if (usedPercent >= 70) {
      // Warning (70-90%) - yellow with glow
      return {
        colorClass: 'bg-yellow-500',
        glowClass: 'shadow-[0_0_8px_rgba(234,179,8,0.3)]'
      };
    }
    // Good (0-70%) - green with glow
    return {
      colorClass: 'bg-emerald-500',
      glowClass: 'shadow-[0_0_10px_rgba(16,185,129,0.4)]'
    };
  };

  const { colorClass, glowClass } = getBarStyles();

  return (
    <div 
      className={cn('relative flex items-center gap-2', className)}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Warning icon when >80% used */}
      {usedPercent > 80 && (
        <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
      )}
      
      {/* Remaining number on the left */}
      {showLabel && (
        <span className="font-mono font-bold text-white text-xs w-8 text-right">
          {remaining}
        </span>
      )}
      
      {/* Progress bar on the right */}
      <div 
        className="flex-1 h-2 bg-white/15 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(usedPercent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Used: ${used} of ${limit} (${Math.round(usedPercent)}%)`}
      >
        <div
          className={cn('h-full rounded-full transition-all duration-300', colorClass, glowClass)}
          style={{ width: `${usedPercent}%` }}
        />
      </div>

      {/* Tooltip on hover showing full info */}
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-[10px] text-zinc-300 whitespace-nowrap z-50 shadow-lg">
          <span className="text-white font-medium">{used}</span>
          <span className="text-zinc-500"> / </span>
          <span className="text-zinc-400">{limit}</span>
          <span className="text-zinc-600 ml-1">{t('usageBar.used')}</span>
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-700" />
        </div>
      )}
    </div>
  );
}
