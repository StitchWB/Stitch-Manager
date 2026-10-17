import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, Plus, RefreshCw, ShieldAlert, Terminal } from 'lucide-react';
import Header from '@/components/layout/Header';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { IconButton } from '@/components/ui/IconButton';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Select } from '@/components/ui/Select';
import { TabButton } from '@/components/ui/TabButton';
import { Tooltip } from '@/components/ui/Tooltip';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app';
import {
  devboxCockpitOpen,
  devboxIngressControl,
  devboxIssueTokens,
  devboxNormalizeCards,
  devboxNormalizeEventRows,
  devboxObservedRows,
  devboxPoll,
  devboxProfilesList,
  devboxProfileUse,
  devboxRunDoctor,
  devboxStackDown,
  devboxStackFullDown,
  devboxStackStart,
  devboxTime,
  devboxVitalValue,
  type DevboxAccepted,
  type DevboxJobRow,
  type DevboxPermissionRow,
  type DevboxProfileRow,
  type DevboxVitalCard,
} from '@/lib/backend/modules/devbox';
import { useDevboxPoll } from './useDevboxPoll';
import { runDevboxAction } from './runAction';
import { DEVBOX_REFRESH_MS } from './constants';
import { DevboxPrompt } from './DevboxPrompt';
import { DevboxProfiles } from './DevboxProfiles';
import { DevboxNowRail } from './DevboxNowRail';
import { DevboxServiceCards } from './DevboxServiceCards';
import { DevboxConsole } from './DevboxConsole';

type PageTab = 'task' | 'infra';
type StackState = 'ok' | 'warn' | 'down' | 'unknown';

const STACK_BADGE: Record<
  StackState,
  { variant: 'success' | 'warning' | 'danger' | 'default'; key: string }
> = {
  ok: { variant: 'success', key: 'devboxPage.stackOk' },
  warn: { variant: 'warning', key: 'devboxPage.stackDegraded' },
  down: { variant: 'danger', key: 'devboxPage.stackStopped' },
  unknown: { variant: 'default', key: 'devboxPage.stackUnknown' },
};

function stackState(cards: DevboxVitalCard[] | null): StackState {
  if (!Array.isArray(cards) || cards.length === 0) return 'unknown';
  const values = ['ingress', 'bridge', 'runner'].map(id => devboxVitalValue(cards, id));
  if (values.every(value => value === null)) return 'unknown';
  const up = values.filter(value => value === 'up').length;
  if (up === values.length) return 'ok';
  if (up === 0) return 'down';
  return 'warn';
}

function modeLabel(mode: string): string {
  if (mode === 'readonly') return t('devboxPage.modeReadonlyTitle');
  if (mode === 'standard') return t('devboxPage.modeStandardTitle');
  if (mode === 'full') return t('devboxPage.modeFullTitle');
  return mode;
}

export function DevboxPage() {
  const language = useAppStore(s => s.language);
  void language;

  const poll = useDevboxPoll(devboxPoll, DEVBOX_REFRESH_MS);
  const { reload: reloadPoll } = poll;

  const [profiles, setProfiles] = useState<DevboxProfileRow[] | null>(null);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [profilesTick, setProfilesTick] = useState(0);
  const reloadProfiles = useCallback(() => setProfilesTick(x => x + 1), []);

  useEffect(() => {
    let cancelled = false;
    devboxProfilesList()
      .then(rows => {
        if (cancelled) return;
        setProfiles(Array.isArray(rows) ? rows : []);
        setProfilesError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setProfilesError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [profilesTick]);

  const [pending, setPending] = useState(false);
  const [promptTick, setPromptTick] = useState(0);
  const onAction = useCallback(
    (action: Promise<DevboxAccepted>) => {
      setPending(true);
      void runDevboxAction(action, () => {
        reloadProfiles();
        reloadPoll();
        setPromptTick(x => x + 1);
      }).finally(() => setPending(false));
    },
    [reloadProfiles, reloadPoll],
  );

  const cards = useMemo(() => devboxNormalizeCards(poll.data?.overview), [poll.data]);
  const status = poll.data?.action_status ?? null;
  const jobs = useMemo(
    () => devboxObservedRows<DevboxJobRow>(poll.data?.jobs),
    [poll.data],
  );
  const permissions = useMemo(
    () => devboxObservedRows<DevboxPermissionRow>(poll.data?.permissions),
    [poll.data],
  );
  const events = useMemo(() => devboxNormalizeEventRows(poll.data?.events), [poll.data]);
  const busy = status?.busy === true || pending;

  const refreshAll = () => {
    reloadPoll();
    reloadProfiles();
  };

  const [tab, setTab] = useState<PageTab>('task');
  const [addSignal, setAddSignal] = useState(0);
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null);
  const [dangerOpen, setDangerOpen] = useState(false);
  const dangerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!dangerOpen) return;
    const onDown = (event: MouseEvent) => {
      if (!dangerRef.current?.contains(event.target as Node)) setDangerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [dangerOpen]);

  const activeProfile = useMemo(
    () => (Array.isArray(profiles) ? profiles.find(row => row.active)?.name ?? '' : ''),
    [profiles],
  );

  const composite = stackState(cards);
  const badge = STACK_BADGE[composite];
  const ingressUp = devboxVitalValue(cards, 'ingress') === 'up';
  const current = status?.current;

  const profileOptions = (Array.isArray(profiles) ? profiles : []).map(row => ({
    value: row.name,
    label: `${row.name} (${modeLabel(row.mode)})`,
  }));

  const controlBar = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {busy && current && (
        <span
          className="flex items-center gap-1.5 text-2xs text-slate-400"
          data-testid="devbox-progress"
        >
          <LoadingSpinner size="xs" />
          <span className="max-w-[16rem] truncate">
            {t('devboxPage.progress', { cmd: current.cmd, time: devboxTime(current.startedAt) })}
          </span>
        </span>
      )}
      <Select
        aria-label={t('devboxPage.headerProjectLabel')}
        containerClassName="w-44"
        options={profileOptions}
        value={selectedProfile ?? activeProfile}
        data-testid="devbox-profile-select"
        onValueChange={value => setSelectedProfile(value)}
      />
      <ConfirmActionButton
        size="sm"
        variant="secondary"
        disabled={busy || selectedProfile === null || selectedProfile === activeProfile}
        data-testid="devbox-profile-switch"
        tooltip={t('devboxPage.tipSwitchProfile')}
        onConfirm={() => {
          if (selectedProfile === null) return;
          onAction(devboxProfileUse(selectedProfile));
        }}
      >
        {t('devboxPage.switchProfile')}
      </ConfirmActionButton>
      <IconButton
        size="md"
        variant="ghost"
        aria-label={t('devboxPage.editorCreateTitle')}
        tooltip={t('devboxPage.editorCreateTitle')}
        data-testid="devbox-new-project"
        onClick={() => {
          setTab('infra');
          setAddSignal(x => x + 1);
        }}
      >
        <Plus size={16} />
      </IconButton>
      <Badge variant={badge.variant} size="sm" withDot data-testid="devbox-stack-badge">
        {t(badge.key)}
      </Badge>
      <Tooltip
        content={composite === 'ok' ? t('devboxPage.tipRestart') : t('devboxPage.tipStart')}
      >
        <Button
          size="sm"
          variant="primary"
          disabled={busy || activeProfile === ''}
          leftIcon={<Play size={14} />}
          data-testid="devbox-stack-start"
          onClick={() => onAction(devboxStackStart(activeProfile, false))}
        >
          {composite === 'ok' ? t('devboxPage.restart') : t('devboxPage.promptChipStackStart')}
        </Button>
      </Tooltip>
      <Tooltip content={t('devboxPage.tipDoctor')}>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          data-testid="devbox-control-doctor"
          onClick={() => onAction(devboxRunDoctor())}
        >
          {t('devboxPage.controlDoctor')}
        </Button>
      </Tooltip>
      <Tooltip content={t('devboxPage.tipCockpit')}>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          data-testid="devbox-control-cockpit"
          onClick={() => onAction(devboxCockpitOpen())}
        >
          {t('devboxPage.controlCockpit')}
        </Button>
      </Tooltip>
      <div className="relative" ref={dangerRef}>
        <IconButton
          size="md"
          variant="ghost"
          aria-label={t('devboxPage.dangerZone')}
          tooltip={t('devboxPage.dangerZone')}
          aria-expanded={dangerOpen}
          data-testid="devbox-danger-toggle"
          onClick={() => setDangerOpen(v => !v)}
        >
          <ShieldAlert size={16} />
        </IconButton>
        {dangerOpen && (
          <div
            role="group"
            aria-label={t('devboxPage.dangerZone')}
            data-testid="devbox-danger-menu"
            className="absolute right-0 top-full z-50 mt-1 flex w-64 flex-col gap-2 rounded-lg border border-white/10 bg-vsc-panel/95 p-3 shadow-2xl backdrop-blur-xl"
          >
            <ConfirmActionButton
              size="sm"
              variant="secondary"
              disabled={busy}
              data-testid="devbox-control-stop-services"
              tooltip={t('devboxPage.tipStopServices')}
              onConfirm={() => onAction(devboxStackDown())}
            >
              {t('devboxPage.controlStopServices')}
            </ConfirmActionButton>
            <ConfirmActionButton
              size="sm"
              variant="danger"
              disabled={busy}
              data-testid="devbox-control-stop-all"
              tooltip={t('devboxPage.tipStopAll')}
              onConfirm={() => onAction(devboxStackFullDown())}
            >
              {t('devboxPage.controlStopAll')}
            </ConfirmActionButton>
            <ConfirmActionButton
              size="sm"
              variant="secondary"
              disabled={busy}
              data-testid="devbox-control-tokens"
              tooltip={t('devboxPage.tipRotateTokens')}
              onConfirm={() => onAction(devboxIssueTokens())}
            >
              {t('devboxPage.controlTokens')}
            </ConfirmActionButton>
            <ConfirmActionButton
              size="sm"
              variant="secondary"
              disabled={busy || cards === null}
              data-testid="devbox-control-ingress"
              tooltip={t('devboxPage.tipIngress')}
              onConfirm={() => onAction(devboxIngressControl(ingressUp ? 'down' : 'up'))}
            >
              {ingressUp ? t('devboxPage.controlIngressOn') : t('devboxPage.controlIngressOff')}
            </ConfirmActionButton>
          </div>
        )}
      </div>
      <IconButton
        onClick={refreshAll}
        size="md"
        variant="ghost"
        aria-label={t('devboxPage.refresh')}
        tooltip={t('devboxPage.refresh')}
        data-testid="devbox-refresh"
      >
        <RefreshCw size={16} />
      </IconButton>
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-void-base">
      <Header
        title={t('devboxPage.title')}
        subtitle={t('devboxPage.subtitle')}
        icon={<Terminal size={18} />}
        actions={controlBar}
      />
      <div
        className="flex items-center gap-1 border-b border-white/[0.06] px-4 pt-1.5"
        data-testid="devbox-tabs"
      >
        <TabButton
          size="sm"
          appearance="workspace"
          active={tab === 'task'}
          label={t('devboxPage.tabTask')}
          data-testid="devbox-tab-task"
          onClick={() => setTab('task')}
        />
        <TabButton
          size="sm"
          appearance="workspace"
          active={tab === 'infra'}
          label={t('devboxPage.tabInfra')}
          data-testid="devbox-tab-infra"
          onClick={() => setTab('infra')}
        />
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div
          className={cn('grid gap-4 lg:grid-cols-5', tab !== 'task' && 'hidden')}
          data-testid="devbox-panel-task"
        >
          <div className="min-w-0 lg:col-span-3">
            <DevboxPrompt
              profiles={profiles}
              overviewCards={cards}
              actionStatus={status}
              onAction={onAction}
              reloadTick={promptTick}
            />
          </div>
          <div className="min-w-0 lg:col-span-2">
            <DevboxNowRail
              jobs={jobs}
              permissions={permissions}
              events={events}
              busy={busy}
              onAction={onAction}
              onGoInfra={() => setTab('infra')}
            />
          </div>
        </div>
        <div
          className={cn('flex w-full flex-col gap-4', tab !== 'infra' && 'hidden')}
          data-testid="devbox-panel-infra"
        >
          <DevboxServiceCards
            cards={cards}
            activeProfile={activeProfile}
            busy={busy}
            onAction={onAction}
          />
          <DevboxProfiles
            profiles={profiles}
            overviewCards={cards}
            error={profilesError}
            busy={busy}
            onAction={onAction}
            onRetry={reloadProfiles}
            onChanged={reloadProfiles}
            addSignal={addSignal}
          />
          <DevboxConsole
            events={events}
            recent={status?.recent ?? null}
            error={poll.error}
            onRetry={reloadPoll}
          />
        </div>
      </div>
    </div>
  );
}
