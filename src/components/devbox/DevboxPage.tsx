import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, Plus, RefreshCw, ShieldAlert, Terminal } from 'lucide-react';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { IconButton } from '@/components/ui/IconButton';
import { Modal } from '@/components/ui/Modal';
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
import { devboxModeLabel } from './labels';
import { DevboxPrompt } from './DevboxPrompt';
import { DevboxProfiles } from './DevboxProfiles';
import { DevboxProjectStrip } from './DevboxProjectStrip';
import { DevboxNowRail } from './DevboxNowRail';
import { DevboxServiceCards } from './DevboxServiceCards';
import { DevboxConsole } from './DevboxConsole';

type PageTab = 'task' | 'infra';
type StackState = 'ok' | 'warn' | 'down' | 'unknown';

const STACK_CHIP: Record<StackState, { dot: string; key: string }> = {
  ok: { dot: 'bg-emerald-400', key: 'devboxPage.stackOk' },
  warn: { dot: 'bg-amber-400', key: 'devboxPage.stackDegraded' },
  down: { dot: 'bg-red-400', key: 'devboxPage.stackStopped' },
  unknown: { dot: 'bg-slate-500', key: 'devboxPage.stackUnknown' },
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
  const [projectsOpen, setProjectsOpen] = useState(false);
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

  const activeProfileRow = useMemo(
    () => (Array.isArray(profiles) ? profiles.find(row => row.active) ?? null : null),
    [profiles],
  );
  const activeProfile = activeProfileRow?.name ?? '';

  const composite = stackState(cards);
  const ingressUp = devboxVitalValue(cards, 'ingress') === 'up';
  const current = status?.current;
  const busyAction = busy && current ? current : null;
  const chip = busyAction
    ? { dot: 'bg-slate-500', key: 'devboxPage.stackBusy' }
    : STACK_CHIP[composite];
  const busyLabel = busyAction
    ? busyAction.cmd === 'stack_start'
      ? t('devboxPage.busyStarting')
      : busyAction.cmd === 'stack_down' || busyAction.cmd === 'stack_full_down'
        ? t('devboxPage.busyStopping')
        : t('devboxPage.busyRunning')
    : null;

  const profileOptions = (Array.isArray(profiles) ? profiles : []).map(row => ({
    value: row.name,
    label: `${row.name} (${devboxModeLabel(row.mode)})`,
  }));

  const onProfileSelect = useCallback(
    (value: string) => {
      if (value === activeProfile) {
        setSelectedProfile(null);
        return;
      }
      setSelectedProfile(value);
      void askConfirm({
        title: t('devboxPage.switchProfileConfirmTitle', { name: value }),
        message: t('devboxPage.switchProfileConfirmMessage'),
        confirmText: t('common.confirm'),
        cancelText: t('common.cancel'),
        variant: 'warning',
      }).then(confirmed => {
        setSelectedProfile(null);
        if (confirmed) onAction(devboxProfileUse(value));
      });
    },
    [activeProfile, onAction],
  );

  const openProjects = useCallback(() => {
    setAddSignal(0);
    setProjectsOpen(true);
  }, []);

  const projectOptions = [
    ...profileOptions,
    { value: '__add', label: t('devboxPage.projectAddOption') },
    { value: '__manage', label: t('devboxPage.projectManageOption') },
  ];

  const onProjectSelect = useCallback(
    (value: string) => {
      if (value === '__add') {
        setTab('infra');
        setProjectsOpen(true);
        setAddSignal(x => x + 1);
        return;
      }
      if (value === '__manage') {
        openProjects();
        return;
      }
      onProfileSelect(value);
    },
    [onProfileSelect, openProjects],
  );

  const controlBar = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Select
        aria-label={t('devboxPage.headerProjectLabel')}
        containerClassName="w-44"
        options={projectOptions}
        value={selectedProfile ?? activeProfile}
        data-testid="devbox-profile-select"
        onValueChange={onProjectSelect}
      />
      <IconButton
        size="md"
        variant="ghost"
        aria-label={t('devboxPage.editorCreateTitle')}
        tooltip={t('devboxPage.editorCreateTitle')}
        data-testid="devbox-new-project"
        onClick={() => {
          setTab('infra');
          setProjectsOpen(true);
          setAddSignal(x => x + 1);
        }}
      >
        <Plus size={16} />
      </IconButton>
      <span
        className="flex items-center gap-1.5 whitespace-nowrap text-2xs text-slate-400"
        data-testid="devbox-stack-badge"
      >
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', chip.dot)} aria-hidden />
        {t(chip.key)}
      </span>
      <div className="flex flex-col items-stretch">
        <Tooltip
          content={composite === 'ok' ? t('devboxPage.tipRestart') : t('devboxPage.tipStart')}
        >
          <Button
            size="sm"
            variant="primary"
            disabled={busy || activeProfile === ''}
            leftIcon={
              busyAction ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )
            }
            data-testid="devbox-stack-start"
            onClick={() => onAction(devboxStackStart(activeProfile, false))}
          >
            {busyLabel ??
              (composite === 'ok'
                ? t('devboxPage.restart')
                : t('devboxPage.promptChipStackStart'))}
          </Button>
        </Tooltip>
        {busyAction && (
          <span
            className="max-w-[16rem] truncate text-2xs text-slate-400"
            data-testid="devbox-progress"
          >
            {t('devboxPage.progress', {
              cmd: busyAction.cmd,
              time: devboxTime(busyAction.startedAt),
            })}
          </span>
        )}
      </div>
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
      <Header title={t('devboxPage.title')} icon={<Terminal size={18} />} actions={controlBar} />
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
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div
          className={cn(
            'grid gap-4 lg:h-full lg:grid-cols-5 lg:grid-rows-1',
            tab !== 'task' && 'hidden',
          )}
          data-testid="devbox-panel-task"
        >
          <div className="flex min-w-0 flex-col lg:col-span-3 lg:min-h-0">
            <DevboxPrompt
              profiles={profiles}
              overviewCards={cards}
              actionStatus={status}
              onAction={onAction}
              reloadTick={promptTick}
            />
          </div>
          <div className="flex min-w-0 flex-col lg:col-span-2 lg:min-h-0">
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
          className={cn('flex w-full flex-col gap-4 lg:h-full', tab !== 'infra' && 'hidden')}
          data-testid="devbox-panel-infra"
        >
          <DevboxServiceCards
            cards={cards}
            activeProfile={activeProfile}
            busy={busy}
            onAction={onAction}
          />
          <DevboxProjectStrip
            activeProfile={activeProfileRow}
            busy={busy}
            onAction={onAction}
            onOpenProjects={openProjects}
          />
          <DevboxConsole
            className="min-h-[50vh] lg:flex-1"
            events={events}
            recent={status?.recent ?? null}
            error={poll.error}
            onRetry={reloadPoll}
          />
        </div>
      </div>
      <Modal
        isOpen={projectsOpen}
        onClose={() => setProjectsOpen(false)}
        title={t('devboxPage.sectionProfiles')}
        size="lg"
      >
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
      </Modal>
    </div>
  );
}
