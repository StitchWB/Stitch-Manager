import { useRef, useEffect, useState, useCallback } from 'react';
import { ArrowDown, Trash2, Rocket, Copy, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { t } from '../../lib/i18n';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { EmptyState } from './EmptyState';

interface LogEntry {
  id: string;
  level: 'info' | 'success' | 'error' | 'warn' | 'debug';
  message: string;
  timestamp: string;
}

interface TerminalProps {
  logs: LogEntry[];
  onClear?: () => void;
  className?: string;
}

// Deep Space Void - Log entry styling
const levelConfig = {
  info: {
    border: 'border-l-blue-500/30',
    bg: 'bg-blue-500/[0.02]',
    label: 'INF',
    labelColor: 'text-blue-400',
    textColor: 'text-slate-400',
  },
  success: {
    border: 'border-l-emerald-500/50',
    bg: 'bg-emerald-500/[0.05]',
    label: 'OK ',
    labelColor: 'text-emerald-400',
    textColor: 'text-emerald-400',
  },
  error: {
    border: 'border-l-red-500/50',
    bg: 'bg-red-500/[0.05]',
    label: 'ERR',
    labelColor: 'text-red-400',
    textColor: 'text-red-400',
  },
  warn: {
    border: 'border-l-amber-500/50',
    bg: 'bg-amber-500/[0.05]',
    label: 'WRN',
    labelColor: 'text-amber-400',
    textColor: 'text-amber-400',
  },
  debug: {
    border: 'border-l-slate-600/30',
    bg: 'bg-transparent',
    label: 'DBG',
    labelColor: 'text-slate-600',
    textColor: 'text-slate-600',
  },
};

// Format message with clickable URLs and emails
function formatMessage(message: string, level: string): JSX.Element {
  const combinedRegex = /(https?:\/\/[^\s]+)|([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/g;
  
  const parts = message.split(combinedRegex).filter(Boolean);
  
  // Text color based on level
  const textColor = level === 'error' ? 'text-red-400' 
    : level === 'success' ? 'text-emerald-400'
    : level === 'warn' ? 'text-amber-400'
    : level === 'debug' ? 'text-slate-600'
    : 'text-slate-400';
  
  return (
    <span className={textColor}>
      {parts.map((part, i) => {
        if (!part) return null;
        
        if (/(https?:\/\/[^\s]+)/.test(part)) {
          return (
            <a 
              key={i} 
              href={part} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="text-indigo-400/80 underline decoration-indigo-400/30 hover:text-indigo-300 hover:decoration-indigo-300"
            >
              {part}
            </a>
          );
        }
        
        if (/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/.test(part)) {
          return (
            <span key={i} className="text-cyan-400/80">{part}</span>
          );
        }
        
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}

// Deep Space Void - Structured log row component
function LogRow({ log, isLatest, onCopy }: { log: LogEntry; isLatest: boolean; onCopy?: (text: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isDebug = log.level === 'debug';
  const config = levelConfig[log.level];
  
  const formatTime = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleTimeString('en-US', { 
        hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    } catch { return '--:--:--'; }
  };

  // Check if message contains credentials (email + password pattern)
  const hasCredentials = log.level === 'success' && 
    (log.message.includes('@') || log.message.toLowerCase().includes('created') || log.message.toLowerCase().includes('account'));

  if (isDebug) {
    return (
      <div className={cn('border-l-2 pl-3 py-1.5 font-mono', config.border, config.bg)}>
        <button 
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-slate-600 hover:text-slate-400 transition-colors"
          aria-expanded={expanded}
        >
          <ChevronRight className={cn('w-3 h-3 transition-transform', expanded && 'rotate-90')} />
          <span className="text-[10px] font-mono text-slate-600">[{formatTime(log.timestamp)}]</span>
          <span className="text-[10px] text-slate-700">{t('terminal.debugDetails')}</span>
        </button>
        {expanded && (
          <div className="mt-1 pl-4 text-[10px] text-slate-600 break-all">
            {log.message}
          </div>
        )}
      </div>
    );
  }

  return (
    <div 
      className={cn(
        'border-l-2 pl-3 py-2 font-mono group transition-colors',
        config.border,
        config.bg,
        isLatest && 'animate-pulse'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Timestamp */}
        <span className="text-[10px] text-slate-600 tabular-nums shrink-0 mr-1">
          {formatTime(log.timestamp)}
        </span>
        
        {/* Level badge */}
        <span className={cn('text-[10px] font-bold shrink-0 w-7 uppercase', config.labelColor)}>
          {config.label}
        </span>
        
        {/* Message */}
        <span className={cn('text-xs flex-1 break-all font-sans', config.textColor)}>
          {formatMessage(log.message, log.level)}
        </span>

        {/* Copy button (visible on hover for success logs with credentials) */}
        {hasCredentials && onCopy && (
          <button
            onClick={() => onCopy(log.message)}
            className="opacity-0 group-hover:opacity-100 p-1 text-slate-600 hover:text-slate-300 transition-all"
            aria-label={t('common.copyToClipboard')}
          >
            <Copy className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

export function Terminal({ logs, onClear, className }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const { copy } = useCopyToClipboard();

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
    setShowScrollBtn(!isAtBottom && logs.length > 5);
  }, [logs.length]);

  const scrollToBottom = () => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
    setAutoScroll(true);
  };

  return (
    <div className={cn('relative flex flex-col overflow-hidden', className)} style={{ background: 'rgba(0, 0, 0, 0.2)' }}>
      {/* Header - Deep Space style */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.05]" style={{ background: 'rgba(0, 0, 0, 0.3)' }}>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500/50" />
          <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">{t('terminal.liveFeed')}</span>
        </div>
        {onClear && (
          <button
            onClick={onClear}
            className="p-1.5 rounded text-slate-600 hover:text-slate-400 hover:bg-white/[0.05] transition-colors"
            aria-label={t('logs.clearLogs')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Log content - Stick to bottom */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-[200px] scrollbar-thin"
      >
        {logs.length === 0 ? (
          <EmptyState 
            icon={Rocket} 
            title={t('terminal.readyToLaunch')}
            description={t('terminal.logsWillAppear')}
          />
        ) : (
          <div className="py-1">
            {logs.map((log, index) => (
              <LogRow 
                key={log.id} 
                log={log} 
                isLatest={index === logs.length - 1}
                onCopy={copy}
              />
            ))}
          </div>
        )}
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-3 right-3 p-2 rounded-lg text-slate-500 hover:text-slate-300 transition-colors border border-white/10 bg-black/60 backdrop-blur-sm shadow-lg"
          aria-label={t('common.scrollToBottom')}
        >
          <ArrowDown className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
