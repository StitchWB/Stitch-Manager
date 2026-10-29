/**
 * Global anti-spam patch for sonner toasts.
 *
 * Every module in the app shares the same sonner instance, so patching the
 * exported `toast` function's properties here applies everywhere — including
 * call sites that import `toast` directly from 'sonner'.
 *
 * Behavior:
 * - Identical toasts (same kind + same string message) fired while the
 *   previous one is still visible update it in place via a stable id and get
 *   a "×N" counter instead of stacking.
 * - Sensible per-kind default durations (success/info short, errors long).
 * - Toasts with an explicit `id` (e.g. the backend-offline banner) and
 *   non-string messages bypass dedup entirely.
 */
import { toast } from 'sonner';
import type { ExternalToast } from 'sonner';

type ToastMessage = Parameters<typeof toast.success>[0];
type ToastEmit = (message: ToastMessage, options?: ExternalToast) => string | number;
type DismissCallback = NonNullable<ExternalToast['onDismiss']>;
type ToastArg = Parameters<DismissCallback>[0];

const DEFAULT_DURATION_MS = {
  success: 2500,
  message: 2500,
  info: 2500,
  warning: 3500,
  error: 5000,
} as const;

type ToastKind = keyof typeof DEFAULT_DURATION_MS;

interface ActiveToast {
  id: string;
  count: number;
  seenAt: number;
}

const ACTIVE_TTL_MS = 60_000;
const activeToasts = new Map<string, ActiveToast>();

let nextId = 0;

function wrap(kind: ToastKind, original: ToastEmit): ToastEmit {
  return (message, options) => {
    const duration = options?.duration ?? DEFAULT_DURATION_MS[kind];

    // Explicit ids (backend-offline banner) and rich nodes must pass through.
    if (typeof message !== 'string' || options?.id !== undefined) {
      return original(message, { ...options, duration });
    }

    const key = `${kind}:${message}`;
    const now = Date.now();
    const existing = activeToasts.get(key);

    if (existing && now - existing.seenAt < ACTIVE_TTL_MS) {
      existing.count += 1;
      existing.seenAt = now;
      return original(`${message} ×${existing.count}`, {
        ...options,
        id: existing.id,
        duration,
      });
    }

    nextId += 1;
    const id = `dedup-${kind}-${nextId}`;
    const entry: ActiveToast = { id, count: 1, seenAt: now };
    activeToasts.set(key, entry);

    const release = () => {
      if (activeToasts.get(key) === entry) {
        activeToasts.delete(key);
      }
    };
    const onDismiss: DismissCallback = (toastItem: ToastArg) => {
      release();
      options?.onDismiss?.(toastItem);
    };
    const onAutoClose = (toastItem: ToastArg) => {
      release();
      options?.onAutoClose?.(toastItem);
    };

    return original(message, { ...options, id, duration, onDismiss, onAutoClose });
  };
}

toast.success = wrap('success', toast.success);
toast.error = wrap('error', toast.error);
toast.info = wrap('info', toast.info);
toast.warning = wrap('warning', toast.warning);
toast.message = wrap('message', toast.message);
