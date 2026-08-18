// API Key types with metadata tracking

export type KeyStatus = 'ok' | 'invalid' | 'rate_limited' | 'error' | 'unknown';

export interface ApiKeyEntry {
  key: string;
  baseUrl?: string;
  prefix?: string;
  addedAt: number;
  lastTested?: number;
  status?: KeyStatus;
  lastError?: string;
  models?: string[];
}

export type KeyFilter = 'all' | 'ok' | 'rate_limited' | 'invalid';
