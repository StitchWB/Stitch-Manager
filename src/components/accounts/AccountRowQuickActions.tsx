import { Copy, Key, Globe, Zap } from 'lucide-react';
import { IconButton, Tooltip } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { Account } from '@/types/generated';
import { t } from '@/lib/i18n';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';

interface AccountRowQuickActionsProps {
  account: Account;
  onOpenBrowser?: (accountId: number) => Promise<void>;
  onAuthorizeKiroAccount?: (accountId: number) => Promise<void>;
}

export function AccountRowQuickActions({
  account,
  onOpenBrowser,
  onAuthorizeKiroAccount,
}: AccountRowQuickActionsProps) {
  const { copy } = useCopyToClipboard();

  const isKiroProvider = ['kiro', 'kiro_v2'].includes(
    account.provider?.toLowerCase() ?? ''
  );

  return (
    <div
      className={cn(
        'flex items-center gap-0.5',
        'opacity-0 group-hover/row:opacity-100 transition-opacity duration-150'
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Copy Email */}
      <Tooltip content={t('accounts.quickActions.copyEmail')}>
        <IconButton
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 w-6 text-slate-400 hover:text-white hover:bg-white/10"
          onClick={(e) => {
            e.stopPropagation();
            void copy(account.email, { successMessage: t('accounts.quickActions.emailCopied') });
          }}
        >
          <Copy size={12} />
        </IconButton>
      </Tooltip>

      {/* Copy Password */}
      {account.registrationPassword && (
        <Tooltip content={t('accounts.quickActions.copyPassword')}>
          <IconButton
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 w-6 text-slate-400 hover:text-amber-400 hover:bg-white/10"
            onClick={(e) => {
              e.stopPropagation();
              void copy(account.registrationPassword!, {
                sensitive: true,
                successMessage: t('accounts.quickActions.passwordCopied'),
              });
            }}
          >
            <Key size={12} />
          </IconButton>
        </Tooltip>
      )}

      {/* Open Browser */}
      {onOpenBrowser && (
        <Tooltip content={t('accounts.quickActions.openBrowser')}>
          <IconButton
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 w-6 text-slate-400 hover:text-blue-400 hover:bg-white/10"
            onClick={(e) => {
              e.stopPropagation();
              void onOpenBrowser(account.id);
            }}
          >
            <Globe size={12} />
          </IconButton>
        </Tooltip>
      )}

      {/* Authorize in IDE */}
      {isKiroProvider && onAuthorizeKiroAccount && (
        <Tooltip content={t('accounts.quickActions.authorizeIde')}>
          <IconButton
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 w-6 text-slate-400 hover:text-emerald-400 hover:bg-white/10"
            onClick={(e) => {
              e.stopPropagation();
              void onAuthorizeKiroAccount(account.id);
            }}
          >
            <Zap size={12} />
          </IconButton>
        </Tooltip>
      )}
    </div>
  );
}
