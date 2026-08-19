import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  GlassCard,
  Button,
  Input,
  KeyValueList,
} from '@/components/ui';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { t } from '@/lib/i18n';
import { useGroupsStore } from '@/stores/groups';

interface GroupSettingsTabProps {
  groupId: string;
  isOwner: boolean;
  onDeleted?: () => void;
  onLeft?: () => void;
}

/**
 * Settings tab. Owner sees the rename form (dirty indicator + Save) and
 * the danger zone (delete ConfirmDialog). Members see a read-only
 * KeyValueList summary plus a Leave button (Leave is also rendered in
 * the Members tab; this is the secondary surface).
 */
export function GroupSettingsTab({ groupId, isOwner, onDeleted, onLeft }: GroupSettingsTabProps) {
  const { detail, updateGroup, deleteGroup, leaveGroup, fetchDetail } = useGroupsStore();
  const [nameDraft, setNameDraft] = useState('');
  const [prevGroupName, setPrevGroupName] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const group = detail?.group;

  // Adjust nameDraft when the group name changes (replaces useEffect pattern).
  if (group?.name !== prevGroupName) {
    setPrevGroupName(group?.name);
    setNameDraft(group?.name ?? '');
  }

  // Fetch detail if missing (store action — no local setState in effect body).
  useEffect(() => {
    if (!detail && groupId) {
      void fetchDetail(groupId);
    }
  }, [detail, groupId, fetchDetail]);

  const dirty = nameDraft.trim() !== (group?.name ?? '') && nameDraft.trim().length > 0;

  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      await updateGroup({ groupId, name: nameDraft.trim() });
      toast.success(t('ai.groups.settings.saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('ai.groups.detailLoadFailed'));
    } finally {
      setSaving(false);
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
      onDeleted?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('ai.groups.detailLoadFailed'));
    }
  };

  const handleLeave = async () => {
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
      onLeft?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('ai.groups.detailLoadFailed'));
    }
  };

  const metaRows = detail
    ? [
        { id: 'created', label: t('common.history'), value: group?.created_at ?? '—' },
        { id: 'members', label: t('ai.groups.members.title'), value: detail.members.length },
        { id: 'gid', label: 'ID', value: group?.id ?? '—' },
      ]
    : [];

  return (
    <GlassCard className="p-4 md:p-5">
      {isOwner ? (
        <>
          {/* Rename form */}
          <div className="mb-4">
            <Input
              label={t('ai.groups.settings.nameLabel')}
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              containerClassName="mb-2"
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={handleSave}
                isLoading={saving}
                disabled={!dirty}
              >
                {t('ai.groups.settings.save')}
              </Button>
              {dirty && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
              )}
            </div>
          </div>

          {/* Meta */}
          <KeyValueList rows={metaRows} density="comfortable" className="mb-4" />

          {/* Danger zone */}
          <div className="border-t border-red-500/20 pt-4 mt-4">
            <GlassCard className="p-3 border-red-500/20">
              <h4 className="text-sm font-semibold text-red-300 mb-2">
                {t('ai.groups.actions.delete')}
              </h4>
              <Button size="sm" variant="danger" onClick={handleDelete}>
                {t('ai.groups.actions.delete')}
              </Button>
            </GlassCard>
          </div>
        </>
      ) : (
        <>
          {/* Read-only summary for members */}
          <KeyValueList rows={metaRows} density="comfortable" className="mb-4" />
          <div className="border-t border-white/[0.06] pt-4 mt-4">
            <Button size="sm" variant="ghost" onClick={handleLeave}>
              {t('ai.groups.actions.leave')}
            </Button>
          </div>
        </>
      )}
    </GlassCard>
  );
}
