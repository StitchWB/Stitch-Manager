import { appToast } from '@/lib/observability/toast';
import { t } from '@/lib/i18n';
import type { DevboxAccepted } from '@/lib/backend/modules/devbox';

const STALE_PERMISSION_REASON = /no pending permission matches/;

export function isStalePermissionReason(reason: string | undefined): boolean {
  return typeof reason === 'string' && STALE_PERMISSION_REASON.test(reason);
}

export async function runDevboxAction(
  action: Promise<DevboxAccepted>,
  onAccepted?: () => void,
  onStale?: () => void,
): Promise<boolean> {
  try {
    const result = await action;
    if (result && result.accepted === false) {
      if (isStalePermissionReason(result.reason)) {
        appToast.info(t('devboxPage.permissionStale'));
        onStale?.();
        return false;
      }
      appToast.error(result.reason || t('pluginUi.actionFailed'));
      return false;
    }
    appToast.info(t('devboxPage.queued'));
    onAccepted?.();
    return true;
  } catch (err) {
    appToast.error(err instanceof Error ? err.message : t('pluginUi.actionFailed'));
    return false;
  }
}
