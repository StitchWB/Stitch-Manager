import { ChevronDown, ChevronRight, CheckCircle, XCircle, Loader2, Info } from 'lucide-react';
import { LogEntry, LogLevel } from '../../stores/logs';
import { cn } from '../../lib/utils';
import { Copy, Check } from 'lucide-react';
import { useState, useCallback, useMemo } from 'react';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { Tooltip } from '../Tooltip';
import { t } from '../../lib/i18n';

// ============================================
// Types
// ============================================

export interface LogGroupProps {
  name: string;
  source: string;
  entries: LogEntry[];
  status: 'success' | 'error' | 'progress' | 'info';
  isCollapsed: boolean;
  onToggle: () => void;
  duration?: number;
  lastActivity: number;
  levelCounts?: Record<LogLevel | string, number>;
  onSelectLog?: (log: LogEntry) => void;
  selectedLogId?: string | null;
}

// ============================================
// Constants
// ============================================

const LEVEL_DOT_MAP: Record<string, string> = {
  debug: 'bg-slate-500',
  info: 'bg-sky-400',
  success: 'bg-emerald-400',
  warn: 'bg-amber-400',
  error: 'bg-red-400',
};

const LEVEL_BORDER_MAP: Record<string, string> = {
  debug: 'border-l-slate-600',
  info: 'border-l-sky-400',
  success: 'border-l-emerald-400',
  warn: 'border-l-amber-400',
  error: 'border-l-red-400',
};

const LEVEL_TINT_MAP: Record<string, string> = {
  warn: 'bg-amber-500/5',
  error: 'bg-red-500/5',
};

const LEVEL_LABEL_MAP: Record<string, string> = {
  debug: 'DBG',
  info: 'INF',
  success: 'OK',
  warn: 'WRN',
  error: 'ERR',
};

const LEVEL_BADGE_COLOR_MAP: Record<string, string> = {
  debug: 'text-slate-500',
  info: 'text-sky-400',
  success: 'text-emerald-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
};

// ============================================
// Helper Functions
// ============================================

const getStatusIcon = (status: LogGroupProps['status']) => {
  switch (status) {
    case 'success':
      return <CheckCircle className="w-4 h-4 text-vsc-green" />;
    case 'error':
      return <XCircle className="w-4 h-4 text-vsc-red" />;
    case 'progress':
      return <Loader2 className="w-4 h-4 text-vsc-blue animate-spin" />;
    case 'info':
      return <Info className="w-4 h-4 text-vsc-blue" />;
  }
};

const getStageEmoji = (stage: string): string => {
  const stageMap: Record<string, string> = {
    email: '\u{1F4E7}',
    imap: '\u{1F4EC}',
    verification: '\u2705',
    browser: '\u{1F310}',
    api: '\u{1F50C}',
    database: '\u{1F4BE}',
    system: '\u2699\uFE0F',
    registration: '\u{1F4DD}',
    patcher: '\u{1F527}',
    settings: '\u2699\uFE0F',
    server: '\u{1F5A5}\uFE0F',
    accounts: '\u{1F464}',
    password: '\u{1F510}',
    oauth: '\u{1F511}',
    aws: '\u2601\uFE0F',
    kiro: '\u{1F680}',
  };
  return stageMap[stage.toLowerCase()] || '\u{1F4CB}';
};

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const stripTag = (message: string): string => {
  return message.replace(/^\s*\[[^\]]+\]\s*/, '');
};

// ============================================
// Dedup helper
// ============================================

interface DedupedEntry {
  log: LogEntry;
  count: number;
  displayMessage: string;
}

function dedupEntries(entries: LogEntry[]): DedupedEntry[] {
  const result: DedupedEntry[] = [];
  for (const log of entries) {
    const msg = stripTag(log.message);
    const last = result[result.length - 1];
    if (last && last.displayMessage === msg && last.log.level === log.level) {
      last.count += 1;
    } else {
      result.push({ log, count: 1, displayMessage: msg });
    }
  }
  return result;
}

// ============================================
// Component
// ============================================

export function LogGroup({
  name,
  source,
  entries,
  status,
  isCollapsed,
  onToggle,
  duration,
  lastActivity,
  levelCounts,
  onSelectLog,
  selectedLogId,
}: LogGroupProps) {
  const [expandedDedup, setExpandedDedup] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { copy } = useCopyToClipboard();

  const deduped = useMemo(() => dedupEntries(entries), [entries]);

  const toggleDedup = useCallback((logId: string) => {
    setExpandedDedup(prev => {
      const next = new Set(prev);
      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }
      return next;
    });
  }, []);

  const copyToClipboard = useCallback(
    async (text: string, logId: string) => {
      await copy(text);
      setCopiedId(logId);
      setTimeout(() => setCopiedId(null), 2000);
    },
    [copy]
  );

  const timeStr = new Date(lastActivity).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const statusIcon = getStatusIcon(status);
  const emoji = getStageEmoji(source);
  const displayName = name === source ? name : `${source} · ${name}`;

  const levelOrder: LogLevel[] = ['info', 'success', 'warn', 'error', 'debug'];
  const countBadges = levelOrder
    .filter(level => (levelCounts?.[level] ?? 0) > 0)
    .map(level => (
      <span key={level} className={cn('inline-flex items-center gap-1 text-xs', LEVEL_BADGE_COLOR_MAP[level] || 'text-slate-400')}>
        <span className={cn('w-2 h-2 rounded-full shrink-0', LEVEL_DOT_MAP[level])} />
        {levelCounts?.[level]} {LEVEL_LABEL_MAP[level]}
      </span>
    ));

  return (
    <div className="border border-white/5 rounded-lg overflow-hidden mb-2 bg-[#0a0a0a]">
      {/* Header */}
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.02] transition-colors',
          'border-b border-white/5'
        )}
      >
        {isCollapsed ? (
          <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
        )}

        <span className="text-base shrink-0">{emoji}</span>

        <span className="text-sm font-semibold text-slate-200 truncate">
          {displayName}
        </span>

        {statusIcon}

        <span className="text-xs text-slate-500 shrink-0">
          ({entries.length})
        </span>

        <span className="text-xs text-slate-500 tabular-nums shrink-0">{timeStr}</span>

        {duration !== undefined && duration > 0 && (
          <span className="text-xs text-slate-500 tabular-nums shrink-0">{formatDuration(duration)}</span>
        )}

        {countBadges.length > 0 && (
          <span className="flex items-center gap-1.5 shrink-0">{countBadges}</span>
        )}

        <div className="flex-1" />
      </button>

      {/* Entries (when expanded) */}
      {!isCollapsed && (
        <div className="font-mono text-xs">
          {deduped.map((item, idx) => {
            const { log, count, displayMessage } = item;
            const isCopied = copiedId === log.id;
            const isSelected = selectedLogId === log.id;
            const isDedupExpanded = expandedDedup.has(log.id);
            const dedupKey = `${log.id}-${idx}`;

            return (
              <div key={dedupKey}>
                <div
                  className={cn(
                    'flex items-start gap-2 pl-2 pr-3 py-1 hover:bg-white/[0.02] transition-colors border-b border-white/[0.02] group',
                    'border-l-4',
                    LEVEL_BORDER_MAP[log.level] || 'border-l-slate-600',
                    LEVEL_TINT_MAP[log.level],
                    isSelected && 'bg-white/[0.04] border-white/[0.08]'
                  )}
                >
                  <span className="text-slate-600 tabular-nums shrink-0 w-20 text-right">
                    {new Date(log.timestamp).toLocaleTimeString('en-US', {
                      hour12: false,
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>

                  <button
                    type="button"
                    className={cn(
                      'flex-1 min-w-0 text-slate-300 break-words text-left bg-transparent border-0 p-0 cursor-pointer',
                      'line-clamp-1'
                    )}
                    onClick={() => onSelectLog?.(log)}
                  >
                    {displayMessage || t('logs.emptyMessage')}
                  </button>

                  {count > 1 && (
                    <button
                      type="button"
                      className="text-xs text-slate-500 hover:text-slate-300 bg-white/5 hover:bg-white/10 px-1.5 py-0.5 rounded shrink-0 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleDedup(log.id);
                      }}
                    >
                      {t('uiTexts.times', { count })}
                    </button>
                  )}

                  <Tooltip content="Copy message">
                    <button
                      type="button"
                      onClick={() => copyToClipboard(log.message, log.id)}
                      className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-slate-300 transition-all p-1 rounded hover:bg-white/5 shrink-0"
                    >
                      {isCopied ? (
                        <Check className="w-3 h-3 text-vsc-green" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </Tooltip>
                </div>

                {/* Expanded dedup entries */}
                {isDedupExpanded && count > 1 && entries.filter(e => stripTag(e.message) === displayMessage && e.level === log.level).map((dupLog, dupIdx) => (
                  <div
                    key={`${dupLog.id}-${dupIdx}`}
                    className={cn(
                      'flex items-start gap-2 pl-2 pr-3 py-1 transition-colors border-b border-white/[0.02]',
                      'border-l-4 border-l-transparent',
                      LEVEL_TINT_MAP[dupLog.level],
                      'opacity-60'
                    )}
                  >
                    <span className="text-slate-600 tabular-nums shrink-0 w-20 text-right">
                      {new Date(dupLog.timestamp).toLocaleTimeString('en-US', {
                        hour12: false,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                    <span className="flex-1 min-w-0 text-slate-400 break-words line-clamp-1">
                      {stripTag(dupLog.message) || t('logs.emptyMessage')}
                    </span>
                    <span className="w-6 shrink-0" />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
