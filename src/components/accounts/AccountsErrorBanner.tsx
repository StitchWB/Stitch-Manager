import { t } from '../../lib/i18n';

interface AccountsErrorBannerProps {
  error: string;
  className?: string;
}

export function AccountsErrorBanner({ error, className }: AccountsErrorBannerProps) {
  return (
    <div
      className={
        className ??
        'shrink-0 mx-6 mt-4 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-200'
      }
    >
      {t('accounts.loadAccountsErrorPrefix')}: {error}
    </div>
  );
}
