import { useCallback, useEffect, useState } from 'react';
import { Inbox, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { GlassCard } from '@/components/ui/GlassCard';
import { IconButton } from '@/components/ui/IconButton';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Tooltip } from '@/components/ui/Tooltip';
import { t } from '@/lib/i18n';
import { cn, formatDate } from '@/lib/utils';
import {
  mySubmissions,
  type PluginSubmissionSummary,
} from '@/lib/backend/modules/submissions';

/** Submission review-status chip; rejected carries the reason in a tooltip. */
function SubmissionStatusChip({ status, reason }: { status: string; reason?: string | null }) {
  const map: Record<string, { variant: 'success' | 'warning' | 'danger' | 'slate'; labelKey: string }> = {
    pending: { variant: 'warning', labelKey: 'marketplace.mySubmissions.statusPending' },
    approved: { variant: 'success', labelKey: 'marketplace.mySubmissions.statusApproved' },
    rejected: { variant: 'danger', labelKey: 'marketplace.mySubmissions.statusRejected' },
    delisted: { variant: 'slate', labelKey: 'marketplace.mySubmissions.statusDelisted' },
  };
  const entry = map[status];
  const chip = (
    <Badge variant={entry?.variant ?? 'default'} size="sm">
      {entry ? t(entry.labelKey) : status}
    </Badge>
  );
  if (status === 'rejected' && reason) {
    return (
      <Tooltip content={`${t('marketplace.mySubmissions.rejectionReason')}: ${reason}`} side="top">
        <span className="inline-flex">{chip}</span>
      </Tooltip>
    );
  }
  return chip;
}

export function MySubmissionsPanel() {
  const [submissions, setSubmissions] = useState<PluginSubmissionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await mySubmissions();
      if (result.success) {
        setSubmissions(result.submissions ?? []);
      } else {
        setSubmissions(null);
        setError(result.error ?? t('marketplace.mySubmissions.loadError'));
      }
    } catch (err) {
      setSubmissions(null);
      setError(err instanceof Error ? err.message : t('marketplace.mySubmissions.loadError'));
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="p-4 max-w-3xl mx-auto w-full">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">
            {t('marketplace.mySubmissions.title')}
          </h2>
          <IconButton
            onClick={() => void load()}
            size="md"
            variant="ghost"
            aria-label={t('marketplace.mySubmissions.refresh')}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </IconButton>
        </div>

        {loading && submissions === null ? (
          <div className="p-6 flex items-center justify-center">
            <LoadingSpinner size="md" />
            <span className="ml-2 text-sm text-slate-500">{t('common.loading')}</span>
          </div>
        ) : error !== null ? (
          <GlassCard className="p-6 flex flex-col items-center gap-3">
            <p className="text-sm text-slate-300">
              {t('marketplace.mySubmissions.loadError')}
            </p>
            <p className="text-xs text-slate-500 max-w-md text-center break-words">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              {t('marketplace.mySubmissions.refresh')}
            </Button>
          </GlassCard>
        ) : submissions !== null && submissions.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={t('marketplace.mySubmissions.empty')}
            description={t('marketplace.mySubmissions.emptyDesc')}
          />
        ) : (
          <div
            className={cn(
              'rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden transition-opacity',
              loading && 'opacity-60 pointer-events-none',
            )}
          >
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2 border-b border-white/[0.06] text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              <span>{t('marketplace.mySubmissions.colPlugin')}</span>
              <span>{t('marketplace.mySubmissions.colStatus')}</span>
              <span>{t('marketplace.mySubmissions.colDate')}</span>
            </div>
            {(submissions ?? []).map(s => (
              <div
                key={s.id}
                className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-4 py-2.5 border-b border-white/[0.04] last:border-0"
              >
                <div className="min-w-0">
                  {/* eslint-disable-next-line i18next/no-literal-string -- non-translatable plugin id/version token */}
                  <span className="text-[13px] text-slate-200 font-mono truncate block">
                    {s.plugin_id}@{s.version}
                  </span>
                  {/* eslint-disable-next-line i18next/no-literal-string -- non-translatable submission id token */}
                  <span className="text-[11px] text-slate-500">#{s.id}</span>
                </div>
                <SubmissionStatusChip status={s.review_status} reason={s.rejection_reason} />
                <span className="text-xs text-slate-500 tabular-nums">
                  {formatDate(s.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
