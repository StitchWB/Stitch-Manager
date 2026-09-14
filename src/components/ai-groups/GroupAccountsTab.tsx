import { useEffect, useState, useCallback } from 'react';
import { Users } from 'lucide-react';
import {
  GlassCard,
  Badge,
  EmptyState,
  SkeletonLoader,
  OverflowMenu,
  ProviderLogo,
} from '@/components/ui';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { appToast } from '@/lib/observability/toast';
import { t } from '@/lib/i18n';
import { listGroupAccounts, unshareAccount } from '@/lib/backend/modules/groups';
import type { GroupAccountItem } from '@/lib/backend/modules/groups';
import { deleteAccount } from '@/lib/backend/modules/accounts';

interface GroupAccountsTabProps {
  groupId: string;
}

function statusBadgeVariant(
  status: string,
): 'success' | 'warning' | 'danger' | 'default' | 'outline' {
  switch (status) {
    case 'active':
    case 'ok':
      return 'success';
    case 'cooldown':
    case 'rate_limited':
    case 'degraded':
    case 'expiring':
      return 'warning';
    case 'quota_exhausted':
    case 'auth_failed':
    case 'expired':
    case 'error':
      return 'danger';
    case 'disabled':
      return 'default';
    default:
      return 'outline';
  }
}

function statusLabel(status: string): string {
  // Reuse the existing aiGateway.status.* keys (already present in ru/en).
  const map: Record<string, string> = {
    active: 'aiGateway.status.active',
    cooldown: 'aiGateway.status.cooldown',
    rate_limited: 'aiGateway.status.rateLimited',
    quota_exhausted: 'aiGateway.status.quotaExhausted',
    auth_failed: 'aiGateway.status.authFailed',
    degraded: 'aiGateway.status.degraded',
    disabled: 'aiGateway.status.disabled',
    expired: 'aiGateway.status.quotaExhausted',
    expiring: 'aiGateway.status.degraded',
    error: 'aiGateway.status.authFailed',
    ok: 'aiGateway.status.active',
  };
  return t(map[status] ?? 'aiGateway.status.unknown');
}

/**
 * Group accounts tab. Reads ``groups_list_accounts`` and renders rows with
 * per-row actions gated by the backend-computed ``canRemoveShare`` /
 * ``canDelete`` flags. Remove-share calls ``groups_unshare_account``;
 * delete reuses the SAME ``deleteAccount`` wrapper the Accounts page
 * uses (from ``@/lib/backend/modules/accounts``) — no duplication.
 */
export function GroupAccountsTab({ groupId }: GroupAccountsTabProps) {
  const [items, setItems] = useState<GroupAccountItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listGroupAccounts(groupId);
      setItems(res.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  // Initial fetch on mount / groupId change. Inline the promise chain
  // (matching GroupUsageTab) so no setState fires synchronously in the
  // effect body — the initial `loading` state is already `true`.
  useEffect(() => {
    let cancelled = false;
    listGroupAccounts(groupId)
      .then(res => {
        if (!cancelled) {
          setItems(res.items ?? []);
          setError(null);
        }
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  // ── Remove share: unshare the account from this group ────────────────────
  const handleRemoveShare = useCallback(
    async (item: GroupAccountItem) => {
      const ok = await askConfirm({
        title: t('ai.groups.removeShare'),
        message: t('common.sure'),
        confirmText: t('ai.groups.unshare.confirm.confirm'),
        cancelText: t('common.cancel'),
        variant: 'warning',
      });
      if (!ok) return;
      try {
        await unshareAccount(groupId, item.id);
        await fetchAccounts();
        appToast.success(t('ai.groups.removeShare'), 'ai-groups');
      } catch (e) {
        appToast.error(
          e instanceof Error ? e.message : t('ai.groups.detailLoadFailed'),
          'ai-groups',
        );
      }
    },
    [fetchAccounts, groupId],
  );

  // ── Delete account: reuse the Accounts page deleteAccount wrapper ────────
  const handleDelete = useCallback(
    async (item: GroupAccountItem) => {
      const ok = await askConfirm({
        title: t('accounts.deleteAccountTitle'),
        message: t('accounts.deleteAccountMessage'),
        confirmText: t('common.delete'),
        cancelText: t('common.cancel'),
        variant: 'danger',
      });
      if (!ok) return;
      try {
        await deleteAccount({ accountId: item.id });
        await fetchAccounts();
        appToast.success(
          t('accounts.controller.toasts.accountDeleted'),
          'ai-groups',
        );
      } catch (e) {
        appToast.error(
          e instanceof Error ? e.message : t('ai.groups.detailLoadFailed'),
          'ai-groups',
        );
      }
    },
    [fetchAccounts],
  );

  return (
    <GlassCard className="p-3 md:p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-slate-100 truncate">
            {t('ai.groups.tabAccounts')}
          </h3>
          <Badge variant="slate" size="sm">
            {items.length}
          </Badge>
        </div>
      </div>

      {/* Hint */}
      {!loading && !error && (
        <p className="text-[11px] text-slate-500 mb-3">
          {t('ai.groups.accountsHint')}
        </p>
      )}

      {/* Body */}
      {loading ? (
        <div className="space-y-2">
          <SkeletonLoader variant="rectangle" height="h-14" count={3} />
        </div>
      ) : error ? (
        <EmptyState
          compact
          icon={Users}
          title={t('ai.groups.detailLoadFailed')}
          description={error}
        />
      ) : items.length === 0 ? (
        <EmptyState
          compact
          icon={Users}
          title={t('ai.groups.accountsEmpty')}
          description={t('ai.groups.accountsHint')}
        />
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {items.map((item: GroupAccountItem) => (
            <div
              key={item.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-1 py-2.5"
            >
              <div className="min-w-0 flex flex-col gap-1">
                <div className="flex items-center gap-2 min-w-0">
                  <ProviderLogo provider={item.provider} size={18} />
                  <span className="text-sm text-slate-100 truncate">
                    {item.email}
                  </span>
                  <Badge variant={statusBadgeVariant(item.status)} size="sm">
                    {statusLabel(item.status)}
                  </Badge>
                  {item.quotaUsedPercent != null && (
                    <Badge variant="slate" size="sm">
                      {item.quotaUsedPercent}%
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-500 min-w-0">
                  <span className="truncate">
                    {t('ai.groups.role.owner')}: {item.ownerUsername}
                  </span>
                  <span className="text-slate-600">·</span>
                  <span className="truncate">
                    {t('ai.groups.pool.addedBy', {
                      username: item.sharedByUsername,
                    })}
                  </span>
                </div>
              </div>
              <div className="flex items-center">
                <OverflowMenu
                  triggerLabel={t('common.more')}
                  size="sm"
                  items={[
                    {
                      id: 'remove-share',
                      label: t('ai.groups.removeShare'),
                      onSelect: () => void handleRemoveShare(item),
                      disabled: !item.canRemoveShare,
                    },
                    {
                      id: 'delete-account',
                      label: t('common.delete'),
                      onSelect: () => void handleDelete(item),
                      disabled: !item.canDelete,
                      tone: 'danger',
                    },
                  ]}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
