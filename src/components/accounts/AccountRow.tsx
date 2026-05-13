import { Play, MoreHorizontal } from 'lucide-react';
import {
  Badge,
  Button,
  ButtonBase,
  Checkbox,
  TableCell,
  TableRow,
  Tooltip,
  ProviderLogo,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import type { Account } from '@/types/generated';
import type { AccountsTableVisibleColumns } from '@/stores/uiPreferences';
import { getAccountStatusLabel } from '@/lib/accountStatus';
import { t } from '@/lib/i18n';
import type { AccountRelationEdge, RelationType } from '@/lib/accounts/relations';
import { useAccountRowData } from '@/hooks/useAccountRow';
import { AccountRowMenu } from './AccountRowMenu';
import { AccountQuotaCell } from './AccountQuotaCell';

interface AccountRowProps {
  account: Account;
  isSelected: boolean;
  isActive: boolean;
  isRefreshing: boolean;
  isMenuOpen: boolean;
  visibleColumns?: AccountsTableVisibleColumns;
  relationHints?: string[];
  relationEdges?: AccountRelationEdge[];
  onToggleSelection: (accountId: number) => void;
  onToggleMenu: (accountId: number) => void;
  onCloseMenu: () => void;
  onShowDetails: (account: Account) => void;
  onLaunch: (account: Account) => Promise<void>;
  onToggleActive: (account: Account) => Promise<void>;
  onCheckStatus: (accountId: number) => Promise<void>;
  onCopyToken: (token: string) => Promise<void>;
  onDelete: (accountId: number) => void;
  onOpenBrowser?: (accountId: number) => Promise<void>;
  onToggleAutoRefreshQuota?: (account: Account) => Promise<void>;
  onOpenProfileSession?: (accountId: number) => Promise<void>;
  onConfirmProfileSession?: (accountId: number) => Promise<void>;
  onClearProfileSession?: (accountId: number) => Promise<void>;
  onRelationEdgeClick?: (edgeType: RelationType, targetProvider: string) => void;
}

export function AccountRow({
  account,
  isSelected,
  isActive,
  isRefreshing,
  isMenuOpen,
  visibleColumns = { lastLogin: true, proxy: true, tags: true, quota: true },
  relationHints,
  relationEdges,
  onToggleSelection,
  onToggleMenu,
  onCloseMenu,
  onShowDetails,
  onLaunch,
  onToggleActive,
  onCheckStatus,
  onCopyToken,
  onDelete,
  onOpenBrowser,
  onToggleAutoRefreshQuota,
  onOpenProfileSession,
  onConfirmProfileSession,
  onClearProfileSession,
  onRelationEdgeClick,
}: AccountRowProps) {
  const data = useAccountRowData(account, relationHints, relationEdges);

  return (
    <TableRow
      className={cn(
        'group/row min-h-16 border-white/[0.04] hover:bg-white/[0.02]',
        isSelected && 'bg-indigo-500/10'
      )}
    >
      {/* Checkbox */}
      <TableCell
        className="sticky left-0 z-10 w-[40px] min-w-[40px] max-w-[40px] px-2 py-2 align-middle bg-ds-surface-sunken group-hover/row:bg-white/[0.03]"
        onClick={event => event.stopPropagation()}
      >
        <Checkbox
          checked={isSelected}
          onChange={() => onToggleSelection(account.id)}
          className="p-0 hover:bg-transparent"
          aria-label={t('accounts.selectAccountAria', { email: account.email })}
        />
      </TableCell>

      {/* Provider */}
      <TableCell className="sticky left-[40px] z-10 w-[70px] min-w-[70px] px-2 py-2 align-middle bg-ds-surface-sunken group-hover/row:bg-white/[0.03]">
        <div className="flex items-center gap-1 overflow-hidden">
          <ProviderLogo provider={account.provider} size={14} className="shrink-0" />
          <span className="truncate whitespace-nowrap text-[11px] text-slate-300">{data.providerLabel}</span>
        </div>
      </TableCell>

      {/* Account */}
      <TableCell className="sticky left-[110px] z-10 w-[130px] min-w-[130px] max-w-[150px] px-2 py-2 align-middle bg-ds-surface-sunken group-hover/row:bg-white/[0.03]">
        <ButtonBase
          type="button"
          onClick={() => onShowDetails(account)}
          className="group/account inline-flex max-w-full flex-col items-start overflow-hidden text-left"
        >
          <span className="w-full truncate text-sm font-semibold text-white group-hover/account:text-indigo-200">
            {data.displayAlias}
          </span>
          {data.alias && data.alias !== data.displayAlias && data.alias !== data.accountIdentifier ? (
            <span className="w-full truncate text-[10px] text-slate-500">{data.alias}</span>
          ) : null}
          <Tooltip
            content={
              <div className="space-y-1 text-[11px]">
                <div className="font-medium text-white">{data.accountIdentifier}</div>
                <div className="text-slate-400">{t('accounts.profileIdLabel')}: {data.profileId}</div>
              </div>
            }
            side="top"
          >
            <span className="w-full truncate text-[11px] text-slate-500">
              {data.accountIdentifier !== data.displayAlias && data.accountIdentifier !== data.alias ? data.accountIdentifier : '\u00A0'}
            </span>
          </Tooltip>
        </ButtonBase>

        {(data.relationProviderEntries.length > 0 || data.relationHintList.length > 0) && (
          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
            <div className="flex items-center gap-1">
              {data.relationProviderEntries.slice(0, 4).map(([providerKey, edge]) => (
                <Tooltip key={`${providerKey}-${edge.type}`} content={edge.label}>
                  <ButtonBase
                    type="button"
                    onClick={event => {
                      event.stopPropagation();
                      onRelationEdgeClick?.(edge.type, edge.targetProvider);
                    }}
                    className="inline-flex items-center justify-center rounded border border-cyan-500/20 bg-cyan-500/10 p-1 hover:bg-cyan-500/20"
                  >
                    <ProviderLogo provider={providerKey} size={10} />
                  </ButtonBase>
                </Tooltip>
              ))}
            </div>
            {data.relationHintList.slice(0, 2).map(hint => (
              <span
                key={`${account.id}-${hint}`}
                className="rounded border border-cyan-500/20 bg-cyan-500/10 px-1 py-0.5 text-[9px] text-cyan-200"
              >
                {hint}
              </span>
            ))}
          </div>
        )}
      </TableCell>

      {/* Status */}
      <TableCell className="w-[70px] min-w-[70px] px-2 py-2 align-middle">
        <Badge
          variant={data.statusVariant as any}
          size="sm"
          className="normal-case tracking-normal border-0 gap-1"
        >
          <span className={cn('w-1.5 h-1.5 rounded-full', data.statusDotColor)} />
          {getAccountStatusLabel(account.status as any)}
        </Badge>
      </TableCell>

      {/* Last Login */}
      <TableCell
        className={cn(
          visibleColumns.lastLogin
            ? 'w-[70px] min-w-[70px] px-2 py-2 align-middle text-[11px] text-slate-300 tabular-nums'
            : 'hidden'
        )}
      >
        {data.lastLoginFormatted}
      </TableCell>

      {/* Proxy */}
      <TableCell
        className={cn(
          visibleColumns.proxy ? 'w-[70px] min-w-[70px] px-2 py-2 align-middle' : 'hidden'
        )}
      >
        <Tooltip content={data.proxyValue} side="top">
          <span className="block truncate font-mono text-[11px] text-slate-200">{data.proxyValue}</span>
        </Tooltip>
      </TableCell>

      {/* Tags */}
      <TableCell
        className={cn(
          visibleColumns.tags ? 'w-[60px] min-w-[60px] px-2 py-2 align-middle' : 'hidden'
        )}
      >
        <div className="flex items-center gap-1">
          {data.visibleTags.length > 0 ? (
            data.visibleTags.map(tag => (
              <Badge
                key={`${account.id}-${tag}`}
                variant="outline"
                size="sm"
                className="max-w-[60px] truncate border-white/10 bg-white/[0.02] normal-case tracking-normal"
              >
                {tag}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-slate-500">—</span>
          )}
          {data.remainingTagsCount > 0 ? (
            <span className="text-xs text-slate-500">+{data.remainingTagsCount}</span>
          ) : null}
        </div>
      </TableCell>

      {/* Quota */}
      <TableCell
        className={cn(
          visibleColumns.quota ? 'w-[65px] min-w-[65px] px-2 py-2 align-middle' : 'hidden'
        )}
      >
        <AccountQuotaCell account={account} onCheckStatus={onCheckStatus} />
      </TableCell>

      {/* Actions */}
      <TableCell
        className="w-[48px] min-w-[48px] max-w-[48px] px-1 py-2 align-middle"
        onClick={event => event.stopPropagation()}
      >
        <div className="relative flex justify-end" data-row-actions-menu="true">
          <div
            className={cn(
              'flex items-center gap-1 transition-opacity',
              isMenuOpen ? 'opacity-100' : 'opacity-40 group-hover/row:opacity-100'
            )}
          >
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="inline-flex h-7 w-7 border-white/15 bg-transparent text-slate-300 hover:border-white/30 hover:bg-white/[0.04] hover:text-white"
              onClick={() => {
                void onLaunch(account);
                onCloseMenu();
              }}
              aria-label={t('common.start')}
            >
              <Play size={12} />
            </Button>
            <ButtonBase
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
              onClick={() => onToggleMenu(account.id)}
              aria-label={t('accounts.actionsMenuAria')}
            >
              <MoreHorizontal size={14} />
            </ButtonBase>
          </div>

          <AccountRowMenu
            account={account}
            isActive={isActive}
            isRefreshing={isRefreshing}
            isMenuOpen={isMenuOpen}
            allowProfileAction={data.allowProfileAction}
            profileSessionPending={data.profileSessionPending}
            profileSessionReady={data.profileSessionReady}
            onCheckStatus={onCheckStatus}
            onOpenBrowser={onOpenBrowser}
            onToggleActive={onToggleActive}
            onToggleAutoRefreshQuota={onToggleAutoRefreshQuota}
            onOpenProfileSession={onOpenProfileSession}
            onConfirmProfileSession={onConfirmProfileSession}
            onClearProfileSession={onClearProfileSession}
            onCopyToken={onCopyToken}
            onShowDetails={onShowDetails}
            onDelete={onDelete}
            onCloseMenu={onCloseMenu}
          />
        </div>
      </TableCell>
    </TableRow>
  );
}
