import { ReactNode } from 'react';
import { ChevronRight, Check, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { t } from '../../lib/i18n';
import { GlassCard } from './GlassCard';

export type ModuleStatus = 'ready' | 'warning' | 'error' | 'idle';

interface ModuleCardProps {
  id: string;
  title: string;
  icon: ReactNode;
  status: ModuleStatus;
  summary?: string;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
  disabled?: boolean;
}

const STATUS_CONFIG = {
  ready: { dot: 'bg-emerald-500', glow: 'shadow-emerald-500/50', text: 'text-emerald-400' },
  warning: { dot: 'bg-amber-500', glow: 'shadow-amber-500/50', text: 'text-amber-400' },
  error: { dot: 'bg-red-500', glow: 'shadow-red-500/50', text: 'text-red-400' },
  idle: { dot: 'bg-slate-600', glow: '', text: 'text-slate-500' },
};

export function ModuleCard({ 
  id, 
  title, 
  icon, 
  status, 
  summary, 
  isExpanded, 
  onToggle, 
  children,
  disabled 
}: ModuleCardProps) {
  const config = STATUS_CONFIG[status];

  return (
    <GlassCard className={cn(
      'overflow-hidden transition-colors',
      disabled && 'opacity-50 pointer-events-none'
    )}>
      {/* Header - Always visible */}
      <button
        onClick={() => onToggle(id)}
        className={cn(
          'w-full flex items-center justify-between p-3 transition-colors',
          !disabled && 'hover:bg-white/[0.02]',
          disabled && 'cursor-not-allowed opacity-60'
        )}
        aria-expanded={isExpanded}
        aria-controls={`module-content-${id}`}
        id={`module-header-${id}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Icon */}
          <div className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors',
            isExpanded ? 'bg-indigo-500/20 text-indigo-400' : 'bg-white/[0.05] text-slate-500'
          )}>
            {icon}
          </div>

          {/* Title & Summary */}
          <div className="flex-1 min-w-0 text-left">
            <div className="text-sm font-semibold text-white truncate">{title}</div>
            {summary && !isExpanded && (
              <div className={cn('text-xs font-mono truncate', config.text)}>
                {summary}
              </div>
            )}
            {!summary && !isExpanded && status === 'idle' && (
              <div className="text-xs text-slate-500">{t('status.notConfigured')}</div>
            )}
          </div>
        </div>

        {/* Status Indicator */}
        <div className="flex items-center gap-2 shrink-0">
          {status === 'ready' && !isExpanded && (
            <Check className="w-4 h-4 text-emerald-500" />
          )}
          {status === 'error' && !isExpanded && (
            <AlertCircle className="w-4 h-4 text-red-500" />
          )}
          <div className={cn(
            'w-2 h-2 rounded-full transition-all',
            config.dot,
            config.glow && `shadow-[0_0_8px] ${config.glow}`
          )} />
          <ChevronRight className={cn(
            'w-4 h-4 text-slate-500 transition-transform duration-200',
            isExpanded && 'rotate-90'
          )} />
        </div>
      </button>

      {/* Content - Expandable */}
      <div 
        id={`module-content-${id}`}
        className={cn(
          'overflow-hidden transition-all duration-200 ease-out',
          isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        )}
        role="region"
        aria-labelledby={`module-header-${id}`}
      >
        <div className="px-3 pb-3 pt-1 space-y-3">
          {children}
        </div>
      </div>
    </GlassCard>
  );
}
