import { CollapsibleSection } from '@/components/ui';
import { useServicePlugins } from '@/hooks/useServicePlugins';
import { t } from '@/lib/i18n';
import { FireworksCheckerSection } from './FireworksCheckerSection';
import { FreeModelBridgeSection } from './FreeModelBridgeSection';
import { ZaiKeysPanel } from './ZaiKeysPanel';

export function ProviderToolsSection() {
  const servicePlugins = useServicePlugins();
  const hasFreemodelPlugin = servicePlugins.some(p => p.id === 'stitch-freemodel');

  return (
    <CollapsibleSection
      title={t('aiHub.providersPage.toolsTitle')}
      defaultExpanded={false}
      className="space-y-4"
    >
      <FireworksCheckerSection />
      {hasFreemodelPlugin && <FreeModelBridgeSection />}
      <ZaiKeysPanel />
    </CollapsibleSection>
  );
}
