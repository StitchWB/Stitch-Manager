import { useState, useCallback } from 'react';
import { CheckCircle2, XCircle, AlertCircle, Trash2, Copy, RefreshCw, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { maskKey } from '../../lib/utils/maskKey';
import type { ApiKeyEntry } from '../../types/apiKeys';

interface KeyRowProps {
  entry: ApiKeyEntry;
  provider: string;
  isTesting: boolean;
  onTest: (entry: ApiKeyEntry) => void;
  onDelete: (entry: ApiKeyEntry) => void;
  onCopy: (entry: ApiKeyEntry) => void;
}

const statusConfig = {
  ok: { dot: 'bg-emerald-400', icon: CheckCircle2, label: 'OK', iconColor: 'text-emerald-400' },
  rate_limited: { dot: 'bg-amber-400', icon: AlertCircle, label: 'Rate Limited', iconColor: 'text-amber-400' },
  invalid: { dot: 'bg-red-400', icon: XCircle, label: 'Invalid', iconColor: 'text-red-400' },
  error: { dot: 'bg-red-400', icon: XCircle, label: 'Error', iconColor: 'text-red-400' },
  unknown: { dot: 'bg-slate-400', icon: AlertCircle, label: 'Unknown', iconColor: 'text-slate-400' },
};

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function KeyRow({ entry, provider, isTesting, onTest, onDelete, onCopy }: KeyRowProps) {
  const [expanded, setExpanded] = useState(false);
  const status = statusConfig[entry.status ?? 'unknown'];
  const StatusIcon = status.icon;

  const handleCopy = useCallback(() => {
    onCopy(entry);
  }, [entry, onCopy]);

  const handleTest = useCallback(() => {
    onTest(entry);
  }, [entry, onTest]);

  const handleDelete = useCallback(() => {
    onDelete(entry);
  }, [entry, onDelete]);

  return (
    <div className="border border-white/10 rounded-lg bg-white/[0.02] overflow-hidden transition-colors hover:bg-white/[0.04]">
      {/* Compact row */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-left group"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={`${provider} key ${maskKey(entry.key)}`}
      >
        <span className={cn('w-2 h-2 rounded-full shrink-0', status.dot)} />
        <code className="text-xs text-slate-300 font-mono">{maskKey(entry.key)}</code>
        <span className={cn('text-xs ml-1', status.iconColor)}>{status.label}</span>
        {entry.models && entry.models.length > 0 && (
          <span className="text-xs text-slate-500 ml-1">{entry.models.length} models</span>
        )}
        {entry.lastTested && (
          <span className="text-xs text-slate-500 ml-auto mr-1">{timeAgo(entry.lastTested)}</span>
        )}

        {/* Hover actions */}
        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-sky-400 transition-colors"
            onClick={(e) => { e.stopPropagation(); handleTest(); }}
            disabled={isTesting}
            aria-label="Test key"
            title="Test key"
          >
            {isTesting ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
            onClick={(e) => { e.stopPropagation(); handleCopy(); }}
            aria-label="Copy key"
            title="Copy key"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button
            className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-red-400 transition-colors"
            onClick={(e) => { e.stopPropagation(); handleDelete(); }}
            aria-label="Delete key"
            title="Delete key"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <ChevronDown className={cn(
          'w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform',
          expanded && 'rotate-180'
        )} />
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-white/5 space-y-2">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div>
              <span className="text-slate-500">Status</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <StatusIcon className={cn('w-3.5 h-3.5', status.iconColor)} />
                <span className={status.iconColor}>{status.label}</span>
              </div>
            </div>
            <div>
              <span className="text-slate-500">Provider</span>
              <p className="text-slate-300 mt-0.5">{provider}</p>
            </div>
            <div>
              <span className="text-slate-500">Added</span>
              <p className="text-slate-300 mt-0.5">{new Date(entry.addedAt).toLocaleDateString()}</p>
            </div>
            {entry.lastTested && (
              <div>
                <span className="text-slate-500">Last Tested</span>
                <p className="text-slate-300 mt-0.5">{timeAgo(entry.lastTested)}</p>
              </div>
            )}
            {entry.baseUrl && (
              <div className="col-span-2">
                <span className="text-slate-500">Base URL</span>
                <p className="text-slate-300 mt-0.5 font-mono text-xs break-all">{entry.baseUrl}</p>
              </div>
            )}
            {entry.lastError && (
              <div className="col-span-2">
                <span className="text-slate-500">Last Error</span>
                <p className="text-red-400 mt-0.5 text-xs break-all">{entry.lastError}</p>
              </div>
            )}
            {entry.models && entry.models.length > 0 && (
              <div className="col-span-2">
                <span className="text-slate-500">Models ({entry.models.length})</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {entry.models.slice(0, 20).map((m) => (
                    <span key={m} className="text-xs bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-slate-400 font-mono">
                      {m}
                    </span>
                  ))}
                  {entry.models.length > 20 && (
                    <span className="text-xs text-slate-500">+{entry.models.length - 20} more</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-1">
            <button
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-500/10 border border-sky-500/20 px-2.5 py-1 text-xs text-sky-300 hover:bg-sky-500/20 transition-colors"
              onClick={handleTest}
              disabled={isTesting}
              aria-label="Test Now"
            >
              {isTesting ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              Test Now
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-md bg-white/5 border border-white/10 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 transition-colors"
              onClick={handleCopy}
              aria-label="Copy Key"
            >
              <Copy className="w-3 h-3" />
              Copy Key
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-md bg-red-500/10 border border-red-500/20 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/20 transition-colors"
              onClick={handleDelete}
              aria-label="Delete"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}