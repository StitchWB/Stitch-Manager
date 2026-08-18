import { useState, useCallback } from 'react';
import { GitPullRequest, ExternalLink, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Input, Modal } from '@/components/ui';
import { t } from '@/lib/i18n';
import { openInBrowser } from '@/lib/backend/modules/utils';
import { submitForReview } from '@/lib/backend/modules/community';
import { submitOverride } from '@/lib/backend/modules/overrides';

export interface SubmitForReviewModalProps {
  packageId: string | null;
  onClose: () => void;
  /** When true, the modal submits an override patch-candidate PR via submit_override. */
  overrideMode?: boolean;
}

export function SubmitForReviewModal({
  packageId,
  onClose,
  overrideMode = false,
}: SubmitForReviewModalProps) {
  const [token, setToken] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [prUrl, setPrUrl] = useState<string | null>(null);

  const isOpen = packageId !== null;

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    setToken('');
    setPrUrl(null);
    onClose();
  }, [isSubmitting, onClose]);

  const handleSubmit = useCallback(async () => {
    if (!packageId || !token.trim()) return;
    setIsSubmitting(true);
    setPrUrl(null);
    try {
      const result = overrideMode
        ? await submitOverride({
            plugin_id: packageId,
            github_token: token,
          })
        : await submitForReview({
            package_id: packageId,
            github_token: token,
          });
      const successMsg = overrideMode
        ? t('settings.overrides.submitSuccess')
        : t('settings.community.submitSuccess');
      const failedMsg = overrideMode
        ? t('settings.overrides.submitFailed')
        : t('settings.community.submitFailed');
      if (result.success && result.pr_url) {
        setPrUrl(result.pr_url);
        toast.success(successMsg);
      } else if (result.success) {
        toast.success(successMsg);
        handleClose();
      } else {
        toast.error(result.error || failedMsg);
      }
    } catch (err) {
      const failedMsg = overrideMode
        ? t('settings.overrides.submitFailed')
        : t('settings.community.submitFailed');
      toast.error(err instanceof Error ? err.message : failedMsg);
    } finally {
      setIsSubmitting(false);
    }
  }, [packageId, token, handleClose, overrideMode]);

  const handleOpenPr = useCallback(async () => {
    if (!prUrl) return;
    try {
      await openInBrowser({ url: prUrl });
    } catch {
      window.open(prUrl, '_blank', 'noopener,noreferrer');
    }
  }, [prUrl]);

  const handleCloseBtn = useCallback(() => {
    if (prUrl) {
      setToken('');
      setPrUrl(null);
      onClose();
    } else {
      handleClose();
    }
  }, [prUrl, handleClose, onClose]);

  const titleKey = overrideMode
    ? 'settings.overrides.submitTitle'
    : 'settings.community.submitForReviewTitle';
  const descKey = overrideMode
    ? 'settings.overrides.submitDescription'
    : 'settings.community.submitForReviewDescription';
  const submittingKey = overrideMode
    ? 'settings.overrides.submitting'
    : 'settings.community.submitting';
  const submitKey = overrideMode
    ? 'settings.overrides.submit'
    : 'settings.community.submit';
  const successKey = overrideMode
    ? 'settings.overrides.submitSuccess'
    : 'settings.community.submitSuccess';
  const cancelKey = overrideMode
    ? 'settings.overrides.cancel'
    : 'settings.community.cancel';
  const openPrKey = overrideMode
    ? 'settings.overrides.openPr'
    : 'settings.community.openPr';
  const prLinkKey = overrideMode
    ? 'settings.overrides.prLinkLabel'
    : 'settings.community.prLinkLabel';

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCloseBtn}
      title={t(titleKey)}
      icon={<GitPullRequest className="w-4 h-4 text-indigo-400" />}
      size="sm"
      isLoading={isSubmitting}
      loadingMessage={t(submittingKey)}
      footer={
        prUrl ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-400 truncate">
              {t(prLinkKey)}{' '}
              <span className="text-indigo-300 font-mono">{prUrl}</span>
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                size="sm"
                variant="primary"
                onClick={() => void handleOpenPr()}
                leftIcon={<ExternalLink className="w-3.5 h-3.5" />}
              >
                {t(openPrKey)}
              </Button>
              <Button size="sm" variant="ghost" onClick={handleCloseBtn}>
                {t(cancelKey)}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleClose}
              disabled={isSubmitting}
            >
              {t(cancelKey)}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void handleSubmit()}
              isLoading={isSubmitting}
              disabled={!token.trim()}
              leftIcon={<GitPullRequest className="w-3.5 h-3.5" />}
            >
              {isSubmitting ? t(submittingKey) : t(submitKey)}
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-400 leading-relaxed">
          {t(descKey)}
        </p>

        {prUrl ? (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
            <p className="text-sm text-emerald-300 font-medium">
              {t(successKey)}
            </p>
            <p className="text-xs text-slate-400 break-all font-mono">{prUrl}</p>
          </div>
        ) : (
          <>
            <Input
              type="password"
              label={t('settings.community.githubTokenLabel')}
              placeholder={t('settings.community.githubTokenPlaceholder')}
              value={token}
              onChange={e => setToken(e.target.value)}
              leftIcon={<KeyRound className="w-3.5 h-3.5" />}
              hint={t('settings.community.githubTokenHint')}
              disabled={isSubmitting}
            />
            <p className="text-xs text-slate-500 leading-relaxed">
              {t('settings.community.githubTokenNotPersisted')}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
