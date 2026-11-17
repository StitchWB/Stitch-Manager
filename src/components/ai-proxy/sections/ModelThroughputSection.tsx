import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';

import type { ModelThroughputRow } from '@/lib/backend/modules/aiGateway';
import { listModelThroughput } from '@/lib/backend/modules/aiGateway';
import {
  EmptyState,
  IconButton,
  SegmentedControl,
  SkeletonLoader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

const WINDOWS = [
  { value: '15', minutes: 15, labelKey: 'aiHub.throughput.window15' },
  { value: '60', minutes: 60, labelKey: 'aiHub.throughput.window60' },
  { value: '1440', minutes: 1440, labelKey: 'aiHub.throughput.window1440' },
] as const;

const AUTO_REFRESH_MS = 15_000;

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const diffSec = Math.round((then - Date.now()) / 1000);
  if (Math.abs(diffSec) < 60) return rtf.format(diffSec, 'second');
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
  return rtf.format(Math.round(diffMin / 60), 'hour');
}

function tpsClass(tps: number): string {
  if (tps >= 40) return 'text-emerald-400';
  if (tps >= 15) return 'text-amber-400';
  return 'text-slate-400';
}

export function ModelThroughputSection() {
  const [windowValue, setWindowValue] = useState<string>('60');
  const [rows, setRows] = useState<ModelThroughputRow[]>([]);
  const [totalModels, setTotalModels] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const windowMinutes =
    WINDOWS.find(w => w.value === windowValue)?.minutes ?? 60;

  const load = useCallback(
    async (minutes: number, initial: boolean) => {
      if (initial) setLoading(true);
      else setRefreshing(true);
      try {
        const page = await listModelThroughput({ windowMinutes: minutes, limit: 0 });
        if (!mountedRef.current) return;
        setRows(page.models);
        setTotalModels(page.totalModels);
        setError(null);
      } catch (e) {
        if (!mountedRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void load(windowMinutes, true);
  }, [windowMinutes, load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(windowMinutes, false);
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [windowMinutes, load]);

  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            {t('aiHub.throughput.title')}
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            {t('aiHub.throughput.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedControl
            size="sm"
            stretch={false}
            value={windowValue}
            onChange={setWindowValue}
            options={WINDOWS.map(w => ({ value: w.value, label: t(w.labelKey) }))}
          />
          <Tooltip content={t('aiHub.actions.refresh')}>
            <IconButton
              size="md"
              variant="ghost"
              onClick={() => void load(windowMinutes, false)}
              disabled={loading || refreshing}
              aria-label={t('aiHub.actions.refresh')}
            >
              <RefreshCw size={16} className={refreshing ? 'animate-spin' : undefined} />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {error !== null && (
        <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {t('aiHub.throughput.loadFailed')}: {error}
        </div>
      )}

      {loading ? (
        <SkeletonLoader className="h-40 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={t('aiHub.throughput.emptyTitle')}
          description={t('aiHub.throughput.emptyHint')}
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('aiHub.throughput.colModel')}</TableHead>
                  <TableHead className="text-right">{t('aiHub.throughput.colRequests')}</TableHead>
                  <TableHead className="text-right">{t('aiHub.throughput.colTokens')}</TableHead>
                  <TableHead className="text-right">{t('aiHub.throughput.colAvgTps')}</TableHead>
                  <TableHead className="text-right">{t('aiHub.throughput.colP50Tps')}</TableHead>
                  <TableHead className="text-right">{t('aiHub.throughput.colMaxTps')}</TableHead>
                  <TableHead className="text-right">{t('aiHub.throughput.colLastUsed')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.model}>
                    <TableCell className="max-w-[280px]">
                      <span className="block truncate font-mono text-xs text-slate-200" title={row.model}>
                        {row.model}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-slate-300">
                      {row.requests}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-slate-400">
                      {formatTokens(row.promptTokens)} / {formatTokens(row.completionTokens)}
                    </TableCell>
                    <TableCell className={cn('text-right text-xs tabular-nums', tpsClass(row.avgTps))}>
                      {row.completionTokens > 0 ? row.avgTps.toFixed(1) : '—'}
                    </TableCell>
                    <TableCell className={cn('text-right text-xs tabular-nums', tpsClass(row.p50Tps))}>
                      {row.completionTokens > 0 ? row.p50Tps.toFixed(1) : '—'}
                    </TableCell>
                    <TableCell className={cn('text-right text-xs tabular-nums', tpsClass(row.maxTps))}>
                      {row.completionTokens > 0 ? row.maxTps.toFixed(1) : '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-xs text-slate-400">
                      {formatRelative(row.lastUsedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            {t('aiHub.throughput.shownOf', { shown: rows.length, total: totalModels })}
          </p>
        </>
      )}
    </section>
  );
}
