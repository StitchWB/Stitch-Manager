import { safeInvoke } from '../core';
import { formatTime } from '@/lib/utils';

const NS = 'plugin.stitch-devbox';

export type DevboxTone = 'ok' | 'warn' | 'down';

export interface DevboxVitalCard {
  id: string;
  title: string;
  value: string;
  tone: DevboxTone;
  hint?: string;
  updatedAt?: string | number | null;
}

export interface DevboxOverview {
  cards: DevboxVitalCard[];
}

export interface DevboxProfileRow {
  name: string;
  mode: string;
  project_dir: string;
  active: boolean;
}

export interface DevboxProfileContent {
  json: string;
  valid: boolean;
  errors: string[];
}

export interface DevboxProfilePutResult {
  valid: boolean;
  errors: string[];
}

export interface DevboxAccepted {
  accepted: boolean;
  actionId?: string;
  reason?: string;
}

export interface DevboxActionCurrent {
  id: string;
  cmd: string;
  startedAt: string | number;
}

export interface DevboxRecentAction {
  id: string;
  cmd: string;
  status: string;
  startedAt: string | number;
  finishedAt?: string | number | null;
  exit?: number | null;
  payload?: Record<string, unknown> | null;
}

export interface DevboxActionStatus {
  busy: boolean;
  current?: DevboxActionCurrent | null;
  recent: DevboxRecentAction[];
}

export interface DevboxJobRow {
  id: string;
  tool: string;
  status: string;
  startedAt: string | number;
  sessionId?: string | null;
}

export interface DevboxPermissionRow {
  id: string;
  tool: string;
  summary: string;
  startedAt: string | number;
}

export type DevboxPermissionDecision = 'once' | 'reject';

export interface DevboxLogSource {
  name: string;
  lines: string[];
}

export interface DevboxLogs {
  sources: DevboxLogSource[];
}

export interface DevboxEventRow {
  ts?: string | number | null;
  kind?: string;
  tool?: string;
  status?: string;
  [key: string]: unknown;
}

const NO_CACHE = { noCache: true } as const;

export function devboxOverview(): Promise<DevboxOverview> {
  return safeInvoke<DevboxOverview>(`${NS}.overview`, {}, NO_CACHE);
}

export function devboxProfilesList(): Promise<DevboxProfileRow[]> {
  return safeInvoke<DevboxProfileRow[]>(`${NS}.profiles_list`, {}, NO_CACHE);
}

export function devboxProfileGet(name: string): Promise<DevboxProfileContent> {
  return safeInvoke<DevboxProfileContent>(`${NS}.profile_get`, { name }, NO_CACHE);
}

export function devboxProfilePut(
  name: string,
  json: string,
): Promise<DevboxProfilePutResult> {
  return safeInvoke<DevboxProfilePutResult>(`${NS}.profile_put`, { name, json });
}

export function devboxProfileDelete(name: string): Promise<{ deleted: boolean }> {
  return safeInvoke<{ deleted: boolean }>(`${NS}.profile_delete`, { name });
}

export interface DevboxFolderCheck {
  exists: boolean;
  is_git: boolean;
}

export interface DevboxProfileDefaults {
  git_name: string;
  git_email: string;
}

export function devboxFolderCheck(path: string): Promise<DevboxFolderCheck> {
  return safeInvoke<DevboxFolderCheck>(`${NS}.folder_check`, { path }, NO_CACHE);
}

export function devboxProfileDefaults(): Promise<DevboxProfileDefaults> {
  return safeInvoke<DevboxProfileDefaults>(`${NS}.profile_defaults`, {}, NO_CACHE);
}

export function devboxStackStart(name: string, preview: boolean): Promise<DevboxAccepted> {
  return safeInvoke<DevboxAccepted>(`${NS}.stack_start`, { name, preview });
}

export function devboxStackDown(): Promise<DevboxAccepted> {
  return safeInvoke<DevboxAccepted>(`${NS}.stack_down`, {});
}

export function devboxStackFullDown(): Promise<DevboxAccepted> {
  return safeInvoke<DevboxAccepted>(`${NS}.stack_full_down`, {});
}

export function devboxProfileUse(name: string): Promise<DevboxAccepted> {
  return safeInvoke<DevboxAccepted>(`${NS}.profile_use`, { name });
}

export function devboxIngressControl(action: 'up' | 'down'): Promise<DevboxAccepted> {
  return safeInvoke<DevboxAccepted>(`${NS}.ingress_control`, { action });
}

export function devboxIssueTokens(): Promise<DevboxAccepted> {
  return safeInvoke<DevboxAccepted>(`${NS}.issue_tokens`, {});
}

export function devboxRunDoctor(): Promise<DevboxAccepted> {
  return safeInvoke<DevboxAccepted>(`${NS}.run_doctor`, {});
}

export function devboxWatchdogControl(action: 'start' | 'stop'): Promise<DevboxAccepted> {
  return safeInvoke<DevboxAccepted>(`${NS}.watchdog_control`, { action });
}

export function devboxCockpitOpen(): Promise<DevboxAccepted> {
  return safeInvoke<DevboxAccepted>(`${NS}.cockpit_open`, {});
}

export function devboxActionStatus(): Promise<DevboxActionStatus> {
  return safeInvoke<DevboxActionStatus>(`${NS}.action_status`, {}, NO_CACHE);
}

export interface DevboxObserved<T> {
  rows: T[];
  bridge: 'up' | 'down';
}

function observedRows<T>(raw: unknown): DevboxObserved<T> {
  if (Array.isArray(raw)) return { rows: raw as T[], bridge: 'up' };
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(obj.rows) ? (obj.rows as T[]) : [];
  const bridge = obj.bridge === 'down' || obj.source === 'events' ? 'down' : 'up';
  return { rows, bridge };
}

export function devboxJobsLive(): Promise<DevboxObserved<DevboxJobRow>> {
  return safeInvoke<unknown>(`${NS}.jobs_live`, {}, NO_CACHE).then(observedRows<DevboxJobRow>);
}

export function devboxJobCancel(jobId: string): Promise<DevboxAccepted> {
  return safeInvoke<DevboxAccepted>(`${NS}.job_cancel`, { jobId });
}

export function devboxPermissionsPending(): Promise<DevboxObserved<DevboxPermissionRow>> {
  return safeInvoke<unknown>(`${NS}.permissions_pending`, {}, NO_CACHE).then(
    observedRows<DevboxPermissionRow>,
  );
}

export function devboxPermissionReply(
  permissionId: string,
  decision: DevboxPermissionDecision,
): Promise<DevboxAccepted> {
  return safeInvoke<DevboxAccepted>(`${NS}.permission_reply`, { permissionId, decision });
}

export function devboxEventsTail(limit: number): Promise<unknown> {
  return safeInvoke<unknown>(`${NS}.events_tail`, { limit }, NO_CACHE);
}

export function devboxLogs(params: {
  source?: string;
  filter?: string;
  limit?: number;
}): Promise<DevboxLogs> {
  return safeInvoke<DevboxLogs>(`${NS}.logs`, params, NO_CACHE);
}

export function devboxTime(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return formatTime(value * 1000);
  }
  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (value.trim() !== '' && Number.isFinite(asNumber)) {
      return formatTime(asNumber * 1000);
    }
    return formatTime(value);
  }
  return '—';
}

export function devboxActionFinished(action: DevboxRecentAction): boolean {
  return (
    action.finishedAt !== null &&
    action.finishedAt !== undefined &&
    action.finishedAt !== ''
  ) ||
    action.status === 'finished' ||
    action.status === 'succeeded' ||
    action.status === 'done';
}

export function devboxActionSucceeded(action: DevboxRecentAction): boolean {
  return devboxActionFinished(action) && (action.exit === null || action.exit === undefined || action.exit === 0);
}

export function devboxLatestFinishedPayload(
  recent: DevboxRecentAction[] | undefined,
  cmd: string,
): Record<string, unknown> | null {
  if (!Array.isArray(recent)) return null;
  for (const action of recent) {
    if (action.cmd !== cmd) continue;
    if (!devboxActionSucceeded(action)) continue;
    if (action.payload && typeof action.payload === 'object') return action.payload;
  }
  return null;
}

export function devboxNormalizeEventRows(payload: unknown): DevboxEventRow[] {
  if (Array.isArray(payload)) {
    return payload.filter((row): row is DevboxEventRow => row !== null && typeof row === 'object');
  }
  if (payload !== null && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const candidate = record.events ?? record.rows ?? record.items;
    if (Array.isArray(candidate)) {
      return candidate.filter((row): row is DevboxEventRow => row !== null && typeof row === 'object');
    }
  }
  return [];
}

export function devboxNormalizeCards(payload: unknown): DevboxVitalCard[] {
  let raw: unknown[] = [];
  if (Array.isArray(payload)) {
    raw = payload;
  } else if (payload !== null && typeof payload === 'object') {
    const cards = (payload as Record<string, unknown>).cards;
    if (Array.isArray(cards)) raw = cards;
  }
  const result: DevboxVitalCard[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const title = typeof row.title === 'string' ? row.title : String(row.id ?? '');
    const value =
      typeof row.value === 'string' ? row.value : row.value != null ? String(row.value) : '';
    const tone: DevboxTone = row.tone === 'warn' || row.tone === 'down' ? row.tone : 'ok';
    const updatedAt = row.updatedAt;
    result.push({
      id: typeof row.id === 'string' && row.id !== '' ? row.id : title,
      title,
      value,
      tone,
      hint: typeof row.hint === 'string' ? row.hint : undefined,
      updatedAt:
        typeof updatedAt === 'string' || typeof updatedAt === 'number' ? updatedAt : null,
    });
  }
  return result;
}

export function devboxVitalValue(
  cards: DevboxVitalCard[] | null | undefined,
  match: string,
): string | null {
  if (!Array.isArray(cards)) return null;
  const needle = match.toLowerCase();
  const card = cards.find(
    c => c.id?.toLowerCase().includes(needle) || c.title?.toLowerCase().includes(needle),
  );
  return card ? String(card.value ?? '').toLowerCase() : null;
}
