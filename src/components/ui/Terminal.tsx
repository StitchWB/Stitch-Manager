import { useRef, useEffect, useState, useCallback } from 'react';
import { ArrowDown, Trash2, Terminal as TerminalIcon, Copy, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

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

// Border colors for left accent (Warp style)
const levelBorders = {
  info: 'border-l-slate-600',
  success: 'border-l-emerald-500',
  error: 'border-l-red-500',
  warn: 'border-l-amber-500',
  debug: 'border-l-slate-700',
};

const levelLabels = {
  info: 'INF',
  success: 'OK ',
  error: 'ERR',
  warn: 'WRN',
  debug: 'DBG',
};

const levelLabelColors = {
  info: 'text-slate-500',
  success: 'text-emerald-500',
  error: 'text-red-500',
  warn: 'text-amber-500',
  debug: 'text-slate-600',
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

// Structured log row component (Warp style)
function LogRow({ log, isLatest, onCopy }: { log: LogEntry; isLatest: boolean; onCopy?: (text: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isDebug = log.level === 'debug';
  
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
      <div className={cn('border-l-2 pl-3 py-1 font-mono', levelBorders.debug)}>
        <button 
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-slate-600 hover:text-slate-400 transition-colors"
          aria-expanded={expanded}
        >
          <ChevronRight className={cn('w-3 h-3 transition-transform', expanded && 'rotate-90')} />
          <span className="text-[11px]">[{formatTime(log.timestamp)}]</span>
          <span className="text-[11px] text-slate-700">Debug details</span>
        </button>
        {expanded && (
          <div className="mt-1 pl-4 text-[11px] text-slate-600 break-all">
            {log.message}
          </div>
        )}
      </div>
    );
  }

  return (
    <div 
      className={cn(
        'border-l-2 pl-3 py-1 font-mono group',
        levelBorders[log.level],
        isLatest && 'animate-pulse'
      )}
    >
      <div className="flex items-start gap-2">
        {/* Timestamp */}
        <span className="text-[11px] text-slate-600 tabular-nums shrink-0">
          [{formatTime(log.timestamp)}]
        </span>
        
        {/* Level badge */}
        <span className={cn('text-[11px] font-semibold shrink-0 w-8', levelLabelColors[log.level])}>
          {levelLabels[log.level]}
        </span>
        
        {/* Message */}
        <span className="text-[11px] flex-1 break-all">
          {formatMessage(log.message, log.level)}
        </span>

        {/* Copy button (visible on hover for success logs with credentials) */}
        {hasCredentials && onCopy && (
          <button
            onClick={() => onCopy(log.message)}
            className="opacity-0 group-hover:opacity-100 p-1 text-slate-600 hover:text-slate-300 transition-all"
            aria-label="Copy to clipboard"
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

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  };

  return (
    <div className={cn('relative flex flex-col overflow-hidden bg-transparent', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5" style={{ background: 'rgba(0, 0, 0, 0.3)' }}>
        <span className="text-[11px] text-slate-500 font-mono uppercase tracking-wider">Live Logs</span>
        {onClear && (
          <button
            onClick={onClear}
            className="p-1 rounded text-slate-600 hover:text-slate-400 transition-colors"
            aria-label="Clear logs"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Log content - Flat list, no gaps */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-[200px] bg-transparent"
      >
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-700">
            <TerminalIcon className="w-10 h-10 mb-2 opacity-20" />
            <p className="text-xs font-mono">Ready to start</p>
            <p className="text-[10px] text-slate-800 mt-0.5 font-mono">Logs will appear here</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.02]">
            {logs.map((log, index) => (
              <LogRow 
                key={log.id} 
                log={log} 
                isLatest={index === logs.length - 1}
                onCopy={copyToClipboard}
              />
            ))}
          </div>
        )}
      </div>

      {/* Scroll to bottom */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-2 right-2 p-1.5 rounded text-slate-500 hover:text-slate-300 transition-colors border border-white/10 bg-black/60"
          aria-label="Scroll to bottom"
        >
          <ArrowDown className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
