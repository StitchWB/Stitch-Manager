import { useEffect, useState, useCallback } from 'react';
import { KeyRound, Plus } from 'lucide-react';
import { GlassCard, Badge, EmptyState, SkeletonLoader, OverflowMenu, ProviderLogo, Button, Modal, Select } from '@/components/ui';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { appToast } from '@/lib/observability/toast';
import { t } from '@/lib/i18n';
import { useGroupsStore } from '@/stores/groups';
import { useAiGatewayStore } from '@/stores/aiGateway';
import { groupsUnshareCredential } from '@/lib/backend/modules/groups';
import type { PoolItem } from '@/lib/backend/modules/groups';
import type { ProviderEndpoint } from '@/lib/backend/modules/aiGateway';
import { CredentialForm } from '@/components/ai-gateway/CredentialForm';

interface GroupPoolTabProps {
  groupId: string;
  /** Lifted to the parent (GroupDetail) so the header can show the real key count. */
  onPoolCountChange?: (count: number) => void;
}

function statusBadgeVariant(status: string): 'success' | 'warning' | 'danger' | 'default' | 'outline' {
  switch (status) {
    case 'active':
      return 'success';
    case 'cooldown':
    case 'rate_limited':
    case 'degraded':
      return 'warning';
    case 'quota_exhausted':
    case 'auth_failed':
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
  };
  return t(map[status] ?? 'aiGateway.status.unknown');
}

/**
 * Group pool tab. Reads groups_pool_list and renders rows with functional
 * OverflowMenu actions (enable/disable, unshare). "Добавить ключ" opens a
 * CredentialForm modal pre-seeded with the current group for sharing.
 */
export function GroupPoolTab({ groupId, onPoolCountChange }: GroupPoolTabProps) {
  const { pool, loading, errors, fetchPool } = useGroupsStore();
  const { endpoints, fetchEndpoints, updateCredential } = useAiGatewayStore();

  // ── Add-key modal state ──────────────────────────────────────────────────
  const [addKeyOpen, setAddKeyOpen] = useState(false);
  const [pickedEndpoint, setPickedEndpoint] = useState<ProviderEndpoint | null>(null);

  useEffect(() => {
    fetchPool(groupId);
  }, [groupId, fetchPool]);

  // Lift the pool count so GroupDetail's header shows the real number.
  useEffect(() => {
    onPoolCountChange?.(pool.length);
  }, [pool.length, onPoolCountChange]);

  // ── OverflowMenu: toggle enabled ─────────────────────────────────────────
  const handleToggleEnabled = useCallback(async (item: PoolItem) => {
    try {
      await updateCredential({ id: item.credential_id, enabled: !item.enabled });
      await fetchPool(groupId);
      appToast.success(t('ai.groups.pool.toggled'), 'ai-groups');
    } catch (e) {
      appToast.error(e instanceof Error ? e.message : t('ai.groups.detailLoadFailed'), 'ai-groups');
    }
  }, [updateCredential, fetchPool, groupId]);

  // ── OverflowMenu: unshare from group ─────────────────────────────────────
  const handleUnshare = useCallback(async (item: PoolItem) => {
    const ok = await askConfirm({
      title: t('ai.groups.unshare.confirm.title'),
      message: t('ai.groups.unshare.confirm.body', { group: '' }),
      confirmText: t('ai.groups.unshare.confirm.confirm'),
      cancelText: t('common.cancel'),
      variant: 'warning',
    });
    if (!ok) return;
    try {
      await groupsUnshareCredential({ credentialId: item.credential_id, groupId });
      await fetchPool(groupId);
      appToast.success(t('ai.groups.pool.unshared'), 'ai-groups');
    } catch (e) {
      appToast.error(e instanceof Error ? e.message : t('ai.groups.detailLoadFailed'), 'ai-groups');
    }
  }, [fetchPool, groupId]);

  // ── Add-key flow ─────────────────────────────────────────────────────────
  const openAddKey = useCallback(() => {
    if (endpoints.length === 0) {
      void fetchEndpoints();
    }
    setPickedEndpoint(null);
    setAddKeyOpen(true);
  }, [endpoints.length, fetchEndpoints]);

  const closeAddKey = useCallback(() => {
    setAddKeyOpen(false);
    setPickedEndpoint(null);
  }, []);

  const handleAddKeySuccess = useCallback(() => {
    void fetchPool(groupId);
    appToast.success(t('ai.groups.pool.added'), 'ai-groups');
  }, [fetchPool, groupId]);

  return (
    <GlassCard className="p-3 md:p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-semibold text-slate-100 truncate">
            {t('ai.groups.pool.title')}
          </h3>
          <Badge variant="slate" size="sm">
            {pool.length}
          </Badge>
        </div>
        <Button size="sm" variant="secondary" onClick={openAddKey} leftIcon={<Plus size={14} />}>
          {t('ai.groups.pool.addKey')}
        </Button>
      </div>

      {/* Body */}
      {loading.pool ? (
        <div className="space-y-2">
          <SkeletonLoader variant="rectangle" height="h-14" count={3} />
        </div>
      ) : errors.pool ? (
        <EmptyState
          compact
          icon={KeyRound}
          title={t('ai.groups.detailLoadFailed')}
        />
      ) : pool.length === 0 ? (
        <EmptyState
          compact
          icon={KeyRound}
          title={t('ai.groups.pool.empty')}
        />
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {pool.map((item: PoolItem) => (
            <div
              key={item.credential_id}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-1 py-2.5"
            >
              <div className="min-w-0 flex flex-col gap-1">
                <div className="flex items-center gap-2 min-w-0">
                  <ProviderLogo provider={item.adapter_type} size={18} />
                  <span className="text-sm text-slate-100 truncate">
                    {item.label || item.endpoint_name}
                  </span>
                  <Badge variant={statusBadgeVariant(item.runtime_status)} size="sm">
                    {statusLabel(item.runtime_status)}
                  </Badge>
                  {!item.enabled && (
                    <Badge variant="default" size="sm">
                      {t('aiGateway.disabled')}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-500 min-w-0">
                  <span className="truncate">
                    {t('ai.groups.pool.addedBy', { username: item.contributor_username })}
                  </span>
                  <span className="font-mono text-slate-600 truncate" title={item.masked_secret}>
                    {item.masked_secret}
                  </span>
                </div>
              </div>
              <div className="flex items-center">
                <OverflowMenu
                  triggerLabel={t('common.more')}
                  size="sm"
                  items={[
                    {
                      id: 'toggle-enabled',
                      label: item.enabled
                        ? t('ai.groups.pool.disable')
                        : t('ai.groups.pool.enable'),
                      onSelect: () => void handleToggleEnabled(item),
                      disabled: !item.can_manage,
                    },
                    {
                      id: 'unshare',
                      label: t('ai.groups.pool.unshareFromGroup'),
                      onSelect: () => void handleUnshare(item),
                      disabled: !item.can_unshare,
                      tone: 'danger',
                    },
                  ]}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Add-key modal: endpoint picker → CredentialForm ─────────────────── */}
      <Modal
        isOpen={addKeyOpen && !pickedEndpoint}
        onClose={closeAddKey}
        title={t('ai.groups.pool.addKey')}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeAddKey}>{t('common.cancel')}</Button>
          </div>
        }
      >
        {endpoints.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">
            {t('ai.groups.pool.noEndpoints')}
          </p>
        ) : (
          <div>
            <label className="text-sm font-medium">{t('ai.groups.pool.selectEndpoint')}</label>
            <Select
              value={pickedEndpoint?.id ?? ''}
              onValueChange={(val) => {
                const ep = endpoints.find(e => e.id === val) ?? null;
                setPickedEndpoint(ep);
              }}
            >
              {endpoints.map(ep => (
                <option key={ep.id} value={ep.id}>{ep.name}</option>
              ))}
            </Select>
          </div>
        )}
      </Modal>

      {/* CredentialForm (its own Modal) — rendered once an endpoint is picked */}
      {pickedEndpoint && addKeyOpen && (
        <CredentialForm
          endpoint={pickedEndpoint}
          open={addKeyOpen}
          onClose={closeAddKey}
          onSuccess={handleAddKeySuccess}
          initialShareGroupIds={[groupId]}
        />
      )}
    </GlassCard>
  );
}
