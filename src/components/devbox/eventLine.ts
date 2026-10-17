import { devboxTime, type DevboxEventRow } from '@/lib/backend/modules/devbox';

export function devboxEventLine(row: DevboxEventRow): string {
  const parts = [devboxTime(row.ts), row.kind, row.tool, row.status].filter(
    (part): part is string => typeof part === 'string' && part !== '' && part !== '—',
  );
  return parts.length > 0 ? parts.join(' · ') : JSON.stringify(row);
}
