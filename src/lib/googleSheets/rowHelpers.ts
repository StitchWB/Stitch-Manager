import type { KeyValue } from '@/types/generated';

export function cellsToRecord(cells: KeyValue[]): Record<string, string> {
  return cells.reduce(
    (acc, kv) => {
      acc[kv.key] = kv.value;
      return acc;
    },
    {} as Record<string, string>
  );
}

export function pickFirst(record: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return '';
}

export function parseList(value: string): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .map(item => String(item).trim())
        .filter(Boolean)
        .slice(0, 25);
    }
  } catch {
    // fallback to delimiter parsing
  }

  return trimmed
    .split(/[;,|]/g)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 25);
}
