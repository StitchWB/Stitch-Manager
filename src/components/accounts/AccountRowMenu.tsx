import { RefreshCw, Globe, Square, Play, User, Check, X, Copy, Info, Trash2, Zap, ZapOff, KeyRound } from 'lucide-react';
import { ButtonBase } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import type { Account } from '@/types/generated';

function isAutoRefreshEnabled(account: Account): boolean {
  if (!account.metadata) return false;
  try {
    const meta = JSON.parse(account.metadata);
    return meta.autoRefreshQuota === true;
  } catch {
    return false;
  }
}

function isKiroProvider(account: Account): boolean {
  return account.provider === 'kiro' || account.provider === 'kiro_v2';
}

interface AccountRowMenuProps {
  account: Account;
  isActive: boolean;
  isRefreshing: boolean;
  isMenuOpen: boolean;
  allowProfileAction: boolean;
  profileSessionPending: boolean;
  profileSessionReady: boolean;
  onCheckStatus: (id: number) => Promise<void>;
  onOpenBrowser?: (accountId: number) => Promise<void>;
  onToggleActive: (account: Account) => Promise<void>;
  onToggleAutoRefreshQuota?: (account: Account) => Promise<void>;
  onOpenProfileSession?: (accountId: number) => Promise<void>;
  onConfirmProfileSession?: (accountId: number) => Promise<void>;
  onClearProfileSession?: (accountId: number) => Promise<void>;
  onAuthorizeKiroAccount?: (accountId: number) => Promise<void>;
  onCopyToken: (token: string) => Promise<void>;
  onShowDetails: (account: Account) => void;
  onDelete: (accountId: number) => void;
  onCloseMenu: () => void;
}

export function AccountRowMenu({
  account,
  isActive,
  isRefreshing,
  isMenuOpen,
  allowProfileAction,
  profileSessionPending,
  profileSessionReady,
  onCheckStatus,
  onOpenBrowser,
  onToggleActive,
  onToggleAutoRefreshQuota,
  onOpenProfileSession,
  onConfirmProfileSession,
  onClearProfileSession,
  onAuthorizeKiroAccount,
  onCopyToken,
  onShowDetails,
  onDelete,
  onCloseMenu,
}: AccountRowMenuProps) {
  const autoRefreshEnabled = isAutoRefreshEnabled(account);
  if (!isMenuOpen) return null;

  return (
    <div
      className="absolute right-0 top-8 z-50 w-56 rounded-lg border border-white/10 bg-vsc-panel p-1 shadow-xl shadow-black/50"
      data-row-actions-menu="true"
    >
      <ButtonBase
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5"
        onClick={() => {
          void onCheckStatus(account.id);
          onCloseMenu();
        }}
      >
        <RefreshCw size={12} className={cn(isRefreshing && 'animate-spin')} />
        {t('accountsTable.checkStatus')}
      </ButtonBase>

      {onOpenBrowser ? (
        <ButtonBase
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5"
          onClick={() => {
            void onOpenBrowser(account.id);
            onCloseMenu();
          }}
        >
          <Globe size={12} />
          {t('accountsTable.openBrowser')}
        </ButtonBase>
      ) : null}

      <ButtonBase
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5"
        onClick={() => {
          void onToggleActive(account);
          onCloseMenu();
        }}
      >
        {isActive ? <Square size={12} /> : <Play size={12} />}
        {isActive ? t('accounts.deactivate') : t('accounts.activate')}
      </ButtonBase>

      {onOpenProfileSession && allowProfileAction ? (
        <ButtonBase
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5"
          onClick={() => {
            void onOpenProfileSession(account.id);
            onCloseMenu();
          }}
        >
          <User size={12} />
          {t('accounts.profileSessionOpen')}
        </ButtonBase>
      ) : null}

      {onConfirmProfileSession && profileSessionPending ? (
        <ButtonBase
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5"
          onClick={() => {
            void onConfirmProfileSession(account.id);
            onCloseMenu();
          }}
        >
          <Check size={12} />
          {t('accounts.profileSessionConfirm')}
        </ButtonBase>
      ) : null}

      {onClearProfileSession && profileSessionReady ? (
        <ButtonBase
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5"
          onClick={() => {
            void onClearProfileSession(account.id);
            onCloseMenu();
          }}
        >
          <X size={12} />
          {t('accounts.profileSessionClear')}
        </ButtonBase>
      ) : null}

      {account.token ? (
        <ButtonBase
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5"
          onClick={() => {
            void onCopyToken(account.token ?? '');
            onCloseMenu();
          }}
        >
          <Copy size={12} />
          {t('accounts.copyToken')}
        </ButtonBase>
      ) : null}

      {onToggleAutoRefreshQuota ? (
        <ButtonBase
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5"
          onClick={() => {
            void onToggleAutoRefreshQuota(account);
            onCloseMenu();
          }}
        >
          {autoRefreshEnabled ? <ZapOff size={12} className="text-amber-400" /> : <Zap size={12} className="text-emerald-400" />}
          {autoRefreshEnabled ? 'Отключить автообновление квоты' : 'Включить автообновление квоты'}
        </ButtonBase>
      ) : null}

      {onAuthorizeKiroAccount && isKiroProvider(account) ? (
        <ButtonBase
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5"
          onClick={() => {
            void onAuthorizeKiroAccount(account.id);
            onCloseMenu();
          }}
        >
          <KeyRound size={12} className="text-amber-300" />
          {t('accounts.authorizeInIdeMenu')}
        </ButtonBase>
      ) : null}

      <ButtonBase
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5"
        onClick={() => {
          onShowDetails(account);
          onCloseMenu();
        }}
      >
        <Info size={12} />
        {t('common.more')}
      </ButtonBase>

      <div className="my-1 h-px bg-white/10" />

      <ButtonBase
        type="button"
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-rose-300 hover:bg-rose-500/10"
        onClick={() => {
          onDelete(account.id);
          onCloseMenu();
        }}
      >
        <Trash2 size={12} />
        {t('accounts.deleteAccountTitle')}
      </ButtonBase>
    </div>
  );
}
