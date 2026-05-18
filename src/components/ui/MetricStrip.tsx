import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type MetricTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface MetricSegment {
  /** Stable id for React reconciliation. */
  id: string;
  /** Short label above the value. */
  label: ReactNode;
  /** Numeric or string value. */
  value: ReactNode;
  /** Optional sub-text below value. */
  hint?: ReactNode;
  /** Optional icon shown next to the label. */
  icon?: ReactNode;
  /** Color tone. */
  tone?: MetricTone;
  /** Click handler — turns segment into ButtonBase. */
  onClick?: () => void;
}

export interface MetricStripProps {
  segments: MetricSegment[];
  /** Layout density. */
  density?: 'compact' | 'comfortable';
  className?: string;
}

const toneClass: Record<MetricTone, { bg: string; border: string; text: string; dot: string }> = {
  neutral: {
    bg: 'bg-white/[0.03]',
    border: 'border-white/10',
    text: 'text-slate-200',
    dot: 'bg-slate-500',
  },
  success: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    text: 'text-emerald-300',
    dot: 'bg-emerald-400',
  },
  warning: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    text: 'text-amber-300',
    dot: 'bg-amber-400',
  },
  danger: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    text: 'text-red-300',
    dot: 'bg-red-400',
  },
  info: {
    bg: 'bg-indigo-500/10',
    border: 'border-indigo-500/20',
    text: 'text-indigo-300',
    dot: 'bg-indigo-400',
  },
};

/**
 * Horizontal "traffic-light" style strip of metric segments.
 * Each segment is a small tile with label, value and optional hint/icon.
 *
 * Use for grouped KPIs like "enabled / ready / cooldown / weekly limit"
 * where we want to show all four states at once and make problems visible
 * by color instead of by separate cards.
 */
export function MetricStrip({ segments, density = 'comfortable', className }: MetricStripProps) {
  const padding = density === 'compact' ? 'p-2' : 'p-3';
  const valueSize = density === 'compact' ? 'text-base' : 'text-lg';

  return (
    <div
      className={cn(
        'flex flex-wrap gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1.5',
        className
      )}
    >
      {segments.map(seg => {
        const tone = toneClass[seg.tone ?? 'neutral'];
        const interactive = Boolean(seg.onClick);
        const Tag = interactive ? 'button' : 'div';

        return (
          <Tag
            key={seg.id}
            type={interactive ? 'button' : undefined}
            onClick={seg.onClick}
            className={cn(
              'flex-1 basis-[140px] min-w-[120px] rounded-lg border text-left transition-colors',
              padding,
              tone.bg,
              tone.border,
              interactive && 'hover:brightness-110 cursor-pointer'
            )}
          >
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
              {seg.icon ? <span className="opacity-70 shrink-0">{seg.icon}</span> : null}
              <span className="truncate flex-1">{seg.label}</span>
              <span className={cn('shrink-0 w-1.5 h-1.5 rounded-full', tone.dot)} />
            </div>
            <div className={cn('font-bold tabular-nums tracking-tight mt-0.5', valueSize, tone.text)}>
              {seg.value}
            </div>
            {seg.hint ? (
              <div className="text-[10px] text-slate-500 mt-0.5 truncate">{seg.hint}</div>
            ) : null}
          </Tag>
        );
      })}
    </div>
  );
}
