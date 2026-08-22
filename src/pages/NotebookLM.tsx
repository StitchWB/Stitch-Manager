import { useEffect, useSyncExternalStore } from 'react';
import { BookOpen, Zap } from 'lucide-react';
import Header from '../components/layout/Header';
import { AiTopTabs } from '@/components/ai-proxy/AiTopTabs';
import { t } from '@/lib/i18n';
import DeclarativePage from '@/components/plugin-ui/DeclarativePage';
import type { PluginPageSchema } from '@/components/plugin-ui/schema';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  fetchServicePlugins,
  getServicePlugins,
  subscribeServicePlugins,
} from '@/lib/backend/modules/servicePlugins';

const NOTEBOOKLM_PLUGIN_ID = 'stitch-notebooklm';

/**
 * NotebookLM page — plugin-only (plan todo 24).
 *
 * The built-in NotebookLM domain was removed; the page is now served
 * exclusively by the `stitch-notebooklm` service plugin.
 *
 *   - Plugin present with declarative ui → DeclarativePage rendered.
 *   - Plugin absent (or list fetch failed) → EmptyState with a clear
 *     "plugin not installed" message (i18n key `notebooklm.pluginNotInstalled`).
 *
 * Switching happens without reload via useSyncExternalStore subscription
 * to the servicePlugins cache; install/uninstall invalidates the cache
 * and triggers a refetch that re-renders this component.
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
          <EmptyState
            icon={BookOpen}
            title={t('notebooklm.pluginNotInstalled')}
            description={t('notebooklm.pluginNotInstalledHint')}
          />
        )}
      </div>
    </div>
  );
}
