import { safeInvoke } from '@/lib/backend/core';
import type { ObsEvent, ObsEventInput } from './types';

const SESSION_ID_KEY = 'stitch.obs.session_id';

// Batch flush thresholds: send when the queue reaches this many events OR
// this much time has passed since the last flush, whichever comes first.
const FLUSH_THRESHOLD = 20;
const FLUSH_INTERVAL_MS = 20_000;

// Hard cap on the in-memory queue. If exceeded (e.g. backend down + re-queues),
// drop the oldest events to bound memory growth.
const MAX_QUEUE = 200;

let queue: ObsEventInput[] = [];
let inFlight = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// Events that have already been re-queued once after a failed flush. Each
// event gets exactly one retry; a second failure drops it. WeakSet entries
// are GC'd once the event object is no longer referenced.
let retriedEvents = new WeakSet<ObsEventInput>();

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

function trimQueue(): void {
  if (queue.length > MAX_QUEUE) {
    queue = queue.slice(queue.length - MAX_QUEUE);
  }
}

function clearFlushTimer(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

async function flush(): Promise<void> {
  if (inFlight) return;
  // We are flushing now; cancel any pending interval tick so we don't double-fire.
  clearFlushTimer();

  // Drain the queue into a batch, skipping forwarded events to avoid
  // recursion loops when this client ingests its own forwarded output.
  const batch: ObsEventInput[] = [];
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    if (next.origin === 'forwarded' || next.source === 'rust-forwarded') {
      continue;
    }
    batch.push(next);
  }

  if (batch.length === 0) return;

  inFlight = true;
  try {
    await safeInvoke<ObsEvent>('obs_ingest', { events: batch });
  } catch {
    // Re-queue each event exactly once; drop events that already exhausted
    // their retry to prevent unbounded growth on a persistently failing backend.
    const reQueue: ObsEventInput[] = [];
    for (const ev of batch) {
      if (retriedEvents.has(ev)) continue;
      retriedEvents.add(ev);
      reQueue.push(ev);
    }
    if (reQueue.length > 0) {
      queue.unshift(...reQueue);
      trimQueue();
    }
  } finally {
    inFlight = false;
    if (queue.length >= FLUSH_THRESHOLD) {
      void flush();
    } else if (queue.length > 0) {
      scheduleFlush();
    }
  }
}

// Best-effort flush when the page is being hidden/unloaded. Fire-and-forget;
// the inFlight guard inside flush() prevents double-flush if both events fire.
function flushOnHide(): void {
  void flush();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushOnHide);
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushOnHide();
    }
  });
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

  queue.push(normalized);
  trimQueue();

  if (queue.length >= FLUSH_THRESHOLD) {
    void flush();
  } else {
    scheduleFlush();
  }
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

// Test-only: reset module-level state. Not part of the public API.
export function __resetForTests(): void {
  clearFlushTimer();
  queue = [];
  inFlight = false;
  retriedEvents = new WeakSet<ObsEventInput>();
}
