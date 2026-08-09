import { Play, MoreHorizontal, Key, Copy, Clock, StickyNote } from 'lucide-react';
import {
  Badge,
  type BadgeProps,
  Button,
  ButtonBase,
  Checkbox,
  IconButton,
  TableCell,
  TableRow,
  Tooltip,
  ProviderLogo,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import type { Account } from '@/types/generated';
import type { AccountStatus } from '@/types/ui';
import type { AccountsTableVisibleColumns } from '@/stores/uiPreferences';
import { getAccountStatusLabel } from '@/lib/accountStatus';
import { t } from '@/lib/i18n';
import type { AccountRelationEdge, RelationType } from '@/lib/accounts/relations';
import { useAccountRowData } from '@/hooks/useAccountRow';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { AccountRowMenu } from './AccountRowMenu';
import { AccountQuotaCell } from './AccountQuotaCell';
import { AccountRefCell } from './AccountRefCell';
import { AccountRowQuickActions } from './AccountRowQuickActions';
import { TotpBadge } from '@/components/totp/TotpBadge';
import { useTotpStore } from '@/stores/totp';

interface AccountRowProps {
  account: Account;
  isSelected: boolean;
  isActive: boolean;
  isInspected?: boolean;
  isRefreshing: boolean;
  isMenuOpen: boolean;
  visibleColumns?: AccountsTableVisibleColumns;
  showRefColumn?: boolean;
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
  onAuthorizeKiroAccount?: (accountId: number) => Promise<void>;
  onCopyRefUrl?: (refUrl: string) => Promise<void>;
  onRefreshRefUrl?: (accountId: number) => Promise<void>;
  onRelationEdgeClick?: (edgeType: RelationType, targetProvider: string) => void;
}

export function AccountRow({
  account,
  isSelected,
  isActive,
  isInspected,
  isRefreshing,
  isMenuOpen,
  visibleColumns = { lastLogin: true, apiKey: true, quota: true },
  showRefColumn = true,
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
  onAuthorizeKiroAccount,
  onCopyRefUrl,
  onRefreshRefUrl,
  onRelationEdgeClick,
}: AccountRowProps) {
  const data = useAccountRowData(account, relationHints, relationEdges);
  const { copy } = useCopyToClipboard();
  const allTotpKeys = useTotpStore((s) => s.keys);
  const accountIdStr = String(account.id);
  const totpKeys = allTotpKeys.filter(
    (k) => k.enabled && k.accountId === accountIdStr
  );

  return (
    <TableRow
      className={cn(
        'group/row h-[42px] border-white/[0.04] hover:bg-white/[0.03] transition-colors',
        isSelected && 'bg-indigo-500/10 hover:bg-indigo-500/[0.12]',
        isInspected && 'bg-indigo-950/30 hover:bg-indigo-950/40',
      )}
    >
      {/* Checkbox */}
      <TableCell
        className={cn(
          'sticky left-0 z-10 w-[40px] min-w-[40px] max-w-[40px] px-2 py-1 align-middle bg-vsc-terminal group-hover/row:bg-white/[0.03]',
          isInspected && 'bg-indigo-950/40 border-l-2 border-indigo-500',
        )}
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
      <TableCell className={cn(
        'sticky left-[40px] z-10 w-[80px] min-w-[80px] px-2 py-1 align-middle bg-vsc-terminal group-hover/row:bg-white/[0.03]',
        isInspected && 'bg-indigo-950/40',
      )}>
        <div className="flex items-center gap-1.5 overflow-hidden">
          <ProviderLogo provider={account.provider} size={14} className="shrink-0" />
          <span className="truncate whitespace-nowrap text-[11px] text-slate-300">{data.providerLabel}</span>
        </div>
      </TableCell>

      {/* Account */}
      <TableCell className={cn(
        'sticky left-[120px] z-10 w-[160px] min-w-[160px] max-w-[180px] px-2 py-1 align-middle bg-vsc-terminal group-hover/row:bg-white/[0.03]',
        isInspected && 'bg-indigo-950/40',
      )}>
        <ButtonBase
          type="button"
          onClick={() => onShowDetails(account)}
          className="group/account inline-flex max-w-full flex-col items-start gap-px overflow-hidden text-left"
        >
          <Tooltip
            content={
              <div className="space-y-1 text-[11px]">
                <div className="font-medium text-white">{data.accountIdentifier}</div>
                <div className="text-slate-400">{t('accounts.profileIdLabel')}: {data.profileId}</div>
              </div>
            }
            side="top"
          >
            <span className="w-full truncate text-[13px] font-semibold text-white group-hover/account:text-indigo-200">
              {data.displayAlias}
            </span>
          </Tooltip>
          {/* Subline: method • engine • date • tags • notes */}
          <div className="flex w-full items-center gap-1 text-[10px] text-slate-500">
            {data.registrationMethodLabel && (
              <span className="shrink-0">{data.registrationMethodLabel}</span>
            )}
            {account.browserEngine === 'shardbrowser' && (
              <>
                {data.registrationMethodLabel && <span className="text-slate-600">•</span>}
                <Tooltip content="Зарегистрирован через ShardBrowser (engine-level spoofing)" side="top">
                  <span className="shrink-0 rounded border border-indigo-500/30 bg-indigo-500/10 px-1 py-px text-[9px] font-semibold text-indigo-300">
                    Shard
                  </span>
                </Tooltip>
              </>
            )}
            {data.createdDateShort && (
              <>
                {data.registrationMethodLabel && <span className="text-slate-600">•</span>}
                <span className="shrink-0 tabular-nums">{data.createdDateShort}</span>
              </>
            )}
            {data.visibleTags.length > 0 && (
              <>
                {(data.registrationMethodLabel || data.createdDateShort) && (
                  <span className="text-slate-600">•</span>
                )}
                <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
                  {data.visibleTags.map(tag => (
                    <span
                      key={tag}
                      className="shrink-0 rounded bg-white/[0.06] px-1 py-px text-[9px] text-slate-400"
                    >
                      {tag}
                    </span>
                  ))}
                  {data.remainingTagsCount > 0 && (
                    <span className="shrink-0 text-[9px] text-slate-500">
                      {t('accounts.tagsMore', { count: data.remainingTagsCount })}
                    </span>
                  )}
                </div>
              </>
            )}
            {data.hasNotes && (
              <Tooltip content={t('accounts.notesHasTooltip')} side="top">
                <StickyNote size={10} className="ml-auto shrink-0 text-amber-400/60" />
              </Tooltip>
            )}
          </div>
        </ButtonBase>

        {(data.relationProviderEntries.length > 0 || data.relationHintList.length > 0) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
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

      {/* Quick Actions (visible on hover) */}
      <TableCell
        className="w-[90px] min-w-[90px] px-1 py-1 align-middle"
        onClick={event => event.stopPropagation()}
      >
        <AccountRowQuickActions
          account={account}
          onOpenBrowser={onOpenBrowser}
          onAuthorizeKiroAccount={onAuthorizeKiroAccount}
        />
      </TableCell>

      {/* Status */}
      <TableCell className="w-[70px] min-w-[70px] px-2 py-1 align-middle">
        <Badge
          variant={data.statusVariant as BadgeProps['variant']}
          size="sm"
          className="normal-case tracking-normal border-0 gap-1"
        >
          <span className={cn('w-1.5 h-1.5 rounded-full', data.statusDotColor)} />
          {getAccountStatusLabel(account.status as AccountStatus)}
        </Badge>
      </TableCell>

      {/* Last Login */}
      <TableCell
        className={cn(
          visibleColumns.lastLogin
            ? 'w-[120px] min-w-[120px] px-2 py-1 align-middle text-[11px] text-slate-400'
            : 'hidden'
        )}
      >
        {data.hasLastLogin && data.lastLoginRelative ? (
          <div className="flex items-center gap-1">
            <Clock size={10} className="shrink-0 text-slate-600" />
            <span className="truncate tabular-nums">{data.lastLoginRelative}</span>
          </div>
        ) : (
          <Tooltip content={t('accounts.never')} side="top">
            <span className="text-slate-600">—</span>
          </Tooltip>
        )}
      </TableCell>

      {/* Password / Token */}
      <TableCell
        className={cn(
          visibleColumns.apiKey ? 'w-[70px] min-w-[70px] px-2 py-1 align-middle' : 'hidden'
        )}
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center gap-1">
          {account.registrationPassword ? (
            <Tooltip content={t('accounts.quickActions.copyPassword')} side="top">
              <IconButton
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void copy(account.registrationPassword!, {
                    sensitive: true,
                    successMessage: t('accounts.quickActions.passwordCopied'),
                  });
                }}
                size="sm"
                variant="ghost"
                className="inline-flex items-center justify-center rounded p-1 hover:bg-white/10 transition-colors"
              >
                <Key size={13} className="text-amber-400 hover:text-amber-300" />
              </IconButton>
            </Tooltip>
          ) : null}
          {account.token ? (
            <Tooltip content={t('accounts.copyToken')} side="top">
              <IconButton
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void copy(account.token!, {
                    sensitive: true,
                    successMessage: t('accounts.tokenCopied'),
                  });
                }}
                size="sm"
                variant="ghost"
                className="inline-flex items-center justify-center rounded p-1 hover:bg-white/10 transition-colors"
              >
                <Copy size={13} className="text-emerald-400 hover:text-emerald-300" />
              </IconButton>
            </Tooltip>
          ) : null}
          {!account.registrationPassword && !account.token ? (
            <Tooltip content={t('accounts.notAvailable')} side="top">
              <span className="text-slate-600">—</span>
            </Tooltip>
          ) : null}
        </div>
      </TableCell>

      {/* Quota */}
      <TableCell
        className={cn(
          visibleColumns.quota ? 'w-[80px] min-w-[80px] px-2 py-1 align-middle' : 'hidden'
        )}
      >
        <AccountQuotaCell account={account} onCheckStatus={onCheckStatus} />
      </TableCell>

      {/* 2FA TOTP code — shown only when this account has linked TOTP keys */}
      {totpKeys.length > 0 && (
        <TableCell className="w-[100px] min-w-[100px] px-2 py-1 align-middle" onClick={(e) => e.stopPropagation()}>
          <TotpBadge
            secret={totpKeys[0].secret}
            period={totpKeys[0].period}
            variant="compact"
          />
        </TableCell>
      )}
      {totpKeys.length === 0 && (
        <TableCell className="w-[100px] min-w-[100px] px-2 py-1 align-middle" />
      )}

      {/* Referral quota */}
      <AccountRefCell account={account} hidden={!showRefColumn} />

      {/* Actions */}
      <TableCell
        className={cn(
          'sticky right-0 z-10 w-[48px] min-w-[48px] max-w-[48px] px-1 py-1 align-middle bg-vsc-terminal group-hover/row:bg-white/[0.03]',
          isInspected && 'bg-indigo-950/40',
        )}
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
            onAuthorizeKiroAccount={onAuthorizeKiroAccount}
            onCopyRefUrl={onCopyRefUrl}
            onRefreshRefUrl={onRefreshRefUrl}
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
