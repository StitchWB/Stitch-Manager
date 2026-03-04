import { ChevronDown, ChevronRight, CheckCircle, XCircle, Loader2, Info } from 'lucide-react';
import { LogEntry } from '../../stores/logs';
import { cn } from '../../lib/utils';
import { Copy, Check } from 'lucide-react';
import { useState, useCallback } from 'react';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { Tooltip } from '../Tooltip';

// ============================================
// Types
// ============================================

export interface LogGroupProps {
  stage: string;
  accountId?: string;
  entries: LogEntry[];
  status: 'success' | 'error' | 'progress' | 'info';
  isCollapsed: boolean;
  onToggle: () => void;
  duration?: number;
  icon?: string;
  onSelectLog?: (log: LogEntry) => void;
  selectedLogId?: string | null;
}

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
    email: '📧',
    imap: '📬',
    verification: '✅',
    browser: '🌐',
    api: '🔌',
    database: '💾',
    system: '⚙️',
    registration: '📝',
    patcher: '🔧',
    settings: '⚙️',
    server: '🖥️',
    accounts: '👤',
    password: '🔐',
    oauth: '🔑',
    aws: '☁️',
    kiro: '🚀',
  };
  return stageMap[stage.toLowerCase()] || '📋';
};

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

// ============================================
// Component
// ============================================

export function LogGroup({
  stage,
  accountId,
  entries,
  status,
  isCollapsed,
  onToggle,
  duration,
  icon,
  onSelectLog,
  selectedLogId,
}: LogGroupProps) {
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { copy } = useCopyToClipboard();

  const toggleLogExpansion = useCallback((logId: string) => {
    setExpandedLogs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(logId)) {
        newSet.delete(logId);
      } else {
        newSet.add(logId);
      }
      return newSet;
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

  return (
    <div className="border border-white/5 rounded-lg overflow-hidden mb-2 bg-[#0a0a0a]">
      {/* Header */}
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-2 hover:bg-white/[0.02] transition-colors',
          'border-b border-white/5'
        )}
      >
        {/* Collapse Icon */}
        {isCollapsed ? (
          <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
        )}

        {/* Stage Emoji */}
        <span className="text-base shrink-0">{icon || getStageEmoji(stage)}</span>

        {/* Stage Name */}
        <span className="text-sm font-semibold text-slate-300 uppercase tracking-wide shrink-0">
          [{stage}]
        </span>

        {/* Status Icon */}
        <span className="shrink-0">{getStatusIcon(status)}</span>

        {/* Account ID (if provided) */}
        {accountId && <span className="text-xs text-slate-500 shrink-0">{accountId}</span>}

        {/* Entry Count */}
        <span className="text-xs text-slate-500 shrink-0">
          ({entries.length} {entries.length === 1 ? 'entry' : 'entries'})
        </span>

        {/* Duration */}
        {duration !== undefined && (
          <span className="text-xs text-slate-500 tabular-nums shrink-0">
            [{formatDuration(duration)}]
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />
      </button>

      {/* Entries (when expanded) */}
      {!isCollapsed && (
        <div className="font-mono text-xs">
          {entries.map((log, idx) => {
            const isCopied = copiedId === log.id;
            const isLongMessage = log.message.length > 200;
            const isExpanded = expandedLogs.has(log.id);
            const isSelected = selectedLogId === log.id;
            const isActionable = Boolean(onSelectLog) || isLongMessage;

            return (
              <div
                key={`${log.id}-${log.timestamp}-${idx}`}
                className={cn(
                  'flex items-start gap-3 px-4 py-1 hover:bg-white/[0.02] transition-colors border-b border-white/[0.02] group',
                  isSelected && 'bg-white/[0.04] border-white/[0.08]'
                )}
              >
                {/* Timestamp - Gray */}
                <span className="text-slate-600 tabular-nums shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString('en-US', {
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>

                {/* Level - Color coded, 3 chars */}
                <span
                  className={cn(
                    'shrink-0 w-12 text-center font-bold uppercase',
                    log.level === 'debug' && 'text-slate-500',
                    log.level === 'info' && 'text-vsc-blue',
                    log.level === 'success' && 'text-vsc-green',
                    log.level === 'warn' && 'text-vsc-yellow',
                    log.level === 'error' && 'text-vsc-red'
                  )}
                >
                  {log.level === 'debug'
                    ? 'DBG'
                    : log.level === 'info'
                      ? 'INF'
                      : log.level === 'success'
                        ? 'OK'
                        : log.level === 'warn'
                          ? 'WRN'
                          : 'ERR'}
                </span>

                {/* Source - Purple */}
                <span className="text-purple-400 shrink-0 w-24 truncate">
                  [{log.source || 'system'}]
                </span>

                {/* Message - White, expandable */}
                <div className="flex-1 min-w-0">
                  <button
                    type="button"
                    className={cn(
                      'text-slate-300 break-words text-left w-full bg-transparent border-0 p-0',
                      isActionable ? 'cursor-pointer' : 'cursor-default',
                      !isExpanded && isLongMessage && 'line-clamp-1'
                    )}
                    onClick={() => {
                      onSelectLog?.(log);
                      if (isLongMessage) {
                        toggleLogExpansion(log.id);
                      }
                    }}
                    disabled={!isActionable}
                  >
                    {log.message}
                  </button>
                </div>

                {/* Copy button - appears on hover */}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
