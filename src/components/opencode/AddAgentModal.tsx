import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import { Bot } from 'lucide-react';
import { Modal, Button, Input } from '@/components/ui';
import { ButtonBase } from '@/components/ui/ButtonBase';

interface AddAgentModalProps {
  isOpen: boolean;
  existingIds: string[];
  onAdd: (id: string) => void;
  onClose: () => void;
}

const SUGGESTIONS = ['build', 'plan', 'general', 'explore', 'review', 'debug'];

export function AddAgentModal({ isOpen, existingIds, onAdd, onClose }: AddAgentModalProps) {
  const [id, setId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    // Deferred reset: synchronous setState inside the effect body is forbidden.
    queueMicrotask(() => {
      setId('');
      setError('');
    });
  }, [isOpen]);

  const validate = (value: string): string => {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return 'Agent ID required';
    if (!/^[a-z][a-z0-9-_]*$/.test(trimmed)) {
      return 'Use lowercase letters, digits, dashes (start with letter)';
    }
    if (existingIds.includes(trimmed)) return `Agent "${trimmed}" already exists`;
    return '';
  };

  const handleAdd = () => {
    const trimmed = id.trim().toLowerCase();
    const err = validate(trimmed);
    if (err) {
      setError(err);
      return;
    }
    onAdd(trimmed);
    onClose();
  };

  const suggestions = SUGGESTIONS.filter(s => !existingIds.includes(s));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Agent"
      icon={<Bot className="w-5 h-5" />}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleAdd} disabled={!id.trim()}>{t('opencode.buttons.addAgent')}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Input
          label="Agent ID"
          value={id}
          onChange={e => {
            setId(e.target.value);
            setError('');
          }}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder="e.g., build, oracle, custom-agent"
          error={error || undefined}
          autoFocus
        />

        {suggestions.length > 0 && (
          <div>
            <div className="text-xs text-vsc-text-muted mb-2">{t('opencode.ui.suggestions')}</div>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map(s => (
                <ButtonBase
                  key={s}
                  type="button"
                  onClick={() => { setId(s); setError(''); }}
                  className="px-2.5 py-1 text-xs rounded-md bg-white/5 border border-white/10 hover:border-sky-500/50 hover:text-sky-300 transition-colors"
                >
                  {s}
                </ButtonBase>
              ))}
            </div>
          </div>
        )}

        <div className="text-xs text-vsc-text-muted">
          {t('opencode.ui.agentHint')}
        </div>
      </div>
    </Modal>
  );
}