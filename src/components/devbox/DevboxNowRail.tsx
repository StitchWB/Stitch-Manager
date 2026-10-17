import { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  CheckCircle2,
  Circle,
  Loader2,
  ShieldAlert,
  X,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Tooltip } from '@/components/ui/Tooltip';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  devboxJobCancel,
  devboxPermissionReply,
  devboxTime,
  type DevboxAccepted,
  type DevboxEventRow,
  type DevboxJobRow,
  type DevboxObserved,
  type DevboxPermissionRow,
} from '@/lib/backend/modules/devbox';
import { DevboxSection } from './DevboxSection';
import { devboxEventLine, devboxEventText, devboxEventTone } from './eventLine';

const TONE_ICONS = {
  ok: CheckCircle2,
  failed: XCircle,
  running: Loader2,
  other: Circle,
} as const;

const TONE_CLASSES = {
  ok: 'text-emerald-400',
  failed: 'text-red-400',
  running: 'text-indigo-300 animate-spin',
  other: 'text-slate-500',
} as const;

const BANNER_KEY = 'devbox.securityBannerDismissed';
const RECENT_LIMIT = 5;

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

export interface DevboxNowRailProps {
  jobs: DevboxObserved<DevboxJobRow> | null;
  permissions: DevboxObserved<DevboxPermissionRow> | null;
  events: DevboxEventRow[];
  busy: boolean;
  onAction: (action: Promise<DevboxAccepted>) => void;
  onGoInfra: () => void;
}

export function DevboxNowRail({
  jobs,
  permissions,
  events,
  busy,
  onAction,
  onGoInfra,
}: DevboxNowRailProps) {
  const [bannerDismissed, setBannerDismissed] = useState(
    () => localStorage.getItem(BANNER_KEY) === '1',
  );

  const activeJob = useMemo(() => {
    const rows = jobs?.rows ?? [];
    return rows.find(row => row.status === 'running') ?? rows[0] ?? null;
  }, [jobs]);
  const activeJobId = activeJob?.id ?? null;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (activeJobId === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeJobId]);

  const elapsed = useMemo(() => {
    if (!activeJob) return null;
    const started = startedSeconds(activeJob.startedAt);
    return started === null ? null : formatElapsed(now / 1000 - started);
  }, [activeJob, now]);

  const permissionRows = permissions?.rows ?? [];
  const recentEvents = useMemo(() => events.slice(-RECENT_LIMIT), [events]);

  const bridgeDown = jobs?.bridge === 'down' || permissions?.bridge === 'down';
  const toolCallCount = useMemo(
    () =>
      events.filter(row => typeof row.tool === 'string' && row.tool !== '' && row.tool !== '—')
        .length,
    [events],
  );
  const onboarding = !activeJob && permissionRows.length === 0 && events.length === 0;

  const dismissBanner = () => {
    localStorage.setItem(BANNER_KEY, '1');
    setBannerDismissed(true);
  };

  return (
    <DevboxSection
      title={t('devboxPage.railTitle')}
      testId="devbox-rail"
      className="flex min-h-full flex-col"
      bodyClassName="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <span className="shrink-0 text-2xs text-slate-400" data-testid="devbox-rail-bridge-summary">
          {t('devboxPage.railBridgeSummary', {
            state: bridgeDown ? t('devboxPage.railBridgeDown') : t('devboxPage.railBridgeUp'),
            count: toolCallCount,
          })}
        </span>

        {!bannerDismissed && (
          <div
            className="flex shrink-0 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5"
            data-testid="devbox-security-banner"
          >
            <ShieldAlert size={13} className="shrink-0 text-amber-300" aria-hidden />
            <span className="flex-1 truncate text-2xs text-slate-300">
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

        {activeJob ? (
          <div
            className="flex flex-col gap-1.5 rounded-lg border border-indigo-500/25 bg-indigo-500/[0.06] p-2.5"
            data-testid="devbox-rail-active-job"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-indigo-200">
                {activeJob.tool}
              </span>
              <span className="shrink-0 text-2xs text-slate-400">
                {devboxTime(activeJob.startedAt)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-2xs text-slate-400" data-testid="devbox-rail-elapsed">
                {elapsed === null ? '' : t('devboxPage.railElapsed', { elapsed })}
              </span>
              <ConfirmActionButton
                size="xs"
                variant="danger"
                disabled={busy}
                data-testid={`devbox-job-cancel-${activeJob.id}`}
                tooltip={t('devboxPage.tipCancelJob')}
                onConfirm={() => onAction(devboxJobCancel(activeJob.id))}
              >
                {t('devboxPage.cancelJob')}
              </ConfirmActionButton>
            </div>
            <div className="h-0.5 w-full overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full w-1/3 animate-pulse rounded-full bg-indigo-400/70"
                data-testid="devbox-rail-progress"
              />
            </div>
          </div>
        ) : onboarding ? (
          <div className="flex flex-col gap-2.5" data-testid="devbox-rail-onboarding">
            {[
              t('devboxPage.railOnboard1'),
              t('devboxPage.railOnboard2'),
              t('devboxPage.railOnboard3'),
              t('devboxPage.railOnboard4'),
            ].map((line, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-indigo-400/40 bg-indigo-500/10 text-2xs font-semibold text-indigo-200">
                  {i + 1}
                </span>
                <span className="text-2xs leading-5 text-slate-300">{line}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            compact
            icon={Briefcase}
            title={t('devboxPage.railIdle')}
            description={t('devboxPage.railIdleDesc')}
          />
        )}

        {jobs?.bridge === 'down' && (
          <span className="text-2xs text-slate-400" data-testid="devbox-rail-jobs-degraded">
            {t('devboxPage.jobsBridgeDown')}
          </span>
        )}
        {permissions?.bridge === 'down' && (
          <span className="text-2xs text-slate-400" data-testid="devbox-rail-permissions-degraded">
            {t('devboxPage.permissionsBridgeDown')}
          </span>
        )}

        {permissionRows.map(row => (
          <div
            key={row.id}
            className="flex flex-col gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] p-2.5"
            data-testid={`devbox-rail-permission-${row.id}`}
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
            <div className="mt-0.5 flex items-center gap-2">
              <Tooltip content={t('devboxPage.tipApproveOnce')}>
                <Button
                  size="xs"
                  variant="primary"
                  disabled={busy}
                  data-testid={`devbox-permission-approve-${row.id}`}
                  onClick={() => onAction(devboxPermissionReply(row.id, 'once'))}
                >
                  {t('devboxPage.permissionApprove')}
                </Button>
              </Tooltip>
              <ConfirmActionButton
                size="xs"
                variant="danger"
                disabled={busy}
                data-testid={`devbox-permission-reject-${row.id}`}
                tooltip={t('devboxPage.tipReject')}
                onConfirm={() => onAction(devboxPermissionReply(row.id, 'reject'))}
              >
                {t('devboxPage.reject')}
              </ConfirmActionButton>
            </div>
          </div>
        ))}

        <div className="flex min-h-0 flex-1 flex-col gap-1">
          <span className="shrink-0 text-2xs uppercase tracking-wider text-slate-400">
            {t('devboxPage.railRecent')}
          </span>
          <div
            className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
            data-testid="devbox-rail-recent"
          >
            {recentEvents.length === 0 ? (
              <span className="text-2xs text-slate-500">{t('devboxPage.eventsEmpty')}</span>
            ) : (
              recentEvents.map((row, i) => {
                const tone = devboxEventTone(row);
                const Icon = TONE_ICONS[tone];
                return (
                  <div
                    key={i}
                    data-testid="devbox-rail-event-card"
                    className="flex shrink-0 items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-2xs text-slate-400"
                    title={devboxEventLine(row)}
                  >
                    <Icon
                      size={12}
                      className={cn('shrink-0', TONE_CLASSES[tone])}
                      data-testid="devbox-rail-event-icon"
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
          </div>
          <Button
            size="xs"
            variant="ghost"
            className="self-start shrink-0"
            data-testid="devbox-rail-go-infra"
            onClick={onGoInfra}
          >
            {t('devboxPage.railGoInfra')}
          </Button>
        </div>
      </div>
    </DevboxSection>
  );
}
