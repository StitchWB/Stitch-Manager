import {
  Check,
  Copy,
  Globe,
  Info,
  MoreHorizontal,
  Play,
  RefreshCw,
  Square,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { Badge, Button, ButtonBase, Checkbox, TableCell, TableRow, Tooltip } from '../ui';
import { ProviderLogo } from '../ui/ProviderLogo';
import { cn } from '../../lib/utils';
import type { Account, AccountStatus } from '../../types';
import type { AccountRelationEdge, RelationType } from '../../lib/accounts/relations';
import type { AccountsTableVisibleColumns } from '../../stores/uiPreferences';
import { providerLabelToKey } from '../../lib/accounts/relations';
import { getAccountStatusLabel } from '../../lib/accountStatus';
import { t } from '../../lib/i18n';
import { formatProfileAlias } from '../../lib/profiles/displayName';

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
  onOpenProfileSession?: (accountId: number) => Promise<void>;
  onConfirmProfileSession?: (accountId: number) => Promise<void>;
  onClearProfileSession?: (accountId: number) => Promise<void>;
  onRelationEdgeClick?: (edgeType: RelationType, targetProvider: string) => void;
}

const statusVariantMap: Record<AccountStatus, 'success' | 'warning' | 'danger' | 'outline'> = {
  active: 'success',
  banned: 'danger',
  limit_hit: 'warning',
  expired: 'outline',
  unknown: 'outline',
};

const providerLabelMap: Record<string, string> = {
  aws_builder_id: 'AWS Builder ID',
};

function parseJsonValue(input: string | null): Record<string, unknown> {
  if (!input) return {};
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore invalid json
  }
  return {};
}

function parseTags(tagsString: string | null): string[] {
  if (!tagsString) return [];
  try {
    const parsed = JSON.parse(tagsString);
    return Array.isArray(parsed) ? parsed.filter(tag => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

function getAlias(account: Account): string {
  const metadata = parseJsonValue(account.metadata);
  const aliasRaw = metadata.alias ?? metadata.name;
  if (typeof aliasRaw === 'string' && aliasRaw.trim()) {
    return aliasRaw.trim();
  }
  const [emailPrefix] = account.email.split('@');
  return emailPrefix || account.email;
}

function getProfileId(account: Account): string {
  if (account.browserProfilePath && account.browserProfilePath.trim())
    return account.browserProfilePath;
  if (account.machineId && account.machineId.trim()) return account.machineId;
  return `account-${account.id}`;
}

function getProxyValue(account: Account): string {
  const metadata = parseJsonValue(account.metadata);
  const providerMeta = parseJsonValue(account.providerMetadata);

  const directProxy =
    metadata.proxy ?? metadata.proxyUrl ?? providerMeta.proxy ?? providerMeta.proxyUrl;
  if (typeof directProxy === 'string' && directProxy.trim()) {
    return directProxy.trim();
  }

  const metadataNetwork = metadata.network;
  if (metadataNetwork && typeof metadataNetwork === 'object') {
    const proxy = (metadataNetwork as Record<string, unknown>).proxy;
    if (proxy && typeof proxy === 'object') {
      const url = (proxy as Record<string, unknown>).url;
      if (typeof url === 'string' && url.trim()) return url.trim();
    }
  }

  return '—';
}

function formatLastLogin(account: Account): string {
  const rawDate = account.lastLoginAt ?? account.lastUsedAt ?? account.updatedAt;
  if (!rawDate) return '—';
  const parsedDate = new Date(rawDate);
  if (Number.isNaN(parsedDate.getTime())) return '—';
  return parsedDate.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AccountRow({
  account,
  isSelected,
  isActive,
  isRefreshing,
  isMenuOpen,
  visibleColumns = { lastLogin: true, proxy: true, tags: true },
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
  onOpenProfileSession,
  onConfirmProfileSession,
  onClearProfileSession,
  onRelationEdgeClick,
}: AccountRowProps) {
  const alias = getAlias(account);
  const displayAlias = formatProfileAlias(alias);
  const profileId = getProfileId(account);
  const status = account.status as AccountStatus;
  const tags = parseTags(account.tags);
  const visibleTags = tags.slice(0, 2);
  const remainingTagsCount = Math.max(0, tags.length - visibleTags.length);
  const proxyValue = getProxyValue(account);
  const providerLabel = providerLabelMap[account.provider] ?? account.provider;
  const accountIdentifier = account.email;

  const profileSessionReady = tags.some(tag => tag.startsWith('profile:'));
  const profileSessionPending = tags.includes('profile:pending');
  const allowProfileAction =
    account.provider === 'kiro' ||
    tags.includes('profile:manual') ||
    tags.includes('profile:antidetect');
  const relationHintList = relationHints ?? [];
  const relationEdgeList = relationEdges ?? [];
  const relationProviderEntries = Array.from(
    relationEdgeList.reduce((map, edge) => {
      const providerKey = providerLabelToKey(edge.targetProvider);
      if (!providerKey) return map;

      const existing = map.get(providerKey);
      if (!existing || (!existing.explicit && edge.explicit)) {
        map.set(providerKey, edge);
      }

      return map;
    }, new Map<string, AccountRelationEdge>())
  );

  return (
    <TableRow
      className={cn(
        'group/row h-14 border-white/[0.04] hover:bg-white/[0.02]',
        isSelected && 'bg-indigo-500/10'
      )}
    >
      <TableCell
        className="w-[44px] px-3 py-3 align-middle"
        onClick={event => event.stopPropagation()}
      >
        <Checkbox
          checked={isSelected}
          onChange={() => onToggleSelection(account.id)}
          className="p-0 hover:bg-transparent"
          aria-label={t('accounts.selectAccountAria', { email: account.email })}
        />
      </TableCell>

      <TableCell className="w-[130px] px-2 py-3 align-middle">
        <div className="flex items-center gap-2.5">
          <ProviderLogo provider={account.provider} size={14} className="shrink-0" />
          <span className="text-xs text-slate-300">{providerLabel}</span>
        </div>
      </TableCell>

      <TableCell className="w-[280px] px-2 py-3 align-middle">
        <ButtonBase
          type="button"
          onClick={() => onShowDetails(account)}
          className="group/account inline-flex max-w-full flex-col items-start text-left"
        >
          <span className="max-w-full truncate text-sm font-semibold text-white group-hover/account:text-indigo-200">
            {displayAlias}
          </span>
          {displayAlias !== alias ? (
            <span className="max-w-full truncate font-mono text-[10px] text-slate-500">
              {alias}
            </span>
          ) : null}
          <Tooltip
            content={
              <div className="space-y-1 text-[11px]">
                <div className="font-medium text-white">{accountIdentifier}</div>
                <div className="text-slate-400">
                  {t('accounts.profileIdLabel')}: {profileId}
                </div>
              </div>
            }
            side="top"
          >
            <span className="max-w-[240px] truncate font-mono text-xs text-slate-500">
              {accountIdentifier}
            </span>
          </Tooltip>
        </ButtonBase>
        {(relationProviderEntries.length > 0 || relationHintList.length > 0) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
            <span className="uppercase tracking-wider text-[9px] text-slate-600">
              {t('accounts.relationLabel')}
            </span>
            <div className="flex items-center gap-1">
              {relationProviderEntries.slice(0, 4).map(([providerKey, edge]) => (
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
            {relationHintList.slice(0, 2).map(hint => (
              <span
                key={`${account.id}-${hint}`}
                className="rounded border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] text-cyan-200"
              >
                {hint}
              </span>
            ))}
          </div>
        )}
      </TableCell>

      <TableCell className="w-[110px] px-2 py-3 align-middle">
        <Badge
          variant={statusVariantMap[status]}
          size="sm"
          className="normal-case tracking-normal border-0"
        >
          {getAccountStatusLabel(status)}
        </Badge>
      </TableCell>

      <TableCell
        className={cn(
          visibleColumns.lastLogin
            ? 'hidden w-[134px] px-2 py-3 align-middle text-xs text-slate-300 tabular-nums md:table-cell'
            : 'hidden'
        )}
      >
        {formatLastLogin(account)}
      </TableCell>

      <TableCell
        className={cn(
          visibleColumns.proxy ? 'hidden w-[170px] px-2 py-3 align-middle lg:table-cell' : 'hidden'
        )}
      >
        <Tooltip content={proxyValue} side="top">
          <span className="block truncate font-mono text-xs text-slate-200">{proxyValue}</span>
        </Tooltip>
      </TableCell>

      <TableCell
        className={cn(
          visibleColumns.tags ? 'hidden w-[150px] px-2 py-3 align-middle lg:table-cell' : 'hidden'
        )}
      >
        <div className="flex items-center gap-1.5">
          {visibleTags.length > 0 ? (
            visibleTags.map(tag => (
              <Badge
                key={`${account.id}-${tag}`}
                variant="outline"
                size="sm"
                className="max-w-[92px] truncate border-white/10 bg-white/[0.02] normal-case tracking-normal"
              >
                {tag}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-slate-500">—</span>
          )}
          {remainingTagsCount > 0 ? (
            <span className="text-xs text-slate-500">+{remainingTagsCount}</span>
          ) : null}
        </div>
      </TableCell>

      <TableCell
        className="w-[112px] px-2 py-3 align-middle"
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
              size="xs"
              variant="outline"
              className="hidden h-7 border-white/15 bg-transparent px-2.5 text-xs text-slate-300 hover:border-white/30 hover:bg-white/[0.04] hover:text-white sm:inline-flex"
              leftIcon={<Play size={12} />}
              onClick={() => {
                void onLaunch(account);
                onCloseMenu();
              }}
            >
              {t('common.start')}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="inline-flex h-7 w-7 border-white/15 bg-transparent text-slate-300 hover:border-white/30 hover:bg-white/[0.04] hover:text-white sm:hidden"
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

          {isMenuOpen ? (
            <div
              className="absolute right-0 top-8 z-50 w-56 rounded-lg border border-white/10 bg-[#0f1218] p-1 shadow-xl shadow-black/50"
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
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}
