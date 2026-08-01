import { cn } from '../../lib/utils';
import type { KeyHealthStatus } from '@/lib/backend/modules/keyHealth';

const STATUS_CONFIG: Record<KeyHealthStatus, { dot: string; text: string; bg: string; label: string }> = {
  healthy: { dot: 'bg-emerald-400', text: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Healthy' },
  flaky: { dot: 'bg-amber-400', text: 'text-amber-400', bg: 'bg-amber-500/10', label: 'Flaky' },
  broken: { dot: 'bg-red-400', text: 'text-red-400', bg: 'bg-red-500/10', label: 'Broken' },
  expired: { dot: 'bg-slate-400', text: 'text-slate-400', bg: 'bg-slate-500/10', label: 'Expired' },
  unknown: { dot: 'bg-slate-500', text: 'text-slate-500', bg: 'bg-transparent', label: 'Unknown' },
};

interface KeyHealthBadgeProps {
  status: KeyHealthStatus;
  className?: string;
}

export function KeyHealthBadge({ status, className }: KeyHealthBadgeProps) {
  const config = STATUS_CONFIG[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        config.bg,
        config.text,
        status === 'unknown' && 'border border-white/15',
        className,
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', config.dot)} />
      {config.label}
    </span>
  );
}

export function getHealthSummary(records: { status: KeyHealthStatus }[]): {
  healthy: number;
  flaky: number;
  broken: number;
  expired: number;
  unknown: number;
  total: number;
} {
  const summary = { healthy: 0, flaky: 0, broken: 0, expired: 0, unknown: 0, total: records.length };
  for (const r of records) {
    summary[r.status]++;
  }
  return summary;
}