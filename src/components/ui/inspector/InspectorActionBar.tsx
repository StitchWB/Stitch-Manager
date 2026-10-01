import {
  RefreshCw,
  Activity,
  Globe,
  Zap,
  Play,
  Square,
} from 'lucide-react';
import { t } from '@/lib/i18n';
import { Tooltip } from '@/components/ui/Tooltip';
import { IconButton } from '@/components/ui/IconButton';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { Account } from '@/types/generated';
import { InspectorOverflowMenu } from './InspectorOverflowMenu';

interface InspectorActionBarProps {
  account: Account;
  isActive: boolean;
  onToggleActive: () => void;
  onOpenBrowser?: (id: number) => void;
  onAuthorizeKiroAccount?: (id: number) => void;
  kiro: boolean;
  isCheckingStatus: boolean;
  onCheckStatus: () => void;
  isRefreshingToken: boolean;
  onRefreshToken: () => void;
  onCopyToken: (token: string) => void;
  onCopyRefUrl?: (refUrl: string) => void;
  onRefreshRefUrl?: (id: number) => void;
  onRequestDelete: (accountId: number) => void;
  copy: (text: string, opts?: { sensitive?: boolean; successMessage?: string }) => void;
}

export function InspectorActionBar({
  account,
  isActive,
  onToggleActive,
  onOpenBrowser,
  onAuthorizeKiroAccount,
  kiro,
  isCheckingStatus,
  onCheckStatus,
  isRefreshingToken,
  onRefreshToken,
  onCopyToken,
  onCopyRefUrl,
  onRefreshRefUrl,
  onRequestDelete,
  copy,
}: InspectorActionBarProps) {
  return (
    <div className="shrink-0 px-4 py-2 border-b border-white/5 flex items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant={isActive ? 'secondary' : 'primary'}
        onClick={onToggleActive}
        leftIcon={isActive ? <Square size={12} /> : <Play size={12} />}
      >
        {isActive ? t('accounts.deactivate') : t('accounts.activate')}
      </Button>

      {onOpenBrowser && (
        <Tooltip content={t('accounts.quickActions.openBrowser')}>
          <IconButton
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-7 text-slate-400 hover:text-blue-400 hover:bg-white/10"
            onClick={() => onOpenBrowser(account.id)}
          >
            <Globe size={14} />
          </IconButton>
        </Tooltip>
      )}
      {kiro && onAuthorizeKiroAccount && (
        <Tooltip content={t('accounts.quickActions.authorizeIde')}>
          <IconButton
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-7 text-slate-400 hover:text-emerald-400 hover:bg-white/10"
            onClick={() => onAuthorizeKiroAccount(account.id)}
          >
            <Zap size={14} />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip content={t('accounts.drawer.checkStatus')}>
        <IconButton
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 w-7 text-slate-400 hover:text-cyan-400 hover:bg-white/10"
          disabled={isCheckingStatus}
          onClick={onCheckStatus}
        >
          {isCheckingStatus ? <LoadingSpinner size="xs" /> : <Activity size={14} />}
        </IconButton>
      </Tooltip>
      <Tooltip content={t('accounts.refreshToken')}>
        <IconButton
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 w-7 text-slate-400 hover:text-indigo-400 hover:bg-white/10"
          disabled={isRefreshingToken || !account.refreshToken}
          onClick={onRefreshToken}
        >
          {isRefreshingToken ? <LoadingSpinner size="xs" /> : <RefreshCw size={14} />}
        </IconButton>
      </Tooltip>

      {/* Overflow menu */}
      <InspectorOverflowMenu
        account={account}
        copy={copy}
        onCopyToken={onCopyToken}
        onCopyRefUrl={onCopyRefUrl}
        onRefreshRefUrl={onRefreshRefUrl}
        onRequestDelete={onRequestDelete}
      />
    </div>
  );
}
