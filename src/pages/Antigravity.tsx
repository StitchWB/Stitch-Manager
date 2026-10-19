import { useEffect, useSyncExternalStore } from 'react';
import { Orbit, Zap } from 'lucide-react';
import Header from '../components/layout/Header';
import { t } from '@/lib/i18n';
import DeclarativePage from '@/components/plugin-ui/DeclarativePage';
import type { PluginPageSchema } from '@/components/plugin-ui/schema';
import { EmptyState } from '@/components/ui/EmptyState';
import { OAuthFlowWizard } from '@/components/ai-proxy/OAuthFlowWizard';
import {
  fetchServicePlugins,
  getServicePlugins,
  subscribeServicePlugins,
} from '@/lib/backend/modules/servicePlugins';

const ANTIGRAVITY_PLUGIN_ID = 'stitch-antigravity';

/**
 * Antigravity page — thin wrapper over the stitch-antigravity service plugin.
 *
 *   - Plugin present with declarative ui → OAuthFlowWizard (drives the
 *     plugin-owned OAuth flow) + the plugin's declarative page.
 *   - Plugin absent (or list fetch failed) → EmptyState "plugin not
 *     installed" (plugin bundle is gone too, so core keys are used).
 *
 * Same pattern as NotebookLM.tsx.
 */
export default function Antigravity() {
  const plugins = useSyncExternalStore(
    subscribeServicePlugins,
    getServicePlugins,
    getServicePlugins,
  );

  useEffect(() => {
    void fetchServicePlugins();
  }, []);

  const plugin = plugins.find(p => p.id === ANTIGRAVITY_PLUGIN_ID);
  const ui = plugin?.ui;
  const declarativeSchema: PluginPageSchema | null =
    ui && ui.kind === 'declarative' && Boolean(ui.page)
      ? (ui.page as PluginPageSchema)
      : null;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-void-base">
      <Header title={t('sidebar.aiHub')} icon={<Zap size={18} />} />
      <div className="flex-1 overflow-y-auto">
        {declarativeSchema ? (
          <>
            <OAuthFlowWizard
              pluginId={ANTIGRAVITY_PLUGIN_ID}
              providerId="antigravity"
            />
            <DeclarativePage pluginId={ANTIGRAVITY_PLUGIN_ID} schema={declarativeSchema} />
          </>
        ) : (
          <EmptyState
            icon={Orbit}
            title={t('pluginUi.pluginNotInstalled')}
            description={t('pluginUi.pluginNotInstalledDescription')}
          />
        )}
      </div>
    </div>
  );
}
