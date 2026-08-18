import { Button } from '@/components/ui';
import { t } from '@/lib/i18n';
import type { ScenarioReplayStatus } from '@/lib/scenarioRecorder/useScenarioReplay';

type ReplayFooterActionsProps = {
  showRuntimeActions: boolean;
  extensionBridgeConnected: boolean;
  canStart: boolean;
  preflightInvalid: boolean;
  startBlockedReason: string | null;
  runtimeInstalled: boolean | null;
  status: ScenarioReplayStatus;
  hasJob: boolean;
  quickRunEnabled: boolean;
  quickRunLabel?: string | null;
  onResume: () => void;
  onAbort: () => void;
  onStop: () => void;
  onStart: () => void;
  onQuickRun: () => void;
  onInstallRuntime: () => void;
  onClose: () => void;
};

export function ReplayFooterActions({
  showRuntimeActions,
  extensionBridgeConnected,
  canStart,
  preflightInvalid,
  startBlockedReason,
  runtimeInstalled,
  status,
  hasJob,
  quickRunEnabled,
  quickRunLabel,
  onResume,
  onAbort,
  onStop,
  onStart,
  onQuickRun,
  onInstallRuntime,
  onClose,
}: ReplayFooterActionsProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onResume} disabled={status !== 'manual_pause'}>
            {t('recorder.replay.resume')}
          </Button>
          <Button variant="danger" onClick={onAbort} disabled={status !== 'manual_pause'}>
            {t('recorder.replay.abort')}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={onQuickRun}
            disabled={!quickRunEnabled}
            title={quickRunLabel ?? t('recorder.replay.quickRunTitle')}
          >
            {t('recorder.replay.quickRunAction')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
          {showRuntimeActions ? (
            <Button variant="secondary" onClick={onInstallRuntime}>
              {t('common.installRuntime')}
            </Button>
          ) : null}
          <Button variant="danger" onClick={onStop} disabled={!hasJob || status === 'stopping'}>
            {t('common.stop')}
          </Button>
          <Button
            onClick={onStart}
            title={t('recorder.replay.startHotkeyHint')}
            disabled={
              !canStart ||
              preflightInvalid ||
              status === 'starting' ||
              status === 'running' ||
              (!showRuntimeActions && !extensionBridgeConnected) ||
              (showRuntimeActions && runtimeInstalled === false)
            }
          >
            {t('common.start')}
          </Button>
        </div>
      </div>
      {showRuntimeActions && runtimeInstalled === false ? (
        <div className="text-xs text-amber-300">{t('recorder.replay.runtimeMissingNote')}</div>
      ) : null}
      {startBlockedReason ? (
        <div className="text-xs text-amber-300">{startBlockedReason}</div>
      ) : null}
    </div>
  );
}
