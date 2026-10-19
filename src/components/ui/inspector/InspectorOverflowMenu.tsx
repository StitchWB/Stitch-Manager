import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Copy,
  RefreshCw,
  Trash2,
  Eye,
  MoreHorizontal,
  Mail,
  Archive,
} from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import { IconButton } from '@/components/ui/IconButton';
import { ButtonBase } from '@/components/ui/ButtonBase';
import { useAccountsStore } from '@/stores/accounts';
import type { Account } from '@/types/generated';

interface InspectorOverflowMenuProps {
  account: Account;
  copy: (text: string, opts?: { sensitive?: boolean; successMessage?: string }) => void;
  onCopyToken: (token: string) => void;
  onCopyRefUrl?: (refUrl: string) => void;
  onRefreshRefUrl?: (id: number) => void;
  onRequestDelete: (accountId: number) => void;
}

export function InspectorOverflowMenu({
  account,
  copy,
  onCopyToken,
  onCopyRefUrl,
  onRefreshRefUrl,
  onRequestDelete,
}: InspectorOverflowMenuProps) {
  const navigate = useNavigate();
  const [overflowOpen, setOverflowOpen] = useState(false);
  // Two-step delete via overflow menu (no confirm modal): first click arms 3s.
  const [deleteArmed, setDeleteArmed] = useState(false);

  // Capture phase + stopPropagation: Escape closes the menu before AccountsTable's bubble listener closes the panel.
  useEffect(() => {
    if (!overflowOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOverflowOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [overflowOpen]);

  const handleArchive = async () => {
    try {
      await useAccountsStore.getState().archiveAccounts([account.id], true);
      toast.success(t('accounts.archiveSuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('accounts.archiveFailed'));
    }
  };

  const handleOpenMail = () => {
    navigate(`/mail?account=${account.id}`);
  };

  const overflowItems = useMemo(() => {
    const items: { id: string; label: string; icon: React.ReactNode; onSelect: () => void; tone?: 'default' | 'danger'; disabled?: boolean }[] = [
      {
        id: 'copy-email',
        label: t('accounts.quickActions.copyEmail'),
        icon: <Copy size={12} />,
        onSelect: () => copy(account.email, { successMessage: t('accounts.quickActions.emailCopied') }),
      },
    ];
    if (account.registrationPassword) {
      items.push({
        id: 'copy-password',
        label: t('accounts.quickActions.copyPassword'),
        icon: <Eye size={12} />,
        onSelect: () =>
          copy(account.registrationPassword!, {
            sensitive: true,
            successMessage: t('accounts.quickActions.passwordCopied'),
          }),
      });
    }
    if (account.token) {
      items.push({
        id: 'copy-token',
        label: t('accounts.copyToken'),
        icon: <Copy size={12} />,
        onSelect: () => onCopyToken(account.token!),
      });
    }
    return items;
  }, [account, copy, onCopyToken]);

  const refItems = useMemo(() => {
    const items: { id: string; label: string; icon: React.ReactNode; onSelect: () => void }[] = [];
    if (account.refUrl && onCopyRefUrl) {
      items.push({
        id: 'copy-ref',
        label: t('accounts.account_ref_cell.copy_ref_url'),
        icon: <Copy size={12} />,
        onSelect: () => onCopyRefUrl(account.refUrl!),
      });
    }
    if (onRefreshRefUrl) {
      items.push({
        id: 'refresh-ref',
        label: account.refUrl
          ? t('accounts.account_ref_cell.refresh_ref_url')
          : t('accounts.account_ref_cell.get_ref_url'),
        icon: <RefreshCw size={12} />,
        onSelect: () => onRefreshRefUrl(account.id),
      });
    }
    return items;
  }, [account, onCopyRefUrl, onRefreshRefUrl]);

  return (
    <div className="ml-auto relative">
      <IconButton
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 w-7 text-slate-400 hover:text-white hover:bg-white/10"
        onClick={() => setOverflowOpen(v => !v)}
        aria-label={t('common.actions')}
      >
        <MoreHorizontal size={14} />
      </IconButton>
      {overflowOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOverflowOpen(false)} />
          <div
            className="absolute right-0 top-8 z-50 w-56 rounded-lg border border-white/10 bg-vsc-panel p-1 shadow-xl shadow-black/50"
            data-row-actions-menu="true"
          >
            {overflowItems.map(item => (
              <ButtonBase
                key={item.id}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5"
                onClick={() => { item.onSelect(); setOverflowOpen(false); }}
              >
                {item.icon}
                {item.label}
              </ButtonBase>
            ))}
            <div className="my-1 h-px bg-white/10" />
            <ButtonBase
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5"
              onClick={() => { handleOpenMail(); setOverflowOpen(false); }}
            >
              <Mail size={12} />
              {t('accounts.inspector.openMail')}
            </ButtonBase>
            {refItems.length > 0 && (
              <>
                <div className="my-1 h-px bg-white/10" />
                {refItems.map(item => (
                  <ButtonBase
                    key={item.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5"
                    onClick={() => { item.onSelect(); setOverflowOpen(false); }}
                  >
                    {item.icon}
                    {item.label}
                  </ButtonBase>
                ))}
              </>
            )}
            <div className="my-1 h-px bg-white/10" />
            <ButtonBase
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5"
              onClick={() => { handleArchive(); setOverflowOpen(false); }}
            >
              <Archive size={12} />
              {t('accounts.inspector.archive')}
            </ButtonBase>
            <ButtonBase
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-rose-300 hover:bg-rose-500/10"
              onClick={() => {
                if (deleteArmed) {
                  setDeleteArmed(false);
                  setOverflowOpen(false);
                  onRequestDelete(account.id);
                  return;
                }
                setDeleteArmed(true);
                setTimeout(() => setDeleteArmed(false), 3000);
              }}
            >
              <Trash2 size={12} />
              {deleteArmed ? t('scenarios.deleteArmedLabel') || 'Delete?' : t('common.delete')}
            </ButtonBase>
          </div>
        </>
      )}
    </div>
  );
}
