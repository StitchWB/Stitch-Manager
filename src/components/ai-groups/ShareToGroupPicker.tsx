import { useEffect, useMemo, useState } from 'react';
import { Share2 } from 'lucide-react';
import { Modal, Button, Checkbox, EmptyState } from '@/components/ui';
import { t } from '@/lib/i18n';
import { useGroupsStore } from '@/stores/groups';

export interface ShareToGroupPickerProps {
  isOpen: boolean;
  onClose: () => void;
  /** Group ids the row is already shared into (pre-checked). */
  alreadySharedIds: string[];
  /** Called with (toShare, toUnshare) diffs on Apply. */
  onApply: (toShareIds: string[], toUnshareIds: string[]) => void;
  /** Disables the Apply button + checkboxes while the caller runs share/unshare. */
  busy?: boolean;
  /** Translated modal title (caller picks TOTP vs proxy wording). */
  title: string;
}

/**
 * Modal picker for sharing a TOTP key or proxy entry into one or more of the
 * caller's groups. Renders a checkbox list of groups from the groups store;
 * pre-checks the ones in ``alreadySharedIds`` and computes the share/unshare
 * diff on Apply. No consent flow — TOTP/proxy secrets are already visible
 * only to the row owner; sharing is an explicit owner action.
 */
export function ShareToGroupPicker({
  isOpen,
  onClose,
  alreadySharedIds,
  onApply,
  busy = false,
  title,
}: ShareToGroupPickerProps) {
  const { groups, loading, fetchList } = useGroupsStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset selection to the already-shared set whenever the picker opens.
  useEffect(() => {
    if (isOpen) {
      // Deferred: setSelected synchronously in the effect body triggers
      // the set-state-in-effect rule; queueMicrotask defers it past the
      // commit phase (same pattern as ProxyLibrarySection.tsx).
      queueMicrotask(() => {
        setSelected(new Set(alreadySharedIds));
      });
      // Ensure the group list is fresh.
      void fetchList();
    }
  }, [isOpen, alreadySharedIds, fetchList]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = () => {
    const initial = new Set(alreadySharedIds);
    const toShare: string[] = [];
    const toUnshare: string[] = [];
    for (const id of selected) {
      if (!initial.has(id)) toShare.push(id);
    }
    for (const id of initial) {
      if (!selected.has(id)) toUnshare.push(id);
    }
    onApply(toShare, toUnshare);
  };

  const hasChanges = useMemo(() => {
    const initial = new Set(alreadySharedIds);
    if (selected.size !== initial.size) return true;
    for (const id of selected) {
      if (!initial.has(id)) return true;
    }
    return false;
  }, [selected, alreadySharedIds]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      icon={<Share2 size={16} className="text-indigo-400" />}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleApply} disabled={busy || !hasChanges}>
            {busy ? t('common.saving') : t('ai.groups.share.apply')}
          </Button>
        </div>
      }
    >
      <p className="text-xs text-slate-400 mb-3">{t('ai.groups.share.hint')}</p>
      {loading.list ? (
        <div className="text-sm text-slate-400 py-4">{t('common.loading')}</div>
      ) : groups.length === 0 ? (
        <EmptyState
          compact
          icon={Share2}
          title={t('ai.groups.empty.title')}
          description={t('ai.groups.empty.desc')}
        />
      ) : (
        <div className="space-y-0.5 max-h-64 overflow-y-auto">
          {groups.map((g) => (
            <Checkbox
              key={g.id}
              checked={selected.has(g.id)}
              onChange={() => toggle(g.id)}
              disabled={busy}
              label={g.name}
              description={t('ai.groups.meta', { members: g.member_count, keys: g.key_count })}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}
