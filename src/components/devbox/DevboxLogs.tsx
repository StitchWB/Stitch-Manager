import { useMemo } from 'react';
import { ListFilter } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';
import { t } from '@/lib/i18n';
import type { DevboxEventRow, DevboxRecentAction } from '@/lib/backend/modules/devbox';
import { DevboxConsole } from './DevboxConsole';
import { devboxEventTone } from './eventLine';

export interface DevboxLogsProps {
  events: DevboxEventRow[];
  recent: DevboxRecentAction[] | null;
  error: string | null;
  onRetry: () => void;
}

export function DevboxLogs({ events, recent, error, onRetry }: DevboxLogsProps) {
  const counts = useMemo(() => {
    let warnings = 0;
    let errors = 0;
    for (const row of events) {
      const tone = devboxEventTone(row);
      if (tone === 'failed') errors += 1;
      else if (tone === 'attention') warnings += 1;
    }
    return { total: events.length, warnings, errors };
  }, [events]);

  const stats = [
    { id: 'total', label: t('devboxPage.logsStatsTotal'), value: counts.total, className: 'text-slate-300' },
    { id: 'info', label: t('devboxPage.logsStatsInfo'), value: Math.max(0, counts.total - counts.warnings - counts.errors), className: 'text-sky-300' },
    { id: 'warnings', label: t('devboxPage.logsStatsWarnings'), value: counts.warnings, className: 'text-amber-300' },
    { id: 'errors', label: t('devboxPage.logsStatsErrors'), value: counts.errors, className: 'text-red-300' },
  ];

  return (
    <div className="flex min-h-0 flex-col gap-3" data-testid="devbox-logs">
      <GlassCard className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <ListFilter size={16} className="shrink-0 text-indigo-300" aria-hidden />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white">{t('devboxPage.logsTitle')}</h3>
            <p className="truncate text-2xs text-slate-400">{t('devboxPage.logsStatsStrip')}</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3" data-testid="devbox-logs-stats">
          {stats.map(stat => (
            <span
              key={stat.id}
              className="flex items-center gap-1.5 text-2xs text-slate-500"
              data-testid={`devbox-logs-stat-${stat.id}`}
            >
              <span className="uppercase tracking-wider">{stat.label}</span>
              <span className={`font-mono tabular-nums ${stat.className}`}>{stat.value}</span>
            </span>
          ))}
        </div>
      </GlassCard>
      <DevboxConsole
        className="min-h-[55vh] lg:min-h-0 lg:flex-1"
        events={events}
        recent={recent}
        error={error}
        onRetry={onRetry}
      />
    </div>
  );
}