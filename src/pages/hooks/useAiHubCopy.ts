import { useCallback } from 'react';
import { toast } from 'sonner';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { t } from '@/lib/i18n';

export function useAiHubCopy() {
  return useCallback(
    async (label: string, value: string, requireConfirm = false) => {
      if (!value) {
        toast.error(t('aiHub.copy.empty'));
        return;
      }
      if (requireConfirm) {
        const ok = await askConfirm({
          title: t('common.copy'),
          message: t('aiHub.warnings.copySensitiveConfirm', { label }),
          confirmText: t('common.copy'),
          cancelText: t('common.cancel'),
          variant: 'warning',
        });
        if (!ok) return;
      }
      try {
        await navigator.clipboard.writeText(value);
        toast.success(t('aiHub.copy.success', { label }));
      } catch (e) {
        console.error('[AiProviders] Copy failed:', e);
        toast.error(t('aiHub.copy.fail', { label }));
      }
    },
    []
  );
}
