export type ObsLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ObsErrorPayload {
  code?: string;
  message: string;
  stack?: string;
}

export interface ObsEvent {
  eventId: string;
  ts: string;
  level: ObsLevel;
  source: string;
  subsystem: string;
  name: string;
  message: string;
  fields?: Record<string, unknown>;
  error?: ObsErrorPayload;
  sessionId: string;
  correlationId?: string;
  jobId?: string;
  origin?: string;
  dedupKey?: string;
}

export interface ObsEventInput {
  eventId?: string;
  level: ObsLevel;
  source: string;
  subsystem: string;
  name: string;
  message: string;
  fields?: Record<string, unknown>;
  error?: ObsErrorPayload;
  correlationId?: string;
  jobId?: string;
  origin?: string;
  dedupKey?: string;
}
