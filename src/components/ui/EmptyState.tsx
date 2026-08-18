import type { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Optional CTA rendered next to the message in compact mode, or under it in normal mode. */
  action?: ReactNode;
  /** Compact mode: single horizontal row, no big illustration. Use inside cards / panels. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
  className = '',
}: EmptyStateProps) {
  if (compact) {
    return (
      <div
        className={cn(
          'flex items-center gap-3 px-3 py-2 rounded-lg border border-dashed border-white/10 bg-white/[0.02]',
          className
        )}
      >
        <Icon className="w-4 h-4 text-slate-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-300 truncate">{title}</p>
          {description ? (
            <p className="text-[11px] text-slate-500 truncate">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col items-center justify-center py-12', className)}>
      <Icon className="w-12 h-12 text-white/20 mb-4" />
      <p className="text-white/40 text-sm font-medium">{title}</p>
      {description ? <p className="text-white/20 text-xs mt-1">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
