import { devboxTime, type DevboxEventRow } from '@/lib/backend/modules/devbox';

export function devboxEventLine(row: DevboxEventRow): string {
  const parts = [devboxTime(row.ts), row.kind, row.tool, row.status].filter(
    (part): part is string => typeof part === 'string' && part !== '' && part !== '—',
  );
  return parts.length > 0 ? parts.join(' · ') : JSON.stringify(row);
}

export type DevboxEventTone = 'ok' | 'failed' | 'running' | 'other';

const OK_STATUSES = new Set(['ok', 'success', 'succeeded', 'finished', 'done', 'approved']);
const FAILED_STATUSES = new Set(['failed', 'error', 'rejected', 'denied', 'cancelled']);
const RUNNING_STATUSES = new Set(['running', 'pending', 'started', 'in_progress', 'queued']);

export function devboxEventTone(row: DevboxEventRow): DevboxEventTone {
  const status = String(row.status ?? '').toLowerCase();
  if (OK_STATUSES.has(status)) return 'ok';
  if (FAILED_STATUSES.has(status)) return 'failed';
  if (RUNNING_STATUSES.has(status)) return 'running';
  return 'other';
}

export function devboxEventText(row: DevboxEventRow): string {
  const head =
    typeof row.tool === 'string' && row.tool !== ''
      ? row.tool
      : typeof row.kind === 'string'
        ? row.kind
        : '';
  const status = typeof row.status === 'string' ? row.status : '';
  const parts = [head, status].filter(part => part !== '' && part !== '—');
  return parts.length > 0 ? parts.join(' · ') : JSON.stringify(row);
}
