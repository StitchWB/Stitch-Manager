import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Terminal } from 'lucide-react';
import Header from '@/components/layout/Header';
import { IconButton } from '@/components/ui/IconButton';
import { t } from '@/lib/i18n';
import { useAppStore } from '@/stores/app';
import {
  devboxNormalizeCards,
  devboxNormalizeEventRows,
  devboxObservedRows,
  devboxPoll,
  devboxProfilesList,
  type DevboxAccepted,
  type DevboxJobRow,
  type DevboxPermissionRow,
  type DevboxProfileRow,
} from '@/lib/backend/modules/devbox';
import { useDevboxPoll } from './useDevboxPoll';
import { runDevboxAction } from './runAction';
import { DEVBOX_REFRESH_MS } from './constants';
import { DevboxVitals } from './DevboxVitals';
import { DevboxControls } from './DevboxControls';
import { DevboxPrompt } from './DevboxPrompt';
import { DevboxProfiles } from './DevboxProfiles';
import { DevboxJobs } from './DevboxJobs';
import { DevboxPermissions } from './DevboxPermissions';
import { DevboxEvents } from './DevboxEvents';
import { DevboxLogs } from './DevboxLogs';
import { DevboxActions } from './DevboxActions';

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

  return (
    <div className="flex flex-col h-full overflow-hidden bg-void-base">
      <Header
        title={t('devboxPage.title')}
        subtitle={t('devboxPage.subtitle')}
        icon={<Terminal size={18} />}
        actions={
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
        }
      />
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex w-full flex-col gap-4">
          <DevboxProfiles
            profiles={profiles}
            overviewCards={cards}
            error={profilesError}
            busy={busy}
            onAction={onAction}
            onRetry={reloadProfiles}
            onChanged={reloadProfiles}
          />
          <DevboxPrompt
            profiles={profiles}
            overviewCards={cards}
            actionStatus={status}
            onAction={onAction}
            reloadTick={promptTick}
          />
          <DevboxVitals cards={cards} error={poll.error} onRetry={reloadPoll} />
          <div className="grid gap-4 lg:grid-cols-2">
            <DevboxJobs data={jobs} error={poll.error} onRetry={reloadPoll} />
            <DevboxPermissions data={permissions} error={poll.error} onRetry={reloadPoll} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <DevboxEvents rows={events} error={poll.error} onRetry={reloadPoll} />
            <DevboxLogs />
          </div>
          <DevboxActions recent={status?.recent ?? null} />
          <DevboxControls
            overviewCards={cards}
            actionStatus={status}
            busy={busy}
            onAction={onAction}
          />
        </div>
      </div>
    </div>
  );
}
