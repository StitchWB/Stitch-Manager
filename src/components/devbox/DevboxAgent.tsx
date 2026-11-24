import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Briefcase,
  CheckCircle2,
  Circle,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { GlassCard } from '@/components/ui/GlassCard';
import { IconButton } from '@/components/ui/IconButton';
import { KeyValueList, type KeyValueRow } from '@/components/ui/KeyValueList';
import { Tooltip } from '@/components/ui/Tooltip';
import { t } from '@/lib/i18n';
import { cn, formatTime } from '@/lib/utils';
import {
  devboxJobCancel,
  devboxTime,
  type DevboxAccepted,
  type DevboxActionStatus,
  type DevboxEventRow,
  type DevboxJobRow,
  type DevboxObserved,
  type DevboxOverviewGateway,
  type DevboxPermissionRow,
  type DevboxProfileRow,
  type DevboxVitalCard,
} from '@/lib/backend/modules/devbox';
import { DevboxPrompt } from './DevboxPrompt';
import { DevboxSection } from './DevboxSection';
import { devboxEventText, devboxEventTone, type DevboxEventTone } from './eventLine';
import { devboxModeLabel } from './labels';
import {
  cardVitalState,
  findVitalCard,
  vitalStateLabelKey,
  type VitalState,
} from './state';
import type { DevboxTab, UseDevboxConnectResult } from './useDevboxConnect';

const BANNER_KEY = 'devbox.securityBannerDismissed';
const RECENT_LIMIT = 6;
const JOBS_LIMIT = 10;

const TOOL_INVENTORY: ReadonlyArray<readonly [string, 'native' | 'control']> = [
  ['read', 'native'],
  ['write', 'native'],
  ['edit', 'native'],
  ['apply_patch', 'native'],
  ['glob', 'native'],
  ['grep', 'native'],
  ['bash', 'native'],
  ['todowrite', 'native'],
  ['lsp', 'native'],
  ['webfetch', 'native'],
  ['opencode_native_info', 'control'],
  ['opencode_job_list', 'control'],
  ['opencode_job_result', 'control'],
  ['opencode_job_cancel', 'control'],
  ['opencode_permissions_pending', 'control'],
  ['opencode_permission_reply', 'control'],
];

const JOB_STATUS_KEY: Record<string, string> = {
  running: 'devboxPage.eventStatusRunning',
  pending: 'devboxPage.eventStatusRunning',
  started: 'devboxPage.eventStatusRunning',
  in_progress: 'devboxPage.eventStatusRunning',
  queued: 'devboxPage.agentJobQueued',
  completed: 'devboxPage.eventStatusDone',
  finished: 'devboxPage.eventStatusDone',
  done: 'devboxPage.eventStatusDone',
  succeeded: 'devboxPage.eventStatusDone',
  failed: 'devboxPage.eventStatusFailed',
  error: 'devboxPage.eventStatusFailed',
  cancelled: 'devboxPage.eventStatusCancelled',
  canceled: 'devboxPage.eventStatusCancelled',
  interrupted: 'devboxPage.eventStatusInterrupted',
  awaiting_permission: 'devboxPage.eventStatusAwaitingPermission',
};

const TONE_ICONS: Record<DevboxEventTone, typeof Activity> = {
  ok: CheckCircle2,
  failed: XCircle,
  running: Loader2,
  attention: AlertTriangle,
  other: Circle,
};

const TONE_CLASSES: Record<DevboxEventTone, string> = {
  ok: 'text-emerald-400',
  failed: 'text-red-400',
  running: 'text-indigo-300 animate-spin',
  attention: 'text-amber-300',
  other: 'text-slate-500',
};

type SessionStatus = 'online' | 'attention' | 'stale' | 'idle';

const SESSION_BADGE: Record<SessionStatus, 'success' | 'warning' | 'slate'> = {
  online: 'success',
  attention: 'warning',
  stale: 'warning',
  idle: 'slate',
};

const SESSION_LABEL_KEY: Record<SessionStatus, string> = {
  online: 'devboxPage.agentSessionStatusOnline',
  attention: 'devboxPage.agentSessionStatusAttention',
  stale: 'devboxPage.agentSessionStatusStale',
  idle: 'devboxPage.agentSessionStatusIdle',
};

const STATE_TONE: Record<VitalState, 'success' | 'warning' | 'danger' | 'muted'> = {
  healthy: 'success',
  degraded: 'warning',
  down: 'danger',
  unknown: 'muted',
  pending: 'muted',
  disabled: 'muted',
};

function startedSeconds(value: string | number): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const asNumber = Number(value);
    if (value.trim() !== '' && Number.isFinite(asNumber)) return asNumber;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed / 1000;
  }
  return null;
}

function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

function jobStatusLabel(status: string): string {
  const key = JOB_STATUS_KEY[status.toLowerCase()];
  return key ? t(key) : status;
}

export interface DevboxAgentProps {
  connect: UseDevboxConnectResult;
  profiles: DevboxProfileRow[] | null;
  overviewCards: DevboxVitalCard[] | null;
  gateway: DevboxOverviewGateway | null;
  actionStatus: DevboxActionStatus | null;
  jobs: DevboxObserved<DevboxJobRow> | null;
  permissions: DevboxObserved<DevboxPermissionRow> | null;
  events: DevboxEventRow[];
  busy: boolean;
  onAction: (action: Promise<DevboxAccepted>) => void;
  onOpenTab: (tab: DevboxTab) => void;
  onPermissionReply: (id: string, decision: 'once' | 'reject') => void;
  reloadTick?: number;
}

export function DevboxAgent({
  connect,
  profiles,
  overviewCards,
  gateway,
  actionStatus,
  jobs,
  permissions,
  events,
  busy,
  onAction,
  onOpenTab,
  onPermissionReply,
  reloadTick = 0,
}: DevboxAgentProps) {
  const [bannerDismissed, setBannerDismissed] = useState(
    () => localStorage.getItem(BANNER_KEY) === '1',
  );
  const [now, setNow] = useState(() => Date.now());

  const jobRows = useMemo(() => (jobs?.rows ?? []).slice(-JOBS_LIMIT).reverse(), [jobs]);
  const allJobRows = useMemo(() => jobs?.rows ?? [], [jobs]);
  const permissionRows = permissions?.rows ?? [];
  const activeJob = useMemo(
    () => allJobRows.find(row => row.status === 'running') ?? allJobRows[0] ?? null,
    [allJobRows],
  );
  const hasRunningJob = allJobRows.some(row => row.status === 'running');

  useEffect(() => {
    if (!hasRunningJob) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasRunningJob]);

  const recentEvents = useMemo(() => events.slice(-RECENT_LIMIT).reverse(), [events]);
  const runnerState = cardVitalState(findVitalCard(overviewCards, 'runner'), 'runner');
  const sessionStale = connect.handoffStale || connect.connectionStale;

  const sessionStatus: SessionStatus = permissionRows.length > 0
    ? 'attention'
    : sessionStale
      ? 'stale'
      : activeJob !== null || connect.bridgeState === 'healthy'
        ? 'online'
        : 'idle';

  const probeValue = connect.probe === null
    ? t('devboxPage.overviewProbeNone')
    : connect.probeStale
      ? t('devboxPage.overviewProbeStale')
      : t('devboxPage.overviewProbeFresh', { at: formatTime(connect.probe.checkedAt) });

  const sessionRows: KeyValueRow[] = [
    {
      id: 'mode',
      label: t('devboxPage.agentSessionMode'),
      value: connect.profileMode === '' ? '—' : devboxModeLabel(connect.profileMode),
    },
    {
      id: 'bridge',
      label: t('devboxPage.agentSessionBridge'),
      value: t(vitalStateLabelKey(connect.bridgeState)),
      tone: STATE_TONE[connect.bridgeState],
    },
    {
      id: 'runner',
      label: t('devboxPage.agentSessionRunner'),
      value: t(vitalStateLabelKey(runnerState)),
      tone: STATE_TONE[runnerState],
    },
    {
      id: 'latency',
      label: t('devboxPage.agentSessionLatency'),
      value:
        connect.latency === null
          ? '—'
          : t('devboxPage.overviewLatencyValue', { ms: connect.latency }),
    },
    {
      id: 'probe',
      label: t('devboxPage.agentSessionProbe'),
      value: probeValue,
      tone: connect.probe === null ? 'muted' : connect.probeStale ? 'warning' : 'success',
    },
  ];

  const dismissBanner = () => {
    localStorage.setItem(BANNER_KEY, '1');
    setBannerDismissed(true);
  };

  const elapsedFor = (row: DevboxJobRow): string | null => {
    const started = startedSeconds(row.startedAt);
    return started === null ? null : formatElapsed(now / 1000 - started);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="devbox-agent">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-3">
          <GlassCard className="p-4" data-testid="devbox-agent-session">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2" data-testid="devbox-agent-hero">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-white">
                    {connect.activeProfile === '' ? t('devboxPage.agentSessionTitle') : connect.activeProfile}
                  </h3>
                  <p className="truncate font-mono text-2xs text-slate-400">
                    {connect.resolvedUrl === '' ? t('devboxPage.overviewEndpointMissing') : connect.resolvedUrl}
                  </p>
                </div>
              </div>
              <Badge
                variant={SESSION_BADGE[sessionStatus]}
                withDot
                withPulse={sessionStatus === 'attention'}
                data-testid="devbox-agent-session-status"
              >
                {t(SESSION_LABEL_KEY[sessionStatus])}
              </Badge>
            </div>
            <p className="mb-2 text-2xs text-slate-400">{t('devboxPage.agentSessionCaption')}</p>
            <KeyValueList rows={sessionRows} density="compact" />
          </GlassCard>

          <DevboxSection
            title={t('devboxPage.agentToolsTitle')}
            caption={t('devboxPage.agentToolsCaption')}
            testId="devbox-agent-tools"
          >
            <div className="flex flex-col gap-2">
              <span
                className="text-2xs font-medium uppercase tracking-wider text-slate-400"
                data-testid="devbox-agent-tools-summary"
              >
                {t('devboxPage.agentToolsSummary')}
              </span>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(['native', 'control'] as const).map(group => (
                  <div key={group} className="flex flex-col gap-1.5">
                    <span className="text-2xs font-medium uppercase tracking-wider text-slate-500">
                      {group === 'native'
                        ? t('devboxPage.agentToolsNative')
                        : t('devboxPage.agentToolsControl')}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {TOOL_INVENTORY.filter(([, g]) => g === group).map(([name]) => (
                        <span
                          key={name}
                          className={cn(
                            'rounded border px-1.5 py-0.5 font-mono text-2xs',
                            group === 'native'
                              ? 'border-indigo-400/20 bg-indigo-500/[0.06] text-indigo-200'
                              : 'border-white/10 bg-white/[0.02] text-slate-300',
                          )}
                          data-testid={`devbox-agent-tool-${name}`}
                          title={name}
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </DevboxSection>

          <DevboxPrompt
            profiles={profiles}
            overviewCards={overviewCards}
            gateway={gateway}
            actionStatus={actionStatus}
            onAction={onAction}
            onOpenTab={onOpenTab}
            reloadTick={reloadTick}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          {!bannerDismissed && (
            <div
              className="flex shrink-0 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5"
              data-testid="devbox-security-banner"
            >
              <ShieldAlert size={13} className="shrink-0 text-amber-300" aria-hidden />
              <span className="flex-1 min-w-0 text-2xs text-slate-300">
                {t('devboxPage.securityBanner')}
              </span>
              <IconButton
                size="sm"
                variant="ghost"
                aria-label={t('common.close')}
                tooltip={t('common.close')}
                data-testid="devbox-security-banner-close"
                onClick={dismissBanner}
              >
                <X size={12} />
              </IconButton>
            </div>
          )}

          <DevboxSection
            title={t('devboxPage.agentPermissionsTitle')}
            testId="devbox-agent-permissions"
            actions={
              <Badge variant={permissionRows.length > 0 ? 'warning' : 'slate'} size="sm">
                {permissionRows.length}
              </Badge>
            }
            bodyClassName="flex flex-col gap-2"
          >
            {permissions?.bridge === 'down' && (
              <span className="text-2xs text-slate-400" data-testid="devbox-agent-permissions-degraded">
                {t('devboxPage.permissionsBridgeDown')}
              </span>
            )}
            {permissionRows.length === 0 ? (
              <EmptyState
                compact
                icon={ShieldCheck}
                title={t('devboxPage.agentPermissionsEmpty')}
              />
            ) : (
              permissionRows.map(row => (
                <div
                  key={row.id}
                  className="flex flex-col gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-2.5"
                  data-testid={`devbox-agent-permission-${row.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-amber-200">{row.tool}</span>
                    <span className="shrink-0 text-2xs text-slate-400">
                      {devboxTime(row.startedAt)}
                    </span>
                  </div>
                  <p className="text-2xs text-slate-300 break-words" title={row.summary}>
                    {row.summary}
                  </p>
                  {row.source ? (
                    <span className="text-2xs text-slate-500">{row.source}</span>
                  ) : null}
                  <div className="mt-0.5 flex items-center gap-2">
                    <Tooltip content={t('devboxPage.tipApproveOnce')}>
                      <Button
                        size="xs"
                        variant="primary"
                        disabled={busy || permissions?.bridge === 'down'}
                        data-testid={`devbox-permission-approve-${row.id}`}
                        onClick={() => onPermissionReply(row.id, 'once')}
                      >
                        {t('devboxPage.permissionApprove')}
                      </Button>
                    </Tooltip>
                    <ConfirmActionButton
                      size="xs"
                      variant="danger"
                      disabled={busy || permissions?.bridge === 'down'}
                      data-testid={`devbox-permission-reject-${row.id}`}
                      tooltip={t('devboxPage.tipReject')}
                      onConfirm={() => onPermissionReply(row.id, 'reject')}
                    >
                      {t('devboxPage.reject')}
                    </ConfirmActionButton>
                  </div>
                </div>
              ))
            )}
          </DevboxSection>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <DevboxSection
          title={t('devboxPage.agentJobsTitle')}
          testId="devbox-agent-jobs"
          bodyClassName="flex flex-col gap-2"
        >
          {jobs?.bridge === 'down' && (
            <span className="text-2xs text-slate-400" data-testid="devbox-agent-jobs-degraded">
              {t('devboxPage.jobsBridgeDown')}
            </span>
          )}
          {jobRows.length === 0 ? (
            <EmptyState compact icon={Briefcase} title={t('devboxPage.agentJobsEmpty')} />
          ) : (
            jobRows.map(row => {
              const elapsed = row.status === 'running' ? elapsedFor(row) : null;
              return (
                <div
                  key={row.id}
                  className={cn(
                    'flex flex-col gap-1.5 rounded-lg border border-white/10 bg-white/[0.02] p-2.5',
                    row.id === activeJob?.id && 'border-indigo-500/25 bg-indigo-500/[0.06]',
                  )}
                  data-testid={`devbox-agent-job-${row.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-slate-200">{row.tool}</span>
                    <span className="shrink-0 text-2xs text-slate-400">
                      {devboxTime(row.startedAt)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-2xs text-slate-400">
                      <Badge
                        size="sm"
                        variant={
                          row.status === 'running'
                            ? 'info'
                            : row.status === 'failed' || row.status === 'error'
                              ? 'danger'
                              : row.status === 'awaiting_permission'
                                ? 'warning'
                                : 'slate'
                        }
                        data-testid={`devbox-agent-job-status-${row.id}`}
                      >
                        {jobStatusLabel(row.status)}
                      </Badge>
                      {elapsed !== null && (
                        <span data-testid={`devbox-agent-job-elapsed-${row.id}`}>
                          {t('devboxPage.railElapsed', { elapsed })}
                        </span>
                      )}
                      {row.sessionId ? <span className="truncate">{row.sessionId}</span> : null}
                    </span>
                    {row.status === 'running' && (
                      <ConfirmActionButton
                        size="xs"
                        variant="danger"
                        disabled={busy}
                        data-testid={`devbox-job-cancel-${row.id}`}
                        tooltip={t('devboxPage.tipCancelJob')}
                        onConfirm={() => onAction(devboxJobCancel(row.id))}
                      >
                        {t('devboxPage.cancelJob')}
                      </ConfirmActionButton>
                    )}
                  </div>
                  {row.status === 'running' && (
                    <div className="h-0.5 w-full overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full w-1/3 animate-pulse rounded-full bg-indigo-400/70"
                        data-testid={`devbox-agent-job-progress-${row.id}`}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </DevboxSection>

        <DevboxSection
          title={t('devboxPage.agentRecentTitle')}
          testId="devbox-agent-recent"
          bodyClassName="flex flex-col gap-1"
        >
          {recentEvents.length === 0 ? (
            <EmptyState compact icon={Activity} title={t('devboxPage.agentRecentEmpty')} />
          ) : (
            recentEvents.map((row, index) => {
              const tone = devboxEventTone(row);
              const Icon = TONE_ICONS[tone];
              return (
                <div
                  key={`${String(row.ts ?? index)}-${index}`}
                  className="relative flex items-center gap-2 py-1 text-2xs text-slate-400 after:absolute after:left-[5px] after:top-[10px] after:h-full after:w-px after:bg-white/10 last:after:hidden"
                  data-testid="devbox-agent-event-card"
                  title={devboxEventText(row)}
                >
                  <Icon
                    size={12}
                    className={cn('relative z-10 shrink-0 bg-void-base', TONE_CLASSES[tone])}
                    data-testid="devbox-agent-event-icon"
                    data-tone={tone}
                    aria-hidden
                  />
                  <span className="shrink-0 tabular-nums text-slate-500">
                    {devboxTime(row.ts)}
                  </span>
                  <span className="truncate">{devboxEventText(row)}</span>
                </div>
              );
            })
          )}
        </DevboxSection>
      </div>
    </div>
  );
}
