import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { BookOpen, MessageSquare, Mic, Plus, RefreshCw, Zap } from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/layout/Header';
import { AiTopTabs } from '@/components/ai-proxy/AiTopTabs';
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
import DeclarativePage from '@/components/plugin-ui/DeclarativePage';
import type { PluginPageSchema } from '@/components/plugin-ui/schema';
import {
  fetchServicePlugins,
  getServicePlugins,
  subscribeServicePlugins,
} from '@/lib/backend/modules/servicePlugins';

const NOTEBOOKLM_PLUGIN_ID = 'stitch-notebooklm';

/**
 * Built-in NotebookLM page content. Rendered when the stitch-notebooklm
 * service plugin is not installed (or the plugin list fetch failed, which
 * empties the cache). This is the dual-format fallback per todo 12 —
 * removal of this code is todo 24.
 */
function BuiltinNotebookLM() {
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

  const errorMessage = error
    ? error.includes('No web-notebooklm account configured')
      ? t('notebooklm.noAccount')
      : error
    : null;

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

      {errorMessage && (
        <GlassCard className="p-4 border-red-500/20">
          <p className="text-sm text-red-400">{errorMessage}</p>
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
            <Button
              variant="primary"
              size="md"
              onClick={() => void handleCreate()}
              disabled={busy}
            >
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

/**
 * NotebookLM page — dual-format switcher.
 *
 * When the `stitch-notebooklm` service plugin is installed with a declarative
 * UI schema (`ui.kind === 'declarative'` && `ui.page`), renders the plugin's
 * DeclarativePage inside the AI Hub shell. Otherwise renders the built-in
 * BuiltinNotebookLM content unchanged.
 *
 * Auto-fallback rules (todo 12):
 *   - Plugin present (any status, including dead) + declarative ui → plugin page.
 *     A dead plugin's commands will 404 → toasts, but the page still renders.
 *   - List fetch failed (cache emptied to []) → built-in (plugin not found).
 *   - Plugin not installed → built-in.
 *
 * Switching happens without reload via useSyncExternalStore subscription to
 * the servicePlugins cache; install/uninstall invalidates the cache and
 * triggers a refetch that re-renders this component.
 */
export default function NotebookLM() {
  const plugins = useSyncExternalStore(
    subscribeServicePlugins,
    getServicePlugins,
    getServicePlugins,
  );

  useEffect(() => {
    void fetchServicePlugins();
  }, []);

  const plugin = plugins.find(p => p.id === NOTEBOOKLM_PLUGIN_ID);
  const ui = plugin?.ui;
  const declarativeSchema: PluginPageSchema | null =
    ui && ui.kind === 'declarative' && Boolean(ui.page)
      ? (ui.page as PluginPageSchema)
      : null;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-void-base">
      <Header title={t('sidebar.aiHub')} icon={<Zap size={18} />} />
      <AiTopTabs />
      <div className="flex-1 overflow-y-auto">
        {declarativeSchema ? (
          <DeclarativePage pluginId={NOTEBOOKLM_PLUGIN_ID} schema={declarativeSchema} />
        ) : (
          <BuiltinNotebookLM />
        )}
      </div>
    </div>
  );
}
