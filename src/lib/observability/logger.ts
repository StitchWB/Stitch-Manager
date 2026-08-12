/**
 * Frontend logger — the ONLY module allowed to touch `console` directly
 * (see the eslint override in .eslintrc.cjs). Everything else must use
 * `createLogger(scope)` so we keep a single, greppable, level-filterable
 * diagnostics surface.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function envLevel(): LogLevel {
  try {
    const raw = (import.meta.env.VITE_LOG_LEVEL as string | undefined)?.toLowerCase();
    if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
    // Default: verbose in dev, quiet in prod (matches the old DEV-guarded traces).
    return import.meta.env.DEV ? 'debug' : 'warn';
  } catch {
    return 'warn';
  }
}

const minLevel = () => LEVEL_ORDER[envLevel()];

export interface ScopedLogger {
  debug: (message: string, ...data: unknown[]) => void;
  info: (message: string, ...data: unknown[]) => void;
  warn: (message: string, ...data: unknown[]) => void;
  error: (message: string, ...data: unknown[]) => void;
}

export function createLogger(scope: string): ScopedLogger {
  const emit = (level: LogLevel, message: string, data: unknown[]) => {
    if (LEVEL_ORDER[level] < minLevel()) return;
    const line = `[${scope}] ${message}`;
    if (data.length > 0) {
      console[level](line, ...data);
    } else {
      console[level](line);
    }
  };

  return {
    debug: (m, ...d) => emit('debug', m, d),
    info: (m, ...d) => emit('info', m, d),
    warn: (m, ...d) => emit('warn', m, d),
    error: (m, ...d) => emit('error', m, d),
  };
}
