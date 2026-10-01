import { RefreshCw } from 'lucide-react';
import { Button, ToolbarTitle } from '@/components/ui';
import { t } from '@/lib/i18n';

type BatchOpsBarProps = {
  loading: boolean;
  refreshDisabled: boolean;
  onRefresh: () => void;
};

export function BatchOpsBar({ loading, refreshDisabled, onRefresh }: BatchOpsBarProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <ToolbarTitle
        eyebrow={t('scenarios.libraryTitle')}
        title={t('scenarios.librarySubtitle')}
        eyebrowClassName="text-[10px] uppercase tracking-[0.3em] text-slate-500"
        titleClassName="text-sm text-slate-200" />

      <Button
        size="sm"
        className="h-9"
        variant="secondary"
        onClick={onRefresh}
        disabled={refreshDisabled}
        leftIcon={<RefreshCw size={14} />}>

        {loading ? t('common.loading') : t('common.refresh')}
      </Button>
    </div>);

}
