import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  History,
  RefreshCw,
  ScrollText,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { TabButton } from '@/components/ui/TabButton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { Toggle } from '@/components/ui/Toggle';
import { IconButton } from '@/components/ui/IconButton';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  devboxLatestFinishedPayload,
  devboxLogs,
  devboxTime,
  type DevboxEventRow,
  type DevboxLogs as DevboxLogsPayload,
  type DevboxRecentAction,
} from '@/lib/backend/modules/devbox';
import { DEVBOX_LOGS_LIMIT } from './constants';
import { devboxEventLine } from './eventLine';

type ConsoleTab = 'events' | 'logs' | 'actions';

const EVENTS_TAIL = 200;

function payloadString(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

export interface DevboxConsoleProps {
  events: DevboxEventRow[];
  recent: DevboxRecentAction[] | null;
  error: string | null;
  onRetry: () => void;
}

export function DevboxConsole({ events, recent, error, onRetry }: DevboxConsoleProps) {
  const [tab, setTab] = useState<ConsoleTab>('events');
  const [search, setSearch] = useState('');
  const [autoscroll, setAutoscroll] = useState(true);
  const [eventsBaseline, setEventsBaseline] = useState(0);
  const [actionsBaseline, setActionsBaseline] = useState(0);
  const searchRef = useRef('');

  const [source, setSource] = useState('');
  const [logsTick, setLogsTick] = useState(0);
  const [logsData, setLogsData] = useState<DevboxLogsPayload | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== 'logs') return;
    let cancelled = false;
    devboxLogs({
      source: source || undefined,
      filter: searchRef.current.trim() || undefined,
      limit: DEVBOX_LOGS_LIMIT,
    })
      .then(result => {
        if (cancelled) return;
        setLogsData(result);
        setLogsError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLogsError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [tab, source, logsTick]);

  const query = search.trim().toLowerCase();

  const visibleEvents = useMemo(() => {
    const start = Math.min(eventsBaseline, events.length);
    const rows = events.slice(start);
    const filtered = query === '' ? rows : rows.filter(row => devboxEventLine(row).toLowerCase().includes(query));
    return filtered.slice(-EVENTS_TAIL);
  }, [events, eventsBaseline, query]);

  const recentRows = useMemo(() => (Array.isArray(recent) ? recent : []), [recent]);
  const visibleActions = useMemo(() => {
    const start = Math.min(actionsBaseline, recentRows.length);
    const rows = recentRows.slice(start);
    return query === '' ? rows : rows.filter(row => `${row.cmd} ${row.status}`.toLowerCase().includes(query));
  }, [recentRows, actionsBaseline, query]);

  const allSources = useMemo(
    () => (Array.isArray(logsData?.sources) ? logsData?.sources ?? [] : []),
    [logsData],
  );
  const sourceOptions = useMemo(
    () => [
      { label: t('devboxPage.logsSourceAll'), value: '' },
      ...allSources.map(s => s.name).filter(Boolean).map(name => ({ label: name, value: name })),
    ],
    [allSources],
  );
  const visibleSources = useMemo(() => {
    const scoped = source ? allSources.filter(s => s.name === source) : allSources;
    return scoped.map(s => ({
      name: s.name,
      lines: query === '' ? s.lines ?? [] : (s.lines ?? []).filter(line => line.toLowerCase().includes(query)),
    }));
  }, [allSources, source, query]);
  const hasLogLines = visibleSources.some(s => s.lines.length > 0);

  const eventsScrollRef = useRef<HTMLDivElement | null>(null);
  const logsScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!autoscroll) return;
    const el = tab === 'events' ? eventsScrollRef.current : tab === 'logs' ? logsScrollRef.current : null;
    if (el) el.scrollTop = el.scrollHeight;
  }, [autoscroll, tab, visibleEvents.length, visibleSources, query]);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const doctorReport = payloadString(devboxLatestFinishedPayload(recentRows, 'run_doctor'), 'report');
  const cockpitUrl = payloadString(devboxLatestFinishedPayload(recentRows, 'cockpit_open'), 'url');

  const refresh = () => {
    if (tab === 'logs') setLogsTick(x => x + 1);
    else onRetry();
  };

  const clear = () => {
    if (tab === 'events') setEventsBaseline(events.length);
    else if (tab === 'actions') setActionsBaseline(recentRows.length);
    else {
      setLogsData(null);
      setLogsError(null);
    }
  };

  const filteredAway = query !== '' || eventsBaseline > 0 || actionsBaseline > 0;

  return (
    <GlassCard className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1" data-testid="devbox-console-tabs">
          <TabButton
            size="sm"
            active={tab === 'events'}
            label={t('devboxPage.consoleTabEvents')}
            data-testid="devbox-console-tab-events"
            onClick={() => setTab('events')}
          />
          <TabButton
            size="sm"
            active={tab === 'logs'}
            label={t('devboxPage.consoleTabLogs')}
            data-testid="devbox-console-tab-logs"
            onClick={() => setTab('logs')}
          />
          <TabButton
            size="sm"
            active={tab === 'actions'}
            label={t('devboxPage.consoleTabActions')}
            data-testid="devbox-console-tab-actions"
            onClick={() => setTab('actions')}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            placeholder={t('devboxPage.consoleSearch')}
            leftIcon={<Search size={14} />}
            containerClassName="w-52"
            data-testid="devbox-console-search"
            onChange={e => {
              searchRef.current = e.target.value;
              setSearch(e.target.value);
            }}
          />
          {tab !== 'actions' && (
            <Toggle
              size="sm"
              label={t('devboxPage.consoleAutoscroll')}
              checked={autoscroll}
              onChange={setAutoscroll}
            />
          )}
          <Button
            size="xs"
            variant="ghost"
            leftIcon={<RefreshCw size={12} />}
            data-testid="devbox-console-refresh"
            onClick={refresh}
          >
            {t('common.refresh')}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            data-testid="devbox-console-clear"
            onClick={clear}
          >
            {t('devboxPage.consoleClear')}
          </Button>
        </div>
      </div>

      {tab !== 'logs' && error && (
        <div className="mb-3 flex items-center gap-2" data-testid="devbox-console-error">
          <p className="min-w-0 truncate text-2xs text-red-300">{error}</p>
          <Button size="xs" variant="secondary" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      {tab === 'events' &&
        (visibleEvents.length === 0 ? (
          filteredAway ? (
            <span className="text-2xs text-slate-500" data-testid="devbox-console-empty">
              {t('devboxPage.consoleEmptyFiltered')}
            </span>
          ) : (
            <EmptyState
              compact
              icon={ScrollText}
              title={t('devboxPage.eventsEmpty')}
              description={t('devboxPage.eventsEmptyDesc')}
            />
          )
        ) : (
          <div
            ref={eventsScrollRef}
            data-testid="devbox-events-river"
            className="max-h-72 overflow-auto rounded-lg border border-white/5 bg-black/40 p-3 font-mono text-2xs leading-5 text-slate-300"
          >
            {visibleEvents.map((row, i) => (
              <div key={i} className="truncate" title={devboxEventLine(row)}>
                {devboxEventLine(row)}
              </div>
            ))}
          </div>
        ))}

      {tab === 'logs' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              size="sm"
              stretch={false}
              options={sourceOptions}
              value={source}
              onChange={setSource}
              className="max-w-full overflow-x-auto"
            />
            <span className="text-2xs text-slate-500">{t('devboxPage.logsCaption')}</span>
          </div>
          {logsError && (
            <div className="flex items-center gap-2" data-testid="devbox-console-logs-error">
              <p className="min-w-0 truncate text-2xs text-red-300">{logsError}</p>
              <IconButton
                size="sm"
                variant="ghost"
                aria-label={t('common.refresh')}
                onClick={() => setLogsTick(x => x + 1)}
              >
                <RefreshCw size={14} />
              </IconButton>
            </div>
          )}
          {!hasLogLines && !logsError ? (
            query !== '' ? (
              <span className="text-2xs text-slate-500" data-testid="devbox-console-empty">
                {t('devboxPage.consoleEmptyFiltered')}
              </span>
            ) : (
              <EmptyState
                compact
                icon={FileText}
                title={t('devboxPage.logsEmpty')}
                description={t('devboxPage.logsEmptyDesc')}
              />
            )
          ) : (
            <div
              ref={logsScrollRef}
              data-testid="devbox-console-logs"
              className="flex max-h-96 flex-col gap-3 overflow-auto"
            >
              {visibleSources.map(s => (
                <div key={s.name} className="flex flex-col gap-1">
                  <span className="text-2xs uppercase tracking-wider text-slate-300">{s.name}</span>
                  <pre
                    data-testid={`devbox-logs-source-${s.name}`}
                    className="max-h-64 overflow-auto rounded-lg border border-white/5 bg-black/40 p-3 font-mono text-2xs leading-5 text-slate-300 whitespace-pre-wrap"
                  >
                    {s.lines.join('\n')}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'actions' && (
        <div className="flex flex-col gap-3">
          {doctorReport && (
            <div className="flex flex-col gap-2">
              <span className="text-2xs uppercase tracking-wider text-slate-400">
                {t('devboxPage.doctorReportLabel')}
              </span>
              <pre
                data-testid="devbox-doctor-report"
                className="max-h-64 overflow-auto rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-2xs text-slate-300 whitespace-pre-wrap"
              >
                {doctorReport}
              </pre>
            </div>
          )}
          {cockpitUrl && (
            <div className="flex items-center gap-2">
              <span className="text-2xs uppercase tracking-wider text-slate-400">
                {t('devboxPage.cockpitUrlLabel')}
              </span>
              <Button
                size="xs"
                variant="ghost"
                data-testid="devbox-cockpit-url"
                rightIcon={<ExternalLink size={12} />}
                onClick={() => window.open(cockpitUrl, '_blank', 'noopener,noreferrer')}
              >
                {cockpitUrl}
              </Button>
            </div>
          )}
          {visibleActions.length === 0 ? (
            query !== '' || actionsBaseline > 0 ? (
              <span className="text-2xs text-slate-500" data-testid="devbox-console-empty">
                {t('devboxPage.consoleEmptyFiltered')}
              </span>
            ) : (
              <EmptyState
                compact
                icon={History}
                title={t('devboxPage.actionsEmpty')}
                description={t('devboxPage.actionsEmptyDesc')}
              />
            )
          ) : (
            <Table containerClassName="rounded-lg border border-white/5">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('devboxPage.colCmd')}</TableHead>
                  <TableHead>{t('devboxPage.colStatus')}</TableHead>
                  <TableHead>{t('devboxPage.colStarted')}</TableHead>
                  <TableHead>{t('devboxPage.colFinished')}</TableHead>
                  <TableHead>{t('devboxPage.colExit')}</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleActions.map(row => {
                  const expanded = expandedId === row.id;
                  const hasPayload = Boolean(row.payload && typeof row.payload === 'object');
                  return (
                    <Fragment key={row.id}>
                      <TableRow>
                        <TableCell className="font-mono text-2xs">{row.cmd}</TableCell>
                        <TableCell
                          className={cn(
                            row.status === 'failed' && 'text-red-300',
                            row.status === 'finished' && 'text-emerald-300',
                          )}
                        >
                          {row.status}
                        </TableCell>
                        <TableCell>{devboxTime(row.startedAt)}</TableCell>
                        <TableCell>{devboxTime(row.finishedAt)}</TableCell>
                        <TableCell>{row.exit ?? '—'}</TableCell>
                        <TableCell>
                          {hasPayload && (
                            <IconButton
                              size="sm"
                              aria-label={expanded ? t('devboxPage.hidePayload') : t('devboxPage.showPayload')}
                              tooltip={expanded ? t('devboxPage.hidePayload') : t('devboxPage.tipPayload')}
                              data-testid={`devbox-action-payload-${row.id}`}
                              onClick={() => setExpandedId(expanded ? null : row.id)}
                            >
                              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </IconButton>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded && hasPayload && (
                        <TableRow>
                          <TableCell colSpan={6}>
                            <pre className="max-h-48 overflow-auto rounded-lg border border-white/5 bg-black/40 p-2 font-mono text-2xs text-slate-300 whitespace-pre-wrap">
                              {JSON.stringify(row.payload, null, 2)}
                            </pre>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </GlassCard>
  );
}
