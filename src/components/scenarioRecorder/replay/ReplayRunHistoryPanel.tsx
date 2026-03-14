import { useMemo } from 'react';
import { SegmentedControl, Button } from '@/components/ui';
import { t } from '@/lib/i18n';
import type { ScenarioRunItem } from '@/lib/tauri/modules/pythonJobs';
import {
  isScenarioRunFailure,
  type ReplayRunStatusFilter,
} from '@/lib/scenarioRecorder/useReplayRecentRuns';

type ReplayRunHistoryPanelProps = {
  loading: boolean;
  error: string | null;
  runs: ScenarioRunItem[];
  statusFilter: ReplayRunStatusFilter;
  onStatusFilterChange: (value: ReplayRunStatusFilter) => void;
  onOpenRun: (run: ScenarioRunItem) => void;
};

function formatRunTime(ts?: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function formatDuration(durationMs?: number | null): string {
  if (durationMs == null) return '—';
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${Math.round(durationMs / 100) / 10}s`;
}

function statusTone(status: string): string {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'succeeded' || normalized === 'done' || normalized === 'success') {
    return 'text-emerald-300';
  }
  if (isScenarioRunFailure(status)) {
    return 'text-red-300';
  }
  return 'text-slate-300';
}

export function ReplayRunHistoryPanel({
  loading,
  error,
  runs,
  statusFilter,
  onStatusFilterChange,
  onOpenRun,
}: ReplayRunHistoryPanelProps) {
  const visibleRuns = useMemo(() => {
    const base =
      statusFilter === 'errors' ? runs.filter(run => isScenarioRunFailure(run.status)) : runs;
    return base.slice(0, 5);
  }, [runs, statusFilter]);

  const isFilterOption = (value: string): value is ReplayRunStatusFilter =>
    value === 'all' || value === 'errors';

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-slate-400">{t('recorder.replay.recentRunsTitle')}</div>
        <SegmentedControl
          size="sm"
          stretch={false}
          value={statusFilter}
          onChange={value => {
            if (isFilterOption(value)) {
              onStatusFilterChange(value);
            }
          }}
          options={[
            { label: t('recorder.replay.runsFilterAll'), value: 'all' },
            { label: t('recorder.replay.runsFilterErrors'), value: 'errors' },
          ]}
        />
      </div>

      {loading ? <div className="text-xs text-slate-500">{t('common.loading')}</div> : null}
      {!loading && error ? (
        <div className="text-xs text-amber-300">
          {t('recorder.replay.recentRunsError', { error })}
        </div>
      ) : null}

      {!loading && !error && visibleRuns.length === 0 ? (
        <div className="text-xs text-slate-500">{t('recorder.replay.recentRunsEmpty')}</div>
      ) : null}

      {!loading && !error && visibleRuns.length > 0 ? (
        <div className="space-y-2">
          {visibleRuns.map(run => (
            <div
              key={run.id}
              className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className={statusTone(run.status)}>{run.status}</div>
                <div className="text-slate-500">{formatRunTime(run.startedAt)}</div>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                {t('recorder.replay.runDurationLabel')}: {formatDuration(run.durationMs)}
              </div>
              {run.error ? (
                <div className="mt-1 text-[11px] text-red-300 truncate" title={run.error}>
                  {run.error}
                </div>
              ) : null}
              <div className="mt-2">
                <Button size="xs" variant="secondary" onClick={() => onOpenRun(run)}>
                  {t('recorder.replay.openRunDetails')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
