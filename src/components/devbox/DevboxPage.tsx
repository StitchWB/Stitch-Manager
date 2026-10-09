import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Terminal } from 'lucide-react';
import Header from '@/components/layout/Header';
import { IconButton } from '@/components/ui/IconButton';
import { t } from '@/lib/i18n';
import { useAppStore } from '@/stores/app';
import {
  devboxActionStatus,
  devboxNormalizeCards,
  devboxOverview,
  devboxProfilesList,
  type DevboxAccepted,
  type DevboxProfileRow,
} from '@/lib/backend/modules/devbox';
import { useDevboxPoll } from './useDevboxPoll';
import { runDevboxAction } from './runAction';
import { DEVBOX_REFRESH_MS } from './constants';
import { DevboxVitals } from './DevboxVitals';
import { DevboxControls } from './DevboxControls';
import { DevboxProfiles } from './DevboxProfiles';
import { DevboxJobs } from './DevboxJobs';
import { DevboxPermissions } from './DevboxPermissions';
import { DevboxEvents } from './DevboxEvents';
import { DevboxLogs } from './DevboxLogs';
import { DevboxActions } from './DevboxActions';

export function DevboxPage() {
  const language = useAppStore(s => s.language);
  void language;

  const overviewFetcher = useCallback(() => devboxOverview(), []);
  const overview = useDevboxPoll(overviewFetcher, DEVBOX_REFRESH_MS);
  const statusFetcher = useCallback(() => devboxActionStatus(), []);
  const status = useDevboxPoll(statusFetcher, DEVBOX_REFRESH_MS);
  const { reload: reloadOverview } = overview;
  const { reload: reloadStatus } = status;

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
  const onAction = useCallback(
    (action: Promise<DevboxAccepted>) => {
      setPending(true);
      void runDevboxAction(action, () => {
        reloadProfiles();
        reloadOverview();
        reloadStatus();
      }).finally(() => setPending(false));
    },
    [reloadProfiles, reloadOverview, reloadStatus],
  );

  const cards = useMemo(() => devboxNormalizeCards(overview.data), [overview.data]);
  const busy = status.data?.busy === true || pending;

  const refreshAll = () => {
    reloadOverview();
    reloadStatus();
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
            data-testid="devbox-refresh"
          >
            <RefreshCw size={16} />
          </IconButton>
        }
      />
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <DevboxVitals cards={cards} error={overview.error} onRetry={reloadOverview} />
          <DevboxControls
            profiles={profiles}
            overviewCards={cards}
            actionStatus={status.data}
            busy={busy}
            onAction={onAction}
          />
          <DevboxProfiles
            profiles={profiles}
            error={profilesError}
            busy={busy}
            onRetry={reloadProfiles}
            onChanged={reloadProfiles}
          />
          <DevboxJobs />
          <DevboxPermissions />
          <DevboxEvents />
          <DevboxLogs />
          <DevboxActions recent={status.data?.recent ?? null} />
        </div>
      </div>
    </div>
  );
}
