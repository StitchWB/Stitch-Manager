import { useEffect, useState } from 'react';
import { Pencil, LogOut, Trash2, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import {
  PageHeader,
  TabButton,
  Button,
  OverflowMenu,
  Tooltip,
  EmptyState,
  SkeletonLoader,
} from '@/components/ui';
import type { OverflowMenuItem } from '@/components/ui/OverflowMenu';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { t } from '@/lib/i18n';
import { useGroupsStore } from '@/stores/groups';
import { GroupPoolTab } from './GroupPoolTab';
import { GroupMembersTab } from './GroupMembersTab';
import { GroupSettingsTab } from './GroupSettingsTab';
import { GroupUsageTab } from './GroupUsageTab';

interface GroupDetailProps {
  groupId: string;
  currentUserId: string | null;
  onBack: () => void;
  onDeleted: () => void;
  onLeft: () => void;
}

type DetailTab = 'pool' | 'members' | 'usage' | 'settings';

/**
 * Right pane of the Groups master-detail. Renders a PageHeader with an
 * OverflowMenu (rename/leave/delete gated by ownership and sole-owner
 * guard) and section tabs (Pool / Members / Settings).
 */
export function GroupDetail({ groupId, currentUserId, onBack, onDeleted, onLeft }: GroupDetailProps) {
  const detail = useGroupsStore(s => s.detail);
  const loading = useGroupsStore(s => s.loading);
  const errors = useGroupsStore(s => s.errors);
  const fetchDetail = useGroupsStore(s => s.fetchDetail);
  const leaveGroup = useGroupsStore(s => s.leaveGroup);
  const deleteGroup = useGroupsStore(s => s.deleteGroup);
  const poolCount = useGroupsStore(s => s.pool.length);
  const [tab, setTab] = useState<DetailTab>('pool');

  useEffect(() => {
    fetchDetail(groupId);
  }, [groupId, fetchDetail]);

  const group = detail?.group;
  const isOwner = detail?.is_owner ?? false;
  const members = detail?.members ?? [];
  const soleOwner = isOwner && members.length === 1;

  const handleLeave = async () => {
    if (soleOwner) return;
    const ok = await askConfirm({
      title: t('ai.groups.members.leaveConfirm.title'),
      message: t('ai.groups.members.leaveConfirm.body', { group: group?.name ?? '' }),
      confirmText: t('ai.groups.members.leaveConfirm.confirm'),
      cancelText: t('common.cancel'),
      variant: 'warning',
    });
    if (!ok) return;
    try {
      await leaveGroup(groupId);
      onLeft();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('ai.groups.detailLoadFailed'));
    }
  };

  const handleDelete = async () => {
    const ok = await askConfirm({
      title: t('ai.groups.settings.deleteConfirm.title'),
      message: t('ai.groups.settings.deleteConfirm.body', { group: group?.name ?? '' }),
      confirmText: t('ai.groups.settings.deleteConfirm.confirm'),
      cancelText: t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteGroup(groupId);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('ai.groups.detailLoadFailed'));
    }
  };

  const overflowItems: OverflowMenuItem[] = [
    {
      id: 'rename',
      label: t('ai.groups.actions.rename'),
      icon: <Pencil size={14} />,
      onSelect: () => {
        toast.info(t('ai.groups.actions.deleteViaSettings'));
        setTab('settings');
      },
      disabled: !isOwner,
    },
    {
      id: 'leave',
      label: t('ai.groups.actions.leave'),
      icon: <LogOut size={14} />,
      onSelect: soleOwner ? () => {} : handleLeave,
      disabled: soleOwner,
    },
    {
      id: 'delete',
      label: t('ai.groups.actions.delete'),
      icon: <Trash2 size={14} />,
      onSelect: handleDelete,
      tone: 'danger',
      disabled: !isOwner,
    },
  ];

  if (loading.detail && !detail) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader
          eyebrow={t('sidebar.aiHub')}
          title={t('ai.groups.title')}
          actions={
            <Button size="sm" variant="ghost" onClick={onBack} leftIcon={<ChevronLeft size={14} />}>
              {t('common.back')}
            </Button>
          }
        />
        <div className="flex-1 p-4">
          <SkeletonLoader variant="card" />
        </div>
      </div>
    );
  }

  if (errors.detail || !detail) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader
          eyebrow={t('sidebar.aiHub')}
          title={t('ai.groups.title')}
          actions={
            <Button size="sm" variant="ghost" onClick={onBack} leftIcon={<ChevronLeft size={14} />}>
              {t('common.back')}
            </Button>
          }
        />
        <div className="flex-1 p-4">
          <EmptyState
            icon={Trash2}
            title={t('ai.groups.detailLoadFailed')}
            description={errors.detail ?? undefined}
            action={
              <Button size="sm" variant="ghost" onClick={() => fetchDetail(groupId)}>
                {t('common.retry')}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        eyebrow={t('sidebar.aiHub')}
        title={group?.name ?? t('ai.groups.title')}
        description={t('ai.groups.meta', {
          members: members.length,
          keys: loading.detail && !detail ? '—' : poolCount,
        })}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={onBack} leftIcon={<ChevronLeft size={14} />}>
              {t('common.back')}
            </Button>
            {soleOwner ? (
              <Tooltip content={t('ai.groups.members.leaveConfirm.soleOwner')}>
                <span>
                  <Button size="sm" variant="ghost" disabled leftIcon={<LogOut size={14} />}>
                    {t('ai.groups.actions.leave')}
                  </Button>
                </span>
              </Tooltip>
            ) : null}
            <OverflowMenu
              triggerLabel={t('common.more')}
              size="sm"
              items={overflowItems}
            />
          </>
        }
      />

      {/* Section tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-white/[0.06]">
        <TabButton
          active={tab === 'pool'}
          onClick={() => setTab('pool')}
          appearance="section"
          size="sm"
          label={t('ai.groups.pool.title')}
        />
        <TabButton
          active={tab === 'members'}
          onClick={() => setTab('members')}
          appearance="section"
          size="sm"
          label={t('ai.groups.members.title')}
        />
        <TabButton
          active={tab === 'usage'}
          onClick={() => setTab('usage')}
          appearance="section"
          size="sm"
          label={t('ai.groups.usage.title')}
        />
        <TabButton
          active={tab === 'settings'}
          onClick={() => setTab('settings')}
          appearance="section"
          size="sm"
          label={t('common.settings')}
        />
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-3 md:p-4">
        {tab === 'pool' && <GroupPoolTab groupId={groupId} />}
        {tab === 'members' && (
          <GroupMembersTab
            groupId={groupId}
            isOwner={isOwner}
            currentUserId={currentUserId}
            onLeft={onLeft}
          />
        )}
        {tab === 'usage' && (
          <GroupUsageTab groupId={groupId} isOwner={isOwner} />
        )}
        {tab === 'settings' && (
          <GroupSettingsTab
            groupId={groupId}
            isOwner={isOwner}
            onDeleted={onDeleted}
            onLeft={onLeft}
          />
        )}
      </div>
    </div>
  );
}
