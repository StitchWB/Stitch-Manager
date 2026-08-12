import { useState, useCallback } from 'react';
import { GitPullRequest, ExternalLink, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Input, Modal } from '@/components/ui';
import { t } from '@/lib/i18n';
import { openInBrowser } from '@/lib/backend/modules/utils';
import { submitForReview } from '@/lib/backend/modules/community';

export interface SubmitForReviewModalProps {
  packageId: string | null;
  onClose: () => void;
}

export function SubmitForReviewModal({ packageId, onClose }: SubmitForReviewModalProps) {
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
      const result = await submitForReview({
        package_id: packageId,
        github_token: token,
      });
      if (result.success && result.pr_url) {
        setPrUrl(result.pr_url);
        toast.success(t('settings.community.submitSuccess'));
      } else if (result.success) {
        toast.success(t('settings.community.submitSuccess'));
        handleClose();
      } else {
        toast.error(result.error || t('settings.community.submitFailed'));
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('settings.community.submitFailed'),
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [packageId, token, handleClose]);

  const handleOpenPr = useCallback(async () => {
    if (!prUrl) return;
    try {
      await openInBrowser({ url: prUrl });
    } catch {
      // Fallback: window.open
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCloseBtn}
      title={t('settings.community.submitForReviewTitle')}
      icon={<GitPullRequest className="w-4 h-4 text-indigo-400" />}
      size="sm"
      isLoading={isSubmitting}
      loadingMessage={t('settings.community.submitting')}
      footer={
        prUrl ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-400 truncate">
              {t('settings.community.prLinkLabel')}{' '}
              <span className="text-indigo-300 font-mono">{prUrl}</span>
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button
                size="sm"
                variant="primary"
                onClick={() => void handleOpenPr()}
                leftIcon={<ExternalLink className="w-3.5 h-3.5" />}
              >
                {t('settings.community.openPr')}
              </Button>
              <Button size="sm" variant="ghost" onClick={handleCloseBtn}>
                {t('settings.community.cancel')}
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
              {t('settings.community.cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void handleSubmit()}
              isLoading={isSubmitting}
              disabled={!token.trim()}
              leftIcon={<GitPullRequest className="w-3.5 h-3.5" />}
            >
              {isSubmitting
                ? t('settings.community.submitting')
                : t('settings.community.submit')}
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-400 leading-relaxed">
          {t('settings.community.submitForReviewDescription')}
        </p>

        {prUrl ? (
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-2">
            <p className="text-sm text-emerald-300 font-medium">
              {t('settings.community.submitSuccess')}
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
