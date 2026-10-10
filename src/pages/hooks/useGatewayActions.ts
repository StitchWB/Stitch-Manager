import { useCallback, useState } from 'react';
import { appToast } from '@/lib/observability/toast';
import { importOpencodeProviders } from '@/lib/backend/modules/aiGateway';
import { useAiGatewayStore } from '@/stores/aiGateway';
import { t } from '@/lib/i18n';

export function useGatewayActions() {
  const [gatewayActionBusy, setGatewayActionBusy] = useState(false);
  const migrateLegacyData = useAiGatewayStore(s => s.migrateLegacyData);
  const fetchEndpoints = useAiGatewayStore(s => s.fetchEndpoints);
  const fetchPublicModels = useAiGatewayStore(s => s.fetchPublicModels);

  const handleImportOpencode = useCallback(async () => {
    setGatewayActionBusy(true);
    try {
      const report = await importOpencodeProviders();
      if (report.imported.length === 0) {
        appToast.info(t('aiGateway.importOpencodeEmpty'), 'ai-gateway');
      } else {
        appToast.success(
          t('aiGateway.importOpencodeResult', {
            providers: report.imported.length,
            models: report.models.length,
          }),
          'ai-gateway'
        );
      }
      await Promise.all([fetchEndpoints(), fetchPublicModels()]);
    } catch (e) {
      appToast.error(e instanceof Error ? e.message : 'Import failed', 'ai-gateway');
    } finally {
      setGatewayActionBusy(false);
    }
  }, [fetchEndpoints, fetchPublicModels]);

  const handleMigrateLegacy = useCallback(async () => {
    setGatewayActionBusy(true);
    try {
      const result = await migrateLegacyData();
      appToast.success(
        `Migrated ${result.endpoints_created} endpoints, ${result.credentials_created} credentials`,
        'ai-gateway'
      );
      await Promise.all([fetchEndpoints(), fetchPublicModels()]);
    } catch (e) {
      appToast.error(e instanceof Error ? e.message : 'Migration failed', 'ai-gateway');
    } finally {
      setGatewayActionBusy(false);
    }
  }, [migrateLegacyData, fetchEndpoints, fetchPublicModels]);

  return { gatewayActionBusy, handleImportOpencode, handleMigrateLegacy };
}
