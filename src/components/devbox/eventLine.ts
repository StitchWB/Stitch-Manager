import { devboxTime, type DevboxEventRow } from '@/lib/backend/modules/devbox';
import { t } from '@/lib/i18n';

export type DevboxEventTone = 'ok' | 'failed' | 'running' | 'attention' | 'other';

const OK_STATUSES = new Set(['ok', 'success', 'succeeded', 'finished', 'done', 'approved']);
const FAILED_STATUSES = new Set(['failed', 'error', 'rejected', 'denied', 'cancelled', 'interrupted', 'timeout']);
const RUNNING_STATUSES = new Set(['running', 'pending', 'started', 'in_progress', 'queued']);
const ATTENTION_STATUSES = new Set(['awaiting_permission']);

export function devboxEventTone(row: DevboxEventRow): DevboxEventTone {
  const status = String(row.status ?? '').toLowerCase();
  if (ATTENTION_STATUSES.has(status)) return 'attention';
  if (OK_STATUSES.has(status)) return 'ok';
  if (FAILED_STATUSES.has(status)) return 'failed';
  if (RUNNING_STATUSES.has(status)) return 'running';
  return 'other';
}

const TOOL_LABEL_KEY: Record<string, string> = {
  bash: 'devboxPage.eventToolBash',
  edit: 'devboxPage.eventToolEdit',
  write: 'devboxPage.eventToolWrite',
  read: 'devboxPage.eventToolRead',
  apply_patch: 'devboxPage.eventToolApplyPatch',
};

// backend нормализует cmd к RPC-именам; легаси-записи в events.jsonl и
// cockpit-имена (start/down/use/ingress/doctor) мапим на те же лейблы
const ACTION_LABEL_KEY: Record<string, string> = {
  stack_start: 'devboxPage.eventActionStart',
  _start: 'devboxPage.eventActionStart',
  start: 'devboxPage.eventActionStart',
  stack_down: 'devboxPage.eventActionDown',
  _down: 'devboxPage.eventActionDown',
  down: 'devboxPage.eventActionDown',
  stack_full_down: 'devboxPage.eventActionDown',
  _full_down: 'devboxPage.eventActionDown',
  full_down: 'devboxPage.eventActionDown',
  profile_use: 'devboxPage.eventActionUse',
  apply_use: 'devboxPage.eventActionUse',
  use: 'devboxPage.eventActionUse',
  stop_host: 'devboxPage.eventActionStopHost',
  _stop_host: 'devboxPage.eventActionStopHost',
  ingress_control: 'devboxPage.eventActionIngress',
  _ingress: 'devboxPage.eventActionIngress',
  ingress: 'devboxPage.eventActionIngress',
  watchdog_control: 'devboxPage.eventActionWatchdog',
  _watchdog_control: 'devboxPage.eventActionWatchdog',
  run_doctor: 'devboxPage.eventActionDoctor',
  _doctor: 'devboxPage.eventActionDoctor',
  doctor: 'devboxPage.eventActionDoctor',
  cockpit_open: 'devboxPage.eventActionCockpit',
  issue_tokens: 'devboxPage.eventActionTokens',
  _issue_tokens: 'devboxPage.eventActionTokens',
  allow_port: 'devboxPage.eventActionAllowPort',
  job_cancel: 'devboxPage.eventActionJobCancel',
  permission_reply: 'devboxPage.eventActionPermissionReply',
};

const STATUS_LABEL_KEY: Record<string, string> = {
  completed: 'devboxPage.eventStatusCompleted',
  finished: 'devboxPage.eventStatusFinished',
  done: 'devboxPage.eventStatusDone',
  succeeded: 'devboxPage.eventStatusDone',
  failed: 'devboxPage.eventStatusFailed',
  error: 'devboxPage.eventStatusFailed',
  cancelled: 'devboxPage.eventStatusCancelled',
  interrupted: 'devboxPage.eventStatusInterrupted',
  awaiting_permission: 'devboxPage.eventStatusAwaitingPermission',
  running: 'devboxPage.eventStatusRunning',
  pending: 'devboxPage.eventStatusRunning',
  started: 'devboxPage.eventStatusRunning',
};

export function devboxEventToolLabel(tool: string): string | null {
  const key = TOOL_LABEL_KEY[tool.toLowerCase()];
  return key ? t(key) : null;
}

export function devboxEventPhrase(row: DevboxEventRow): string {
  const kind = typeof row.kind === 'string' ? row.kind : '';
  const tool = typeof row.tool === 'string' ? row.tool : '';
  const status = String(row.status ?? '').toLowerCase();
  const permission = typeof row.permission === 'string' ? row.permission : '';

  if (kind === 'action') {
    const key = ACTION_LABEL_KEY[tool];
    return key ? t(key) : tool || t('devboxPage.eventKindAction');
  }
  if (kind === 'mcp_request' || kind === 'tool_call') {
    const label = tool ? devboxEventToolLabel(tool) : null;
    return label ?? (tool || t('devboxPage.eventKindRequest'));
  }
  if (kind === 'mcp_response' || kind === 'permission_request') {
    if (status === 'awaiting_permission' || kind === 'permission_request') {
      return permission
        ? t('devboxPage.eventPermissionRequest', { tool: permission })
        : t('devboxPage.eventStatusAwaitingPermission');
    }
    const key = STATUS_LABEL_KEY[status];
    return key ? t(key) : status || t('devboxPage.eventKindResponse');
  }
  if (kind === 'tap_error') return t('devboxPage.eventKindTapError');
  if (kind === 'gateway') return t('devboxPage.eventKindGateway');
  if (kind === 'note') return t('devboxPage.eventKindNote');
  return tool || kind || t('devboxPage.eventKindNote');
}

export function devboxEventText(row: DevboxEventRow): string {
  return devboxEventPhrase(row);
}

export function devboxEventLine(row: DevboxEventRow): string {
  const parts = [devboxTime(row.ts), devboxEventPhrase(row), typeof row.tool === 'string' ? row.tool : '', typeof row.status === 'string' ? row.status : '']
    .filter((part): part is string => typeof part === 'string' && part !== '' && part !== '—');
  return parts.length > 0 ? parts.join(' · ') : JSON.stringify(row);
}
