import { useState } from 'react';
import { Users } from 'lucide-react';
import { toast } from 'sonner';
import { Modal, Button, Input } from '@/components/ui';
import { t } from '@/lib/i18n';
import { useGroupsStore } from '@/stores/groups';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Fired when the backend rejects creation due to a tier gate. */
  onTierError?: () => void;
}

/**
 * Modal for creating a new group. On a tier error (403 from the backend),
 * closes itself and fires `onTierError` so the parent can open the
 * HowToGet modal (reusing the scenarios.howToGetTier* pattern).
 */
export function CreateGroupModal({ isOpen, onClose, onTierError }: CreateGroupModalProps) {
  const createGroup = useGroupsStore(s => s.createGroup);
  const loading = useGroupsStore(s => s.loading.action);
  const [name, setName] = useState('');
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

  // Reset the name field when the modal opens (adjusting state during render
  // — the React-docs replacement for setState-in-effect).
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) setName('');
  }

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const group = await createGroup({ name: trimmed });
      toast.success(t('ai.groups.create.success', { name: group.name }));
      onClose();
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err?.status === 403) {
        // Tier gate: vip+ required. Close this modal and let the parent
        // open the HowToGet modal (reuses scenarios.howToGetTier* keys).
        onClose();
        onTierError?.();
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t('ai.groups.create.failed', { msg }));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('ai.groups.create.title')}
      icon={<Users size={18} />}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            isLoading={loading}
            disabled={!name.trim()}
          >
            {t('ai.groups.create.cta')}
          </Button>
        </>
      }
    >
      <Input
        label={t('ai.groups.create.nameLabel')}
        placeholder={t('ai.groups.create.namePh')}
        value={name}
        onChange={e => setName(e.target.value)}
        autoFocus
        containerClassName="mb-2"
        onKeyDown={e => {
          if (e.key === 'Enter' && !loading && name.trim()) {
            void handleSubmit();
          }
        }}
      />
    </Modal>
  );
}
