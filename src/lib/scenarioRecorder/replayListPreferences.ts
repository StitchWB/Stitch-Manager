export type ReplayListSort = 'recent' | 'health' | 'steps';
export type ReplayListHealthFilter = 'all' | 'valid' | 'errors';

export type ReplayListPrefs = {
  sort?: ReplayListSort;
  compact?: boolean;
  healthFilter?: ReplayListHealthFilter;
};

const REPLAY_LIST_PREFS_KEY = 'scenarioReplay.listPrefs.v1';
const REPLAY_LIST_QUERY_KEY = 'scenarioReplay.listQuery.v1';

function replayListQueryKey(alias: string | null): string {
  return `${REPLAY_LIST_QUERY_KEY}:${alias ?? '__global__'}`;
}

export function readReplayListPrefs(): ReplayListPrefs {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(REPLAY_LIST_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ReplayListPrefs;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeReplayListPrefs(prefs: ReplayListPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REPLAY_LIST_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage failures
  }
}

export function readReplayListQuery(alias: string | null): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.sessionStorage.getItem(replayListQueryKey(alias)) ?? '';
  } catch {
    return '';
  }
}

export function writeReplayListQuery(alias: string | null, query: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(replayListQueryKey(alias), query);
  } catch {
    // ignore storage failures
  }
}
