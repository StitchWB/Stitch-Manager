import { safeInvoke } from '@/lib/backend/core';
import type { ObsEvent, ObsEventInput } from './types';

const SESSION_ID_KEY = 'stitch.obs.session_id';
const MAX_BUFFERED = 100;

let inFlight = false;
let buffer: ObsEventInput[] = [];

function ensureSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_ID_KEY);
    if (existing) return existing;
    const generated = crypto.randomUUID();
    localStorage.setItem(SESSION_ID_KEY, generated);
    return generated;
  } catch {
    return crypto.randomUUID();
  }
}

const SESSION_ID = ensureSessionId();

function trimBuffer() {
  if (buffer.length > MAX_BUFFERED) {
    buffer = buffer.slice(buffer.length - MAX_BUFFERED);
  }
}

async function flushBuffer() {
  if (inFlight || buffer.length === 0) return;
  inFlight = true;

  try {
    while (buffer.length > 0) {
      const next = buffer.shift();
      if (!next) break;

      // Prevent recursion loops on forwarded events
      if (next.origin === 'forwarded' || next.source === 'rust-forwarded') {
        continue;
      }

      await safeInvoke<ObsEvent>('obs_ingest', { event: next });
    }
  } catch {
    // Swallow to keep app stable; drop noisy events if backend unavailable.
    buffer = [];
  } finally {
    inFlight = false;
  }
}

export function createCorrelationId(): string {
  return crypto.randomUUID();
}

export function getSessionId(): string {
  return SESSION_ID;
}

export function reportObsEvent(event: ObsEventInput): void {
  const normalized: ObsEventInput = {
    ...event,
    origin: event.origin ?? 'ingest',
    fields: {
      ...(event.fields ?? {}),
      frontendSessionId: SESSION_ID,
    },
  };

  buffer.push(normalized);
  trimBuffer();
  void flushBuffer();
}

export function reportFrontendError(
  message: string,
  error?: unknown,
  context?: Record<string, unknown>
): void {
  const payload =
    error instanceof Error
      ? { message: error.message, stack: error.stack }
      : { message: String(error ?? message) };

  reportObsEvent({
    level: 'error',
    source: 'frontend',
    subsystem: 'ui',
    name: 'ui.error',
    message,
    error: payload,
    fields: context,
  });
}
