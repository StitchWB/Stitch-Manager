import { appToast } from '@/lib/observability/toast';
import { t } from '@/lib/i18n';
import type { DevboxAccepted } from '@/lib/backend/modules/devbox';

export async function runDevboxAction(
  action: Promise<DevboxAccepted>,
  onAccepted?: () => void,
): Promise<boolean> {
  try {
    const result = await action;
    if (result && result.accepted === false) {
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
