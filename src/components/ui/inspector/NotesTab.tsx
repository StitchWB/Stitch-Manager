import { useState } from 'react';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import type { Account } from '@/types/generated';

interface NotesTabProps {
  account: Account;
  onUpdate?: (accountId: number, updates: { notes?: string; tags?: string }) => Promise<void>;
}

export function NotesTab({ account, onUpdate }: NotesTabProps) {
  const [notes, setNotes] = useState(account.notes ?? '');
  const [tags, setTags] = useState(account.tags ?? '');
  const [isSaving, setIsSaving] = useState(false);

  // Panel is keyed by account.id in parent: local state resets on account switch, no effect needed.

  const notesDirty = notes !== (account.notes ?? '');
  const tagsDirty = tags !== (account.tags ?? '');
  const isDirty = notesDirty || tagsDirty;

  const handleSave = async () => {
    if (!onUpdate) return;
    setIsSaving(true);
    try {
      await onUpdate(account.id, { notes, tags });
      toast.success(t('accounts.inspector.notesSaved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('accounts.inspector.notesSaveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setNotes(account.notes ?? '');
    setTags(account.tags ?? '');
  };

  // Read-only fallback when onUpdate is not provided
  if (!onUpdate) {
    return (
      <>
        <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
            {t('accounts.drawer.notes')}
          </h3>
          <div className="px-3 py-2">
            {account.notes ? (
              <p className="text-xs text-slate-300 whitespace-pre-wrap">{account.notes}</p>
            ) : (
              <span className="text-[11px] text-slate-600 italic">{t('accounts.drawer.noData')}</span>
            )}
          </div>
        </div>
        <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
            {t('accounts.drawer.tags')}
          </h3>
          <div className="px-3 py-2">
            {account.tags ? (
              <div className="flex flex-wrap gap-1">
                {account.tags.split(',').map(tag => (
                  <span key={tag.trim()} className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-500/20 text-indigo-300">
                    {tag.trim()}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-[11px] text-slate-600 italic">{t('accounts.drawer.noData')}</span>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Notes */}
      <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
          {t('accounts.drawer.notes')}
        </h3>
        <div className="p-3">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            disabled={isSaving}
            rows={4}
            className="w-full px-3 py-2 bg-black/20 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-indigo-500/50 resize-none"
            placeholder={t('accounts.addNotesPlaceholder')}
          />
        </div>
      </div>

      {/* Tags */}
      <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
          {t('accounts.drawer.tags')}
        </h3>
        <div className="p-3">
          <input
            type="text"
            value={tags}
            onChange={e => setTags(e.target.value)}
            disabled={isSaving}
            className="w-full px-3 py-2 bg-black/20 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-indigo-500/50"
            placeholder={t('accounts.addTagPlaceholder')}
          />
        </div>
      </div>

      {/* Save / Cancel */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={handleSave}
          disabled={!isDirty || isSaving}
          leftIcon={<Save size={12} />}
        >
          {t('common.save')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleCancel}
          disabled={!isDirty || isSaving}
        >
          {t('common.cancel')}
        </Button>
      </div>
    </>
  );
}
