import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { getZaiApiKeys, setZaiApiKeys } from '@/lib/backend/modules/apiKeys';
import type { ZaiApiKey } from '@/lib/backend/modules/apiKeys';
import { Button, EmptyState, GlassCard, Input } from '@/components/ui';
import { t } from '@/lib/i18n';

export function ZaiKeysPanel() {
  const [keys, setKeys] = useState<ZaiApiKey[]>([]);
  const [newApiKey, setNewApiKey] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('');
  const [newPrefix, setNewPrefix] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      getZaiApiKeys()
        .then(setKeys)
        .catch(error => console.error('Failed to load Z.AI keys:', error));
    });
  }, []);

  const persistKeys = useCallback(async (next: ZaiApiKey[]): Promise<boolean> => {
    setIsSaving(true);
    try {
      await setZaiApiKeys(next);
      setKeys(next);
      toast.success(t('aiHub.providersPage.zaiSaved'));
      return true;
    } catch (error) {
      console.error('Failed to save Z.AI keys:', error);
      toast.error(t('aiHub.providersPage.zaiSaveFailed'));
      return false;
    } finally {
      setIsSaving(false);
    }
  }, []);

  const handleAdd = useCallback(async () => {
    const apiKey = newApiKey.trim();
    if (!apiKey) return;
    const entry: ZaiApiKey = {
      apiKey,
      baseUrl: newBaseUrl.trim() || null,
      prefix: newPrefix.trim() || null,
    };
    const saved = await persistKeys([...keys, entry]);
    if (saved) {
      setNewApiKey('');
      setNewBaseUrl('');
      setNewPrefix('');
    }
  }, [keys, newApiKey, newBaseUrl, newPrefix, persistKeys]);

  const handleDelete = useCallback(async (index: number) => {
    await persistKeys(keys.filter((_, i) => i !== index));
  }, [keys, persistKeys]);

  return (
    <GlassCard className="p-4 md:p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-200">{t('aiHub.providersPage.zaiTitle')}</h3>
        <p className="mt-0.5 text-xs text-slate-500">{t('aiHub.providersPage.zaiHint')}</p>
      </div>

      {keys.length === 0 ? (
        <EmptyState compact icon={KeyRound} title={t('aiHub.providersPage.zaiEmpty')} />
      ) : (
        <ul className="space-y-1.5">
          {keys.map((key, index) => (
            <li
              key={index}
              data-testid="zai-key-row"
              className="flex items-center gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-xs"
            >
              <span className="font-mono text-slate-300 truncate">
                ••••{key.apiKey.slice(-4)}
              </span>
              <span className="min-w-0 flex-1 truncate text-slate-500">{key.baseUrl || '—'}</span>
              <span className="min-w-0 flex-1 truncate text-slate-500">{key.prefix || '—'}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                data-testid="zai-key-row-delete"
                onClick={() => void handleDelete(index)}
                disabled={isSaving}
              >
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Input
          label={t('aiHub.providersPage.zaiApiKeyLabel')}
          type="password"
          placeholder="JWT session token"
          value={newApiKey}
          onChange={event => setNewApiKey(event.target.value)}
        />
        <Input
          label={t('aiHub.providersPage.zaiBaseUrlLabel')}
          type="text"
          placeholder="https://chat.z.ai"
          value={newBaseUrl}
          onChange={event => setNewBaseUrl(event.target.value)}
        />
        <Input
          label={t('aiHub.providersPage.zaiPrefixLabel')}
          type="text"
          placeholder="user id"
          value={newPrefix}
          onChange={event => setNewPrefix(event.target.value)}
        />
      </div>

      <div className="flex justify-end">
        <Button
          variant="primary"
          size="sm"
          leftIcon={<Plus size={14} />}
          onClick={() => void handleAdd()}
          isLoading={isSaving}
          disabled={!newApiKey.trim()}
        >
          {t('aiHub.providersPage.zaiAdd')}
        </Button>
      </div>
    </GlassCard>
  );
}
