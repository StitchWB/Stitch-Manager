import { reportObsEvent, reportFrontendError } from './client';

let installed = false;
let originalConsoleError: typeof console.error | null = null;
let originalConsoleWarn: typeof console.warn | null = null;

function toMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function installObservabilityHooks() {
  if (installed) return;
  installed = true;

  window.addEventListener('error', event => {
    reportFrontendError(event.message || 'Unhandled window error', event.error, {
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', event => {
    reportFrontendError('Unhandled promise rejection', event.reason, {
      type: 'unhandledrejection',
    });
  });

  if (!originalConsoleError) {
    originalConsoleError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      reportObsEvent({
        level: 'error',
        source: 'frontend',
        subsystem: 'console',
        name: 'ui.console_error',
        message: args.map(toMessage).join(' '),
      });
      originalConsoleError?.(...args);
    };
  }

  if (!originalConsoleWarn) {
    originalConsoleWarn = console.warn.bind(console);
    console.warn = (...args: unknown[]) => {
      reportObsEvent({
        level: 'warn',
        source: 'frontend',
        subsystem: 'console',
        name: 'ui.console_warn',
        message: args.map(toMessage).join(' '),
      });
      originalConsoleWarn?.(...args);
    };
  }

  reportObsEvent({
    level: 'info',
    source: 'frontend',
    subsystem: 'ui',
    name: 'ui.hooks_installed',
    message: 'Frontend observability hooks installed',
  });
}
