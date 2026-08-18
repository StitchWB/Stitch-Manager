import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface KeyValueRow {
  /** Stable id for React reconciliation. */
  id: string;
  /** Left column — definition term. */
  label: ReactNode;
  /** Right column — definition value. */
  value: ReactNode;
  /** Optional tone for the value (success/warning/danger/info). */
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';
}

export interface KeyValueListProps {
  rows: KeyValueRow[];
  /** Density of the list. */
  density?: 'compact' | 'comfortable';
  /** Hide last divider. */
  hideLastDivider?: boolean;
  className?: string;
}

const toneClass: Record<NonNullable<KeyValueRow['tone']>, string> = {
  default: 'text-slate-200',
  success: 'text-emerald-300',
  warning: 'text-amber-300',
  danger: 'text-red-300',
  info: 'text-indigo-300',
  muted: 'text-slate-500',
};

/**
 * Compact "label : value" definition list.
 * Use for status blocks like "Port: 30538 / Mode: full / Routing: round-robin".
 */
export function KeyValueList({
  rows,
  density = 'comfortable',
  hideLastDivider = true,
  className,
}: KeyValueListProps) {
  const rowPadding = density === 'compact' ? 'py-1' : 'py-1.5';

  return (
    <dl className={cn('flex flex-col text-xs', className)}>
      {rows.map((row, idx) => (
        <div
          key={row.id}
          className={cn(
            'flex items-center gap-3 justify-between',
            rowPadding,
            (idx < rows.length - 1 || !hideLastDivider) && 'border-b border-white/[0.04]'
          )}
        >
          <dt className="text-slate-500 truncate">{row.label}</dt>
          <dd
            className={cn(
              'tabular-nums text-right truncate min-w-0 font-medium',
              toneClass[row.tone ?? 'default']
            )}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
