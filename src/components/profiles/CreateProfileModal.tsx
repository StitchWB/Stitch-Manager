import { useState } from 'react';
import { UserPlus, Video, Wand2 } from 'lucide-react';
import { Button, Input, Modal } from '@/components/ui';
import { EngineToggle } from './EngineToggle';
import { sanitizeAlias } from '@/hooks/useProfileSettingsModal';
import { t } from '@/lib/i18n';
import { type BrowserEngineId } from '@/lib/browser/engines';

export type CreateProfileMode = 'plain' | 'record';

interface CreateProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (alias: string, engine: BrowserEngineId, mode: CreateProfileMode) => Promise<void>;
  shardAvailable?: boolean;
  existingAliases?: string[];
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Human-readable sequential alias: "браузер 1", "браузер 2", … (locale-aware). */
function buildDefaultAlias(prefix: string, existingAliases: string[]): string {
  const re = new RegExp(`^${escapeRegExp(prefix)}[ ._-]?(\\d+)$`, 'i');
  let max = 0;
  for (const alias of existingAliases) {
    const match = re.exec(alias.trim());
    if (match) max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return `${prefix} ${max + 1}`;
}

/**
 * Lightweight "new browser profile" form: alias + engine, with two exits —
 * plain create (opens settings afterwards) or create-and-record (launches the
 * browser with the recorder overlay right away).
 */
/**
 * The form is mounted only while open, so its state resets naturally on every
 * open (no setState-in-effect needed).
 */
export function CreateProfileModal({ isOpen, ...rest }: CreateProfileModalProps) {
  if (!isOpen) return null;
  return <CreateProfileForm {...rest} />;
}

function CreateProfileForm({
  onClose,
  onSubmit,
  shardAvailable = false,
  existingAliases = [],
}: Omit<CreateProfileModalProps, 'isOpen'>) {
  const [alias, setAlias] = useState(() =>
    buildDefaultAlias(t('profiles.create_modal.alias_prefix') || 'browser', existingAliases)
  );
  const [engine, setEngine] = useState<BrowserEngineId>('cloakbrowser');
  const [saving, setSaving] = useState<CreateProfileMode | null>(null);

  const cleanAlias = alias.trim();

  const submit = async (mode: CreateProfileMode) => {
    if (!cleanAlias || saving) return;
    setSaving(mode);
    try {
      await onSubmit(cleanAlias, engine, mode);
      onClose();
    } finally {
      setSaving(null);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('profiles.create_modal.title') || 'New profile'}
      icon={<UserPlus size={16} />}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => void submit('plain')}
            disabled={Boolean(saving) || !cleanAlias}
            isLoading={saving === 'plain'}
          >
            {t('profiles.create_modal.create') || 'Create'}
          </Button>
          <Button
            variant="primary"
            leftIcon={<Video size={14} />}
            onClick={() => void submit('record')}
            disabled={Boolean(saving) || !cleanAlias}
            isLoading={saving === 'record'}
          >
            {t('profiles.create_modal.create_and_record') || 'Create & record scenario'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Input
          label={t('accounts.profileAlias') || 'Profile alias'}
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          placeholder={`${t('profiles.create_modal.alias_prefix') || 'browser'} 1`}
          rightElement={
            <Button
              type="button"
              size="xs"
              variant="secondary"
              leftIcon={<Wand2 size={12} />}
              onClick={() => setAlias(sanitizeAlias(alias))}
              disabled={!cleanAlias}
            >
              {t('accounts.profileSettingsAliasMakeSafe') || 'Make safe'}
            </Button>
          }
        />
        <div className="space-y-1.5">
          <div className="text-xs text-slate-400">{t('accounts.profileEngineLabel') || 'Browser engine'}</div>
          <EngineToggle value={engine} onChange={setEngine} shardAvailable={shardAvailable} size="md" />
        </div>
      </div>
    </Modal>
  );
}
