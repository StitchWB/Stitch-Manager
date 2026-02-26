export interface ConnectionStateEntry {
  status: 'idle' | 'loading' | 'ok' | 'error';
  message?: string;
}

export type ConnectionStateMap = Record<number, ConnectionStateEntry>;

export interface HistorySummary {
  total: number;
  errors: number;
}
