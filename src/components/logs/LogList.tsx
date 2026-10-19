import { Check, Copy } from 'lucide-react';
import { t } from '../../lib/i18n';
import { cn, formatTime } from '../../lib/utils';
import type { LogEntry } from '../../stores/logs';
import { ButtonBase } from '@/components/ui';

interface LogListProps {
  rows: LogEntry[];
  copiedId: string | null;
  selectedLogId: string | null;
  onSelectLog: (logId: string) => void;
  onCopyMessage: (text: string, logId: string) => void;
}

function stripTag(message: string): string {
  return message.replace(/^\s*\[[^\]]+\]\s*/, '');
}

export function LogList({ rows, copiedId, selectedLogId, onSelectLog, onCopyMessage }: LogListProps) {
  // Dedup consecutive identical messages
  const deduped: { log: LogEntry; count: number; displayMessage: string }[] = [];
  for (const log of rows) {
    const msg = stripTag(log.message);
    const last = deduped[deduped.length - 1];
    if (last && last.displayMessage === msg && last.log.level === log.level) {
      last.count += 1;
    } else {
      deduped.push({ log, count: 1, displayMessage: msg });
    }
  }

  return (
    <div className="font-mono text-xs">
      {deduped.map((item, idx) => {
        const { log, count, displayMessage } = item;
        const isCopied = copiedId === log.id;
        const isSelected = selectedLogId === log.id;
        const dedupKey = `${log.id}-${idx}`;

        return (
          <div
            key={dedupKey}
            className={cn(
              'border-l-4 pl-2 pr-3 py-1.5 border-b border-white/[0.03] transition-colors',
              log.level === 'debug' && 'border-l-slate-600',
              log.level === 'info' && 'border-l-sky-400',
              log.level === 'success' && 'border-l-emerald-400',
              log.level === 'warn' && 'border-l-amber-400 bg-amber-500/5',
              log.level === 'error' && 'border-l-red-400 bg-red-500/5',
              isSelected && 'bg-white/[0.04]'
            )}
          >
            <div className="flex items-start gap-2">
              <ButtonBase
                className="flex-1 min-w-0 flex items-start gap-2 text-left"
                onClick={() => onSelectLog(log.id)}
              >
                <span className="text-slate-600 tabular-nums shrink-0 w-20 text-right">
                  {formatTime(log.timestamp, {
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>

                <span className="text-purple-400 shrink-0 w-28 truncate text-right">
                  {log.source || 'system'}
                </span>

                <span className="flex-1 min-w-0 text-slate-300 break-words line-clamp-2">
                  {displayMessage || t('logs.emptyMessage')}
                </span>
              </ButtonBase>

              {count > 1 && (
                <span className="text-xs text-slate-500 bg-white/5 px-1.5 py-0.5 rounded shrink-0">
                  ×{count}
                </span>
              )}

              <ButtonBase
                onClick={() => {
                  void onCopyMessage(log.message, log.id);
                }}
                className="text-slate-500 hover:text-slate-200 transition-colors p-1 rounded hover:bg-white/5 shrink-0"
              >
                {isCopied ? (
                  <Check className="w-3 h-3 text-vsc-green" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </ButtonBase>
            </div>
          </div>
        );
      })}
    </div>
  );
}
