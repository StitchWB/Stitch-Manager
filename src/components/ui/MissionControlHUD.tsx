import { useMemo } from 'react';
import { cn } from '../../lib/utils';
import { t } from '@/lib/i18n';
import { ProcessTimeline, type ProcessStep } from './ProcessTimeline';
import { LiveStatusCard, type LiveAction } from './LiveStatusCard';
import { SuccessCard } from './SuccessCard';
import { CompactLogFeed } from './CompactLogFeed';
import { Cpu, Globe, Timer } from 'lucide-react';

interface LogEntry {
  id: string;
  level: 'info' | 'success' | 'error' | 'warn' | 'debug';
  message: string;
  timestamp: string;
}

interface MissionControlHUDProps {
  logs: LogEntry[];
  isRunning?: boolean;
  canStart?: boolean;
  onStart?: () => void;
  onClear?: () => void;
  className?: string;
  activeProvider?: string;
  onProviderChange?: (provider: string) => void;
  showDebug?: boolean;
  onShowDebugChange?: (show: boolean) => void;
  hideTimeline?: boolean;
}

// Parse log message to determine current step
function parseCurrentStep(logs: LogEntry[], isRunning: boolean): ProcessStep {
  if (logs.length === 0) return 'init';

  // Scan from newest to oldest
  for (let i = logs.length - 1; i >= 0; i--) {
    const msg = logs[i].message.toLowerCase();

    // Success states
    if (
      msg.includes('account created') ||
      msg.includes('registration complete') ||
      logs[i].level === 'success'
    ) {
      return 'done';
    }

    // Token stage
    if (msg.includes('token') || msg.includes('refresh_token') || msg.includes('oauth callback')) {
      return 'token';
    }

    // Verification stage
    if (
      msg.includes('verification') ||
      msg.includes('code found') ||
      msg.includes('entering code') ||
      msg.includes('verify') ||
      msg.includes('allow access')
    ) {
      return 'verify';
    }

    // Auth stage (filling forms)
    if (
      msg.includes('entering') ||
      msg.includes('typing') ||
      msg.includes('password') ||
      msg.includes('email') ||
      msg.includes('signup') ||
      msg.includes('sign up') ||
      msg.includes('create account') ||
      msg.includes('form')
    ) {
      return 'auth';
    }

    // Browser stage
    if (
      msg.includes('browser') ||
      msg.includes('chromium') ||
      msg.includes('headless') ||
      msg.includes('navigat') ||
      msg.includes('opening') ||
      msg.includes('window')
    ) {
      return 'browser';
    }

    // IMAP stage
    if (
      msg.includes('imap') ||
      msg.includes('inbox') ||
      msg.includes('mail') ||
      msg.includes('connected to imap') ||
      msg.includes('gmail')
    ) {
      return 'imap';
    }

    // Init stage
    if (msg.includes('starting') || msg.includes('registering') || msg.includes('init')) {
      return 'init';
    }
  }

  // If running but no specific step detected, stay at init
  if (isRunning) return 'init';

  return 'init';
}

// Parse log message to determine live action
function parseLiveAction(
  logs: LogEntry[],
  isRunning: boolean
): { action: LiveAction; detail?: string } {
  // If running but no logs yet, show processing
  if (isRunning && logs.length === 0) {
    return { action: 'processing', detail: 'Starting...' };
  }

  if (logs.length === 0) return { action: 'idle' };

  const lastLog = logs[logs.length - 1];
  const msg = lastLog.message.toLowerCase();

  // Success
  if (lastLog.level === 'success' || msg.includes('account created')) {
    const emailMatch = lastLog.message.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]+)/);
    return { action: 'success', detail: emailMatch?.[1] };
  }

  // Error
  if (lastLog.level === 'error') {
    const msg = lastLog.message.toLowerCase();
    if (msg.includes('timed out') || msg.includes('timeout')) {
      return { action: 'warning', detail: lastLog.message.slice(0, 50) };
    }
    return { action: 'error', detail: lastLog.message.slice(0, 50) };
  }

  // Typing actions
  if (msg.includes('entering password') || msg.includes('typing password')) {
    const lengthMatch = msg.match(/(\d+)\s*char/);
    return {
      action: 'typing_password',
      detail: lengthMatch ? `${lengthMatch[1]} characters` : undefined,
    };
  }

  if (
    msg.includes('entering email') ||
    msg.includes('typing email') ||
    (msg.includes('entering') && msg.includes('@'))
  ) {
    return { action: 'typing_email' };
  }

  if (
    msg.includes('entering code') ||
    msg.includes('typing code') ||
    msg.includes('verification code')
  ) {
    const codeMatch = msg.match(/(\d{3}[-\s]?\d{3})/);
    return { action: 'typing_code', detail: codeMatch ? `Code: ${codeMatch[1]}` : undefined };
  }

  // Waiting for code
  if (msg.includes('waiting') && (msg.includes('code') || msg.includes('verification'))) {
    return { action: 'waiting_code', detail: 'Scanning inbox...' };
  }

  if (msg.includes('code found') || msg.includes('found code')) {
    const codeMatch = msg.match(/(\d{3}[-\s]?\d{3})/);
    return { action: 'typing_code', detail: codeMatch ? `Code: ${codeMatch[1]}` : 'Code received' };
  }

  // Verification
  if (msg.includes('verify') || msg.includes('allow access')) {
    return { action: 'verifying' };
  }

  // Token
  if (msg.includes('token') || msg.includes('oauth')) {
    return { action: 'getting_token' };
  }

  // Browser actions
  if (msg.includes('opening browser') || msg.includes('launching') || msg.includes('chromium')) {
    return { action: 'launching_browser' };
  }

  if (msg.includes('navigat') || msg.includes('loading page') || msg.includes('going to')) {
    return { action: 'navigating' };
  }

  // IMAP
  if (msg.includes('connecting') || msg.includes('imap')) {
    return { action: 'connecting', detail: 'IMAP server' };
  }

  if (msg.includes('scanning') || msg.includes('inbox') || msg.includes('checking mail')) {
    return { action: 'scanning_inbox' };
  }

  // If still running but no specific action, show processing (prevents flickering to idle)
  if (isRunning) {
    return { action: 'processing', detail: 'Working...' };
  }

  return { action: 'idle' };
}

// Extract successful accounts from logs
function extractSuccessAccounts(logs: LogEntry[]): string[] {
  const accounts: string[] = [];

  for (const log of logs) {
    if (log.level === 'success' && log.message.includes('@')) {
      const emailMatch = log.message.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]+)/);
      if (emailMatch && !accounts.includes(emailMatch[1])) {
        accounts.push(emailMatch[1]);
      }
    }
  }

  return accounts.slice(-3); // Show last 3
}

// Mini telemetry display
function TelemetryBar({ logs }: { logs: LogEntry[] }) {
  // Extract some stats from logs
  const stats = useMemo(() => {
    let proxyLocation = '';
    let browserStatus = '';

    for (const log of logs) {
      const msg = log.message;

      // Proxy/Geo detection
      if (msg.includes('Detected IP geo:') || msg.includes('PROFILE')) {
        const geoMatch = msg.match(/geo:\s*([^(]+)/i);
        if (geoMatch) proxyLocation = geoMatch[1].trim();
      }

      // Browser status
      if (msg.toLowerCase().includes('chromium') || msg.toLowerCase().includes('browser')) {
        if (
          msg.toLowerCase().includes('initialized') ||
          msg.toLowerCase().includes('successfully')
        ) {
          browserStatus = 'Active';
        }
      }
    }

    return { proxyLocation, browserStatus };
  }, [logs]);

  if (!stats.proxyLocation && !stats.browserStatus) return null;

  return (
    <div className="flex items-center gap-4 px-4 py-2 border-t border-white/5 text-[11px] text-slate-400">
      {stats.proxyLocation && (
        <div className="flex items-center gap-1.5">
          <Globe className="w-3 h-3" />
          <span>{stats.proxyLocation}</span>
        </div>
      )}
      {stats.browserStatus && (
        <div className="flex items-center gap-1.5">
          <Cpu className="w-3 h-3" />
          <span>{t('missionControl.browserStatus', { status: stats.browserStatus })}</span>
        </div>
      )}
      <div className="flex items-center gap-1.5 ml-auto">
        <Timer className="w-3 h-3" />
        <span>{new Date().toLocaleTimeString('en-US', { hour12: false })}</span>
      </div>
    </div>
  );
}

export function MissionControlHUD({
  logs,
  isRunning = false,
  canStart = true,
  onStart,
  onClear,
  className,
  activeProvider = 'all',
  onProviderChange,
  showDebug = false,
  onShowDebugChange,
  hideTimeline = false,
}: MissionControlHUDProps) {
  const currentStep = useMemo(() => parseCurrentStep(logs, isRunning), [logs, isRunning]);
  const { action, detail } = useMemo(() => parseLiveAction(logs, isRunning), [logs, isRunning]);
  const successAccounts = useMemo(() => extractSuccessAccounts(logs), [logs]);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Timeline - Top (hidden when PipelineControls shows its own step progress) */}
      {!hideTimeline && (
        <div
          className="shrink-0 border-b border-white/5"
          style={{ background: 'rgba(0, 0, 0, 0.3)' }}
        >
          <ProcessTimeline currentStep={currentStep} />
        </div>
      )}

      {/* Live Status Strip - Compact, no padding */}
      <div className="shrink-0">
        <LiveStatusCard action={action} detail={detail} onStart={onStart} canStart={canStart} />
      </div>

      {/* Success Strips - Compact, no padding */}
      {successAccounts.length > 0 && (
        <div className="shrink-0">
          {successAccounts.map(email => (
            <SuccessCard key={email} email={email} hasToken />
          ))}
        </div>
      )}

      {/* Compact Log Feed - Takes remaining space */}
      <div className="flex-1 min-h-0 border-t border-white/5">
        <CompactLogFeed
          logs={logs}
          onClear={onClear}
          activeProvider={activeProvider}
          onProviderChange={onProviderChange}
          showDebug={showDebug}
          onShowDebugChange={onShowDebugChange}
        />
      </div>

      {/* Telemetry Bar */}
      <TelemetryBar logs={logs} />
    </div>
  );
}
