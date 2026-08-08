import { useCallback, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

export interface ConfirmOptions {
  title: string;
  message: string | ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning';
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (accepted: boolean) => void;
}

let queue: PendingConfirm[] = [];
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): number {
  return queue.length;
}

function emitChange(): void {
  listeners.forEach((listener) => listener());
}

/**
 * Promise-based replacement for window.confirm(): resolves true when the
 * user confirms, false on cancel/Escape/backdrop. Rendered with the app's
 * own design system via <ConfirmDialogHost />.
 */
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    queue = [...queue, { ...options, resolve }];
    emitChange();
  });
}

export function ConfirmDialogHost() {
  const pendingCount = useSyncExternalStore(subscribe, getSnapshot);
  const current = pendingCount > 0 ? queue[0] : undefined;

  const finish = useCallback((accepted: boolean) => {
    const [head, ...rest] = queue;
    queue = rest;
    head?.resolve(accepted);
    emitChange();
  }, []);

  if (!current) {
    return null;
  }

  return (
    <ConfirmDialog
      isOpen
      onClose={() => finish(false)}
      onConfirm={() => finish(true)}
      title={current.title}
      message={current.message}
      confirmText={current.confirmText}
      cancelText={current.cancelText}
      variant={current.variant ?? 'danger'}
    />
  );
}
