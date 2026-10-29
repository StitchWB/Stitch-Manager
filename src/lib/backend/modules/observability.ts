import { safeInvoke } from '../core';
import type { LogEntry } from './logs';

export interface ObsTimelineQuery {
  correlationId?: string;
  jobId?: string;
  limit?: number;
}

export async function getObsTimeline(query: ObsTimelineQuery): Promise<LogEntry[]> {
  return safeInvoke<LogEntry[]>('obs_timeline', { query });
}
