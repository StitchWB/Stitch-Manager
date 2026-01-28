import { useRef, useEffect, useState, useCallback } from 'react';
import {
  ArrowDown,
  Trash2,
  ChevronRight,
  Mail,
  Globe,
  Key,
  AlertTriangle,
  Info,
  CheckCircle,
  Shield,
  Server,
  User,
  FileText,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { t } from '../../lib/i18n';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';

interface LogEntry {
  id: string;
  level: 'info' | 'success' | 'error' | 'warn' | 'debug';
  message: string;
  timestamp: string;
}

interface CompactLogFeedProps {
  logs: LogEntry[];
  onClear?: () => void;
  className?: string;
}

// Get icon based on log content
function getLogIcon(message: string, level: string): { icon: React.ReactNode; color: string } {
  const msg = message.toLowerCase();

  // Error states
  if (level === 'error') {
    return { icon: <AlertTriangle className="w-3 h-3" />, color: 'text-red-400' };
  }

  // Success states
  if (level === 'success') {
    return { icon: <CheckCircle className="w-3 h-3" />, color: 'text-emerald-400' };
  }

  // IMAP / Email related
  if (
    msg.includes('imap') ||
    msg.includes('inbox') ||
    msg.includes('mail') ||
    msg.includes('gmail')
  ) {
    return { icon: <Mail className="w-3 h-3" />, color: 'text-cyan-400' };
  }

  // Browser related
  if (
    msg.includes('browser') ||
    msg.includes('chromium') ||
    msg.includes('page') ||
    msg.includes('window') ||
    msg.includes('navigat') ||
    msg.includes('headless')
  ) {
    return { icon: <Globe className="w-3 h-3" />, color: 'text-violet-400' };
  }

  // Auth / Token related
  if (
    msg.includes('token') ||
    msg.includes('oauth') ||
    msg.includes('auth') ||
    msg.includes('password') ||
    msg.includes('credential')
  ) {
    return { icon: <Key className="w-3 h-3" />, color: 'text-amber-400' };
  }

  // Verification
  if (msg.includes('verif') || msg.includes('code') || msg.includes('allow access')) {
    return { icon: <Shield className="w-3 h-3" />, color: 'text-yellow-400' };
  }

  // Server / Connection
  if (msg.includes('connect') || msg.includes('server') || msg.includes('callback')) {
    return { icon: <Server className="w-3 h-3" />, color: 'text-blue-400' };
  }

  // Profile / User
  if (msg.includes('profile') || msg.includes('user') || msg.includes('account')) {
    return { icon: <User className="w-3 h-3" />, color: 'text-pink-400' };
  }

  // Registration / Starting
  if (msg.includes('registr') || msg.includes('starting') || msg.includes('init')) {
    return { icon: <FileText className="w-3 h-3" />, color: 'text-indigo-400' };
  }

  // Warning
  if (level === 'warn') {
    return { icon: <AlertTriangle className="w-3 h-3" />, color: 'text-amber-400' };
  }

  // Default
  return { icon: <Info className="w-3 h-3" />, color: 'text-slate-500' };
}

// Highlight important parts of the message
function formatLogMessage(message: string): React.ReactNode {
  // Patterns to highlight
  const patterns = [
    // URLs
    { regex: /(https?:\/\/[^\s]+)/g, className: 'text-indigo-400 font-mono text-[9px]' },
    // Emails
    {
      regex: /([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]+)/g,
      className: 'text-cyan-300 font-medium',
    },
    // IP addresses and ports
    {
      regex: /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?)/g,
      className: 'text-amber-300 font-mono text-[9px]',
    },
    // Verification codes
    { regex: /(\d{3}[-\s]?\d{3})/g, className: 'text-yellow-300 font-bold' },
    // Step indicators like [1/8]
    { regex: /(\[\d+\/\d+\])/g, className: 'text-purple-400 font-semibold' },
    // Status tags like [OK], [IMAP], etc
    { regex: /(\[[A-Z]+\])/g, className: 'text-slate-400 font-mono text-[9px]' },
  ];

  let result: React.ReactNode[] = [message];

  patterns.forEach(({ regex, className }) => {
    result = result.flatMap((part, partIndex) => {
      if (typeof part !== 'string') return part;

      const segments: React.ReactNode[] = [];
      let lastIndex = 0;
      let match;

      const localRegex = new RegExp(regex.source, regex.flags);

      while ((match = localRegex.exec(part)) !== null) {
        if (match.index > lastIndex) {
          segments.push(part.slice(lastIndex, match.index));
        }
        segments.push(
          <span key={`${partIndex}-${match.index}`} className={className}>
            {match[1]}
          </span>
        );
        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < part.length) {
        segments.push(part.slice(lastIndex));
      }

      return segments.length > 0 ? segments : [part];
    });
  });

  return <>{result}</>;
}

// Detect if message is JSON artifact (token data, etc)
function isJsonArtifact(message: string): boolean {
  const trimmed = message.trim();
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    message.includes('"token_data"') ||
    message.includes('"refresh_token"') ||
    (message.includes('"email"') && message.includes('"token"'))
  );
}

// JSON Artifact component - inline text link instead of button block
function JsonArtifact({ message, onCopy }: { message: string; onCopy: (text: string) => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    onCopy(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Try to extract email from JSON
  let label = 'token data';
  try {
    const parsed = JSON.parse(message);
    if (parsed.email) {
      label = parsed.email.split('@')[0];
    }
  } catch {
    // Not valid JSON, use default label
  }

  return (
    <button
      onClick={handleCopy}
      className="inline text-cyan-400 hover:text-cyan-300 hover:underline decoration-dashed transition-colors text-[10px]"
    >
      {copied ? '✓ copied' : `[view ${label}]`}
    </button>
  );
}

function CompactLogRow({ log, onCopy }: { log: LogEntry; onCopy: (text: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isDebug = log.level === 'debug';
  const isJson = isJsonArtifact(log.message);
  const { icon, color } = getLogIcon(log.message, log.level);

  const formatTime = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return '--:--:--';
    }
  };

  if (isDebug) {
    return (
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-1 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <ChevronRight
            className={cn(
              'w-2.5 h-2.5 text-slate-700 transition-transform',
              expanded && 'rotate-90'
            )}
          />
          <span className="text-[9px] text-slate-700 font-mono">{formatTime(log.timestamp)}</span>
          <span className="text-[10px] text-slate-700 truncate">{t('logFeed.debug')}</span>
        </div>
        {expanded && (
          <div className="mt-1 pl-5 text-[9px] text-slate-600 break-all">{log.message}</div>
        )}
      </button>
    );
  }

  // JSON artifact - show as inline text link
  if (isJson) {
    return (
      <div className="flex items-start gap-2 px-3 py-1.5 hover:bg-white/[0.03] transition-colors">
        <div className={cn('shrink-0 mt-0.5', color)}>{icon}</div>
        <span className="text-[11px] text-slate-400 font-mono shrink-0 tabular-nums">
          {formatTime(log.timestamp)}
        </span>
        <span className="text-[11px] text-slate-300 flex-1">
          Token received successfully <JsonArtifact message={log.message} onCopy={onCopy} />
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 px-3 py-1.5 hover:bg-white/[0.03] transition-colors group">
      {/* Icon instead of dot */}
      <div className={cn('shrink-0 mt-0.5', color)}>{icon}</div>

      {/* Timestamp - bigger and brighter */}
      <span className="text-[11px] text-slate-400 font-mono shrink-0 tabular-nums">
        {formatTime(log.timestamp)}
      </span>

      {/* Message with highlights - brighter */}
      <span className="text-[11px] text-slate-300 flex-1 break-words leading-relaxed">
        {formatLogMessage(log.message)}
      </span>
    </div>
  );
}

export function CompactLogFeed({ logs, onClear, className }: CompactLogFeedProps) {
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
    // Increased threshold to 100px to make it easier to stop auto-scroll
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
    setAutoScroll(isAtBottom);
    setShowScrollBtn(!isAtBottom && logs.length > 10);
  }, [logs.length]);

  const scrollToBottom = () => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
    setAutoScroll(true);
  };

  // Filter out success logs (they're shown as cards above)
  const filteredLogs = logs.filter(
    log => log.level !== 'success' || !log.message.includes('Account created')
  );

  return (
    <div className={cn('relative flex flex-col h-full', className)}>
      {/* Header - brighter */}
      <div
        className="flex items-center justify-between px-3 py-2.5 border-b border-white/5"
        style={{ background: 'rgba(0, 0, 0, 0.2)' }}
      >
        <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
          {t('logFeed.activityLog')}
        </span>
        {onClear && (
          <button
            onClick={onClear}
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            aria-label={t('logs.clearLogs')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Log content with smooth scroll and wider scrollbar */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
        style={{
          scrollBehavior: 'smooth',
          // Custom wider scrollbar for better usability
          scrollbarWidth: 'auto',
          scrollbarColor: 'rgba(255, 255, 255, 0.2) transparent',
        }}
      >
        <style
          dangerouslySetInnerHTML={{
            __html: `
          .flex-1::-webkit-scrollbar { width: 10px; }
          .flex-1::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 5px; border: 2px solid rgba(0,0,0,0); background-clip: padding-box; }
          .flex-1::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.3); border: 2px solid rgba(0,0,0,0); background-clip: padding-box; }
          .flex-1::-webkit-scrollbar-track { background: transparent; }
        `,
          }}
        />
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-700 text-[10px]">
            {t('logFeed.waitingForActivity')}
          </div>
        ) : (
          <div className="py-1">
            {filteredLogs.map(log => (
              <CompactLogRow key={log.id} log={log} onCopy={copy} />
            ))}
          </div>
        )}
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-2 right-2 p-1.5 rounded text-slate-600 hover:text-slate-400 transition-colors bg-black/60 border border-white/10"
          aria-label={t('common.scrollToBottom')}
        >
          <ArrowDown className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
