import { AlertCircle, RefreshCw } from 'lucide-react';
import { t } from '../../lib/i18n';
import { Button } from '@/components/ui';


interface AccountsExpiredBannerProps {
  expiredCount: number;
  isRefreshing: boolean;
  onRefreshExpired: () => void;
  className?: string;
}

export function AccountsExpiredBanner({
  expiredCount,
  isRefreshing,
  onRefreshExpired,
  className,
}: AccountsExpiredBannerProps) {
  if (expiredCount <= 0) return null;

  return (
    <div
      className={
        className ??
        'shrink-0 mx-6 mt-4 flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3'
      }
    >
      <AlertCircle className="h-4 w-4 shrink-0 text-amber-400" />
      <span className="flex-1 text-sm text-amber-300">
        {t('accounts.expiredCountLabel')}: {expiredCount}
      </span>
      <Button
        onClick={onRefreshExpired}
        disabled={isRefreshing}
        variant="secondary"
        size="xs"
        className="border-amber-500/30 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
        leftIcon={<RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />}
      >
        {t('accounts.refreshAllExpired')}
      </Button>
    </div>
  );
}
