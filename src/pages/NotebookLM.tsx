import { useCallback, useEffect, useState } from 'react';
import { BookOpen, MessageSquare, Mic, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import {
  notebooklmListNotebooks,
  notebooklmCreateNotebook,
  notebooklmAsk,
  notebooklmGenerateAudio,
  type NotebookLMNotebook,
} from '@/lib/backend';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SectionHeader } from '@/components/ui/SectionHeader';

export default function NotebookLM() {
  const [notebooks, setNotebooks] = useState<NotebookLMNotebook[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await notebooklmListNotebooks();
      setNotebooks(list);
      if (list.length > 0 && !selectedId) setSelectedId(list[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    setBusy(true);
    try {
      await notebooklmCreateNotebook({ title: newTitle.trim() });
      setNewTitle('');
      toast.success(t('notebooklm.created'));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleAsk = async () => {
    if (!selectedId || !question.trim()) return;
    setBusy(true);
    setAnswer(null);
    try {
      const res = await notebooklmAsk({ notebookId: selectedId, question: question.trim() });
      setAnswer(res.answer);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleAudio = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const res = await notebooklmGenerateAudio({ notebookId: selectedId });
      toast.success(`${t('notebooklm.audioStarted')}: ${res.task_id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <SectionHeader
        title={t('notebooklm.title')}
        icon={<BookOpen size={18} className="text-teal-400" />}
      >
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {t('common.refresh')}
          </Button>
        </div>
      </SectionHeader>

      {error && (
        <GlassCard className="p-4 border-red-500/20">
          <p className="text-sm text-red-400">{error}</p>
          <p className="text-xs text-slate-500 mt-1">{t('notebooklm.setupHint')}</p>
        </GlassCard>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Notebooks list + create */}
        <GlassCard className="p-4 space-y-3">
          <h3 className="text-xs uppercase tracking-wider text-slate-500">
            {t('notebooklm.notebooks')}
          </h3>
          {loading ? (
            <div className="flex justify-center py-6">
              <LoadingSpinner size="md" />
            </div>
          ) : (
            <ul className="space-y-1 max-h-64 overflow-y-auto">
              {notebooks.map(nb => (
                <li key={nb.id}>
                  <button
                    onClick={() => setSelectedId(nb.id)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm border transition-colors ${
                      selectedId === nb.id
                        ? 'border-teal-500/30 bg-teal-500/10 text-teal-200'
                        : 'border-white/5 text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    {nb.title || nb.id}
                  </button>
                </li>
              ))}
              {notebooks.length === 0 && (
                <li className="text-sm text-slate-500 py-2">{t('notebooklm.empty')}</li>
              )}
            </ul>
          )}
          <div className="flex gap-2">
            <Input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder={t('notebooklm.newTitle')}
            />
            <Button variant="primary" size="md" onClick={() => void handleCreate()} disabled={busy}>
              <Plus size={14} />
              {t('notebooklm.create')}
            </Button>
          </div>
        </GlassCard>

        {/* Ask + audio */}
        <GlassCard className="p-4 space-y-3">
          <h3 className="text-xs uppercase tracking-wider text-slate-500">
            {t('notebooklm.interact')}
          </h3>
          <Textarea
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder={t('notebooklm.questionPlaceholder')}
            rows={3}
          />
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="md"
              onClick={() => void handleAsk()}
              disabled={busy || !selectedId}
            >
              <MessageSquare size={14} />
              {t('notebooklm.ask')}
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={() => void handleAudio()}
              disabled={busy || !selectedId}
            >
              <Mic size={14} />
              {t('notebooklm.audio')}
            </Button>
          </div>
          {answer && (
            <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
              <p className="text-sm text-slate-200 whitespace-pre-wrap">{answer}</p>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
