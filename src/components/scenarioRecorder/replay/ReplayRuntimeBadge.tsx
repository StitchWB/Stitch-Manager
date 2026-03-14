import { Badge } from '@/components/ui';
import { t } from '@/lib/i18n';

type ReplayRuntimeBadgeProps = {
  runtimeInstalled: boolean | null;
  mode?: 'native' | 'extension';
};

export function ReplayRuntimeBadge({ runtimeInstalled, mode = 'native' }: ReplayRuntimeBadgeProps) {
  if (mode === 'extension') {
    return (
      <Badge variant="info" size="sm" withDot className="uppercase tracking-wide">
        Runner Extension
      </Badge>
    );
  }

  const statusLabel =
    runtimeInstalled === true
      ? t('recorder.replay.runtimeReady')
      : runtimeInstalled === false
        ? t('recorder.replay.runtimeMissing')
        : t('recorder.replay.runtimeChecking');

  const variant =
    runtimeInstalled === true ? 'success' : runtimeInstalled === false ? 'warning' : 'outline';

  return (
    <Badge
      variant={variant}
      size="sm"
      withDot
      withPulse={runtimeInstalled === null}
      className="uppercase tracking-wide"
    >
      {t('recorder.replay.runtimeLabel')} {statusLabel}
    </Badge>
  );
}
