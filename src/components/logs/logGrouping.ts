import { getLogGroupKey, type LogEntry, type LogLevel } from '../../stores/logs';

export interface LogGroupData {
  id: string;
  name: string;
  source: string;
  entries: LogEntry[];
  status: 'success' | 'error' | 'progress' | 'info';
  duration: number;
  lastActivity: number;
  levelCounts: Record<LogLevel, number>;
}

function shortId(id: string): string {
  return id.length > 12 ? `…${id.slice(-12)}` : id;
}

export function groupLogsByOperation(logs: LogEntry[]): LogGroupData[] {
  const groups = new Map<string, LogEntry[]>();
  for (const log of logs) {
    const key = getLogGroupKey(log);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(log);
  }

  const result: LogGroupData[] = [];

  for (const [key, entries] of groups) {
    const hasError = entries.some(e => e.level === 'error');
    const hasSuccess = entries.some(e => e.level === 'success');
    const hasProgress = entries.some(
      e => e.message.includes('\u23F3') || e.message.includes('Attempt')
    );

    let status: 'success' | 'error' | 'progress' | 'info' = 'info';
    if (hasError) status = 'error';
    else if (hasSuccess) status = 'success';
    else if (hasProgress) status = 'progress';

    const timestamps = entries.map(e => new Date(e.timestamp).getTime());
    const firstTimestamp = Math.min(...timestamps);
    const lastTimestamp = Math.max(...timestamps);

    const levelCounts: Record<LogLevel, number> = {
      debug: 0,
      info: 0,
      success: 0,
      warn: 0,
      error: 0,
    };
    for (const e of entries) {
      levelCounts[e.level] = (levelCounts[e.level] ?? 0) + 1;
    }

    const first = entries[0];
    const name = first.correlationId
      ? shortId(first.correlationId)
      : first.sessionId
        ? shortId(first.sessionId)
        : first.source || 'system';

    result.push({
      id: key,
      name,
      source: first.source || 'system',
      entries,
      status,
      duration: lastTimestamp - firstTimestamp,
      lastActivity: lastTimestamp,
      levelCounts,
    });
  }

  return result.sort((a, b) => b.lastActivity - a.lastActivity);
}
