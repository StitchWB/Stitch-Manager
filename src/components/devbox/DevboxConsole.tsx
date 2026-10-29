import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
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
import { cn, formatTime } from '@/lib/utils';
import {
  devboxLatestFinishedPayload,
  devboxLogs,
  devboxTime,
  type DevboxEventRow,
  type DevboxLogs as DevboxLogsPayload,
  type DevboxRecentAction,
} from '@/lib/backend/modules/devbox';
import { DEVBOX_LOGS_LIMIT } from './constants';
import { devboxEventTone, type DevboxEventTone } from './eventLine';

type ConsoleTab = 'events' | 'logs' | 'actions';
type ConsoleFilter = 'all' | 'errors';

const EVENTS_TAIL = 200;
const ERROR_LINE_RE = /error|fail|exception|traceback|warn/i;
const ERROR_EVENT_STATUSES = new Set(['failed', 'error']);

function isErrorEvent(row: DevboxEventRow): boolean {
  return ERROR_EVENT_STATUSES.has(String(row.status ?? '').toLowerCase());
}

function isErrorAction(row: DevboxRecentAction): boolean {
  return row.exit !== null && row.exit !== undefined && row.exit !== 0;
}

function payloadString(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

const TIME_OPTS: Intl.DateTimeFormatOptions = {
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
};

function logTime(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number' && Number.isFinite(value)) return formatTime(value * 1000, TIME_OPTS);
  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (value.trim() !== '' && Number.isFinite(asNumber)) return formatTime(asNumber * 1000, TIME_OPTS);
    return formatTime(value, TIME_OPTS);
  }
  return '—';
}

const HOST_TS_RE = /^\[([^\]]+)\]\s*/;
const ISO_TS_RE = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s*/;

function splitTimestamp(line: string): { ts: string | null; message: string } {
  const host = HOST_TS_RE.exec(line);
  if (host) return { ts: host[1], message: line.slice(host[0].length) };
  const iso = ISO_TS_RE.exec(line);
  if (iso) return { ts: iso[1], message: line.slice(iso[0].length) };
  return { ts: null, message: line };
}

function shortenArg(arg: unknown): string {
  const value = typeof arg === 'string' ? arg : String(arg);
  if (!value.includes('/') && !value.includes('\\')) return value;
  const segments = value.split(/[\\/]/).filter(Boolean);
  return segments.slice(-2).join('/');
}

function humanizeRunnerJson(line: string): { text: string; title?: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const inner = record.event;
  if (typeof inner !== 'object' || inner === null) return null;
  const event = inner as Record<string, unknown>;
  const parts: string[] = [logTime(record.ts)];
  if (typeof event.tool === 'string' && event.tool !== '') parts.push(event.tool);
  if (typeof event.exit === 'number') parts.push(`exit=${event.exit}`);
  if (Array.isArray(event.argv) && event.argv.length > 0) parts.push(event.argv.map(shortenArg).join(' '));
  const hash = typeof record.hash === 'string' ? record.hash : '';
  return {
    text: parts.filter(part => part !== '' && part !== '—').join(' · '),
    title: hash !== '' ? `hash ${hash.slice(0, 12)}` : undefined,
  };
}

interface ParsedLine {
  raw: string;
  display: string;
  message: string;
  ts: string | null;
  title?: string;
  collapseKey: string;
}

function parseLogLine(raw: string): ParsedLine {
  const json = humanizeRunnerJson(raw);
  if (json) {
    return { raw, display: json.text, message: json.text, ts: null, title: json.title, collapseKey: raw };
  }
  const { ts, message } = splitTimestamp(raw);
  return { raw, display: raw, message, ts, collapseKey: message };
}

interface LogGroup {
  key: string;
  first: ParsedLine;
  entries: ParsedLine[];
  count: number;
  firstTs: string | null;
  lastTs: string | null;
  collapseKey: string;
}

function groupConsecutive(source: string, entries: ParsedLine[]): LogGroup[] {
  const groups: LogGroup[] = [];
  entries.forEach((entry, index) => {
    const prev = groups[groups.length - 1];
    if (prev && prev.collapseKey === entry.collapseKey) {
      prev.count += 1;
      prev.entries.push(entry);
      if (entry.ts !== null) prev.lastTs = entry.ts;
      if (prev.firstTs === null && entry.ts !== null) prev.firstTs = entry.ts;
      return;
    }
    groups.push({
      key: `${source}::${index}`,
      first: entry,
      entries: [entry],
      count: 1,
      firstTs: entry.ts,
      lastTs: entry.ts,
      collapseKey: entry.collapseKey,
    });
  });
  return groups;
}

function groupTimeRange(group: LogGroup): string {
  if (group.firstTs === null) return '—';
  const start = logTime(group.firstTs);
  if (group.lastTs === null || group.lastTs === group.firstTs) return start;
  return `${start} → ${logTime(group.lastTs)}`;
}

const EVENT_DETAIL_KEYS = ['method', 'tool', 'name', 'detail', 'status'] as const;

function eventDetail(row: DevboxEventRow): string {
  const parts: string[] = [];
  for (const key of EVENT_DETAIL_KEYS) {
    const value = row[key];
    if (typeof value === 'string' && value !== '' && value !== '—') parts.push(value);
  }
  return parts.join(' · ');
}

interface EventRowParts {
  time: string;
  kind: string;
  detail: string;
  tone: DevboxEventTone;
}

function eventRowParts(row: DevboxEventRow): EventRowParts {
  return {
    time: logTime(row.ts),
    kind: typeof row.kind === 'string' && row.kind !== '' ? row.kind : 'event',
    detail: eventDetail(row),
    tone: devboxEventTone(row),
  };
}

function eventPlainText(row: DevboxEventRow): string {
  const parts = eventRowParts(row);
  return parts.detail === ''
    ? `[${parts.time}] · ${parts.kind}`
    : `[${parts.time}] · ${parts.kind} · ${parts.detail}`;
}

const EVENT_TONE_TEXT: Record<DevboxEventTone, string> = {
  failed: 'text-red-300',
  ok: 'text-emerald-300',
  running: 'text-amber-300',
  other: 'text-slate-300',
};

const EVENT_TONE_DOT: Record<DevboxEventTone, string> = {
  failed: 'bg-red-300/40',
  ok: 'bg-emerald-300/60',
  running: 'bg-amber-300/60',
  other: 'bg-slate-400/60',
};

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

export interface DevboxConsoleProps {
  events: DevboxEventRow[];
  recent: DevboxRecentAction[] | null;
  error: string | null;
  onRetry: () => void;
  className?: string;
}

export function DevboxConsole({ events, recent, error, onRetry, className }: DevboxConsoleProps) {
  const [tab, setTab] = useState<ConsoleTab>('events');
  const [search, setSearch] = useState('');
  const [errorFilter, setErrorFilter] = useState<ConsoleFilter>('all');
  const [autoscroll, setAutoscroll] = useState(true);
  const [eventsBaseline, setEventsBaseline] = useState(0);
  const [actionsBaseline, setActionsBaseline] = useState(0);
  const searchRef = useRef('');

  const [source, setSource] = useState('');
  const [logsTick, setLogsTick] = useState(0);
  const [logsData, setLogsData] = useState<DevboxLogsPayload | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const [copiedSource, setCopiedSource] = useState<string | null>(null);
  const sourceTimer = useRef<number | null>(null);

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

  useEffect(() => {
    if (tab !== 'logs') return;
    const timer = window.setInterval(() => setLogsTick(x => x + 1), 5000);
    return () => window.clearInterval(timer);
  }, [tab]);

  const query = search.trim().toLowerCase();
  const errorsOnly = errorFilter === 'errors';

  const visibleEvents = useMemo(() => {
    const start = Math.min(eventsBaseline, events.length);
    let rows = events.slice(start);
    if (query !== '') rows = rows.filter(row => eventPlainText(row).toLowerCase().includes(query));
    if (errorsOnly) rows = rows.filter(isErrorEvent);
    return rows.slice(-EVENTS_TAIL);
  }, [events, eventsBaseline, query, errorsOnly]);

  const recentRows = useMemo(() => (Array.isArray(recent) ? recent : []), [recent]);
  const visibleActions = useMemo(() => {
    const start = Math.min(actionsBaseline, recentRows.length);
    let rows = recentRows.slice(start);
    if (query !== '') rows = rows.filter(row => `${row.cmd} ${row.status}`.toLowerCase().includes(query));
    if (errorsOnly) rows = rows.filter(isErrorAction);
    return rows;
  }, [recentRows, actionsBaseline, query, errorsOnly]);

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
    return scoped.map(s => {
      let lines = s.lines ?? [];
      if (query !== '') lines = lines.filter(line => line.toLowerCase().includes(query));
      if (errorsOnly) lines = lines.filter(line => ERROR_LINE_RE.test(line));
      return { name: s.name, lines };
    });
  }, [allSources, source, query, errorsOnly]);
  const hasLogLines = visibleSources.some(s => s.lines.length > 0);

  const logBlocks = useMemo(
    () =>
      visibleSources.map(s => ({
        name: s.name,
        lines: s.lines,
        groups: groupConsecutive(s.name, s.lines.map(parseLogLine)),
      })),
    [visibleSources],
  );

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

  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  const copyText = useMemo(() => {
    if (tab === 'events') return visibleEvents.map(row => eventPlainText(row)).join('\n');
    if (tab === 'logs')
      return visibleSources
        .filter(s => s.lines.length > 0)
        .map(s => [s.name, ...s.lines].join('\n'))
        .join('\n');
    return visibleActions
      .map(row =>
        [row.cmd, row.status, devboxTime(row.startedAt), devboxTime(row.finishedAt), row.exit ?? ''].join('\t'),
      )
      .join('\n');
  }, [tab, visibleEvents, visibleSources, visibleActions]);

  const copyCurrent = async () => {
    if (copyText === '') return;
    await copyToClipboard(copyText);
    setCopied(true);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  const copySource = async (name: string, lines: string[]) => {
    if (lines.length === 0) return;
    await copyToClipboard(lines.join('\n'));
    setCopiedSource(name);
    if (sourceTimer.current !== null) window.clearTimeout(sourceTimer.current);
    sourceTimer.current = window.setTimeout(() => setCopiedSource(null), 1500);
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const filteredAway = query !== '' || errorsOnly || eventsBaseline > 0 || actionsBaseline > 0;

  return (
    <GlassCard className={cn('flex min-h-0 flex-col p-4', className)}>
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
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
          <SegmentedControl
            size="sm"
            stretch={false}
            options={[
              { label: t('devboxPage.consoleFilterAll'), value: 'all' },
              { label: t('devboxPage.consoleFilterErrors'), value: 'errors' },
            ]}
            value={errorFilter}
            onChange={value => setErrorFilter(value === 'errors' ? 'errors' : 'all')}
          />
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
            leftIcon={copied ? <Check size={12} /> : <Copy size={12} />}
            data-testid="devbox-console-copy"
            disabled={copyText === ''}
            onClick={() => void copyCurrent()}
          >
            {copied ? t('devboxPage.consoleCopied') : t('devboxPage.consoleCopy')}
          </Button>
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
        <div className="mb-3 flex shrink-0 items-center gap-2" data-testid="devbox-console-error">
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
            className="min-h-0 flex-1 overflow-auto rounded-lg border border-white/5 bg-black/40 p-2 font-mono text-2xs leading-5 text-slate-300"
          >
            {visibleEvents.map((row, i) => {
              const parts = eventRowParts(row);
              return (
                <div
                  key={i}
                  className="whitespace-pre-wrap break-all rounded-sm px-1 hover:bg-white/[0.04]"
                >
                  <span
                    className={cn(
                      'mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle',
                      EVENT_TONE_DOT[parts.tone],
                    )}
                  />
                  <span className="text-slate-500">[{parts.time}]</span>
                  <span className="text-slate-600"> · </span>
                  <span className="text-slate-400">{parts.kind}</span>
                  {parts.detail !== '' && (
                    <>
                      <span className="text-slate-600"> · </span>
                      <span className={EVENT_TONE_TEXT[parts.tone]}>{parts.detail}</span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}

      {tab === 'logs' && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex shrink-0 flex-wrap items-center gap-2">
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
            query !== '' || errorsOnly ? (
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
              className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto"
            >
              {logBlocks.map(block => (
                <div key={block.name} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 px-1">
                    <span className="text-2xs uppercase tracking-wider text-slate-400">{block.name}</span>
                    <IconButton
                      size="sm"
                      variant="ghost"
                      aria-label={t('devboxPage.consoleCopy')}
                      tooltip={t('devboxPage.consoleCopy')}
                      disabled={block.lines.length === 0}
                      onClick={() => void copySource(block.name, block.lines)}
                    >
                      {copiedSource === block.name ? <Check size={12} /> : <Copy size={12} />}
                    </IconButton>
                  </div>
                  <div
                    data-testid={`devbox-logs-source-${block.name}`}
                    className="max-h-64 overflow-auto rounded-lg border border-white/5 bg-black/40 p-2 font-mono text-2xs leading-5 text-slate-300"
                  >
                    {block.groups.map(group =>
                      group.count === 1 ? (
                        <div
                          key={group.key}
                          title={group.first.title}
                          className="whitespace-pre-wrap break-all rounded-sm px-1 hover:bg-white/[0.04]"
                        >
                          {group.first.display}
                        </div>
                      ) : (
                        <div key={group.key}>
                          <div className="whitespace-pre-wrap break-all rounded-sm px-1 hover:bg-white/[0.04]">
                            <span className="text-slate-500">[{groupTimeRange(group)}]</span>
                            <span className="text-slate-600"> · </span>
                            <span className="text-slate-300">{group.first.message}</span>
                            <button
                              type="button"
                              onClick={() => toggleGroup(group.key)}
                              className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-white/5 px-1 align-middle text-2xs text-slate-400 hover:bg-white/10 hover:text-slate-200"
                            >
                              <ChevronRight
                                size={10}
                                className={cn(
                                  'transition-transform',
                                  expandedGroups.has(group.key) && 'rotate-90',
                                )}
                              />
                              ×{group.count}
                            </button>
                          </div>
                          {expandedGroups.has(group.key) &&
                            group.entries.map((entry, idx) => (
                              <div
                                key={idx}
                                title={entry.title}
                                className="whitespace-pre-wrap break-all rounded-sm py-0.5 pl-5 pr-1 text-slate-400 hover:bg-white/[0.04]"
                              >
                                {entry.display}
                              </div>
                            ))}
                        </div>
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'actions' && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {doctorReport && (
            <div className="flex shrink-0 flex-col gap-2">
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
            <div className="flex shrink-0 items-center gap-2">
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
            query !== '' || errorsOnly || actionsBaseline > 0 ? (
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
            <div className="min-h-0 flex-1 overflow-auto">
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
                        <TableCell
                          className={cn(
                            row.exit !== null && row.exit !== undefined && row.exit !== 0 && 'font-semibold text-red-300',
                          )}
                        >
                          {row.exit ?? '—'}
                        </TableCell>
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
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}
