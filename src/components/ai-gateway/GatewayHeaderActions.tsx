import { useState } from 'react';
import { Database, Zap } from 'lucide-react';
import { ConfirmActionButton } from '@/components/ui';
import { t } from '@/lib/i18n';
import { appToast } from '@/lib/observability/toast';
import { useAiGatewayStore } from '@/stores/aiGateway';
import { importOpencodeProviders } from '@/lib/backend/modules/aiGateway';

export function GatewayHeaderActions() {
  const { migrateLegacyData, fetchEndpoints, fetchPublicModels } = useAiGatewayStore();
  const [importing, setImporting] = useState(false);
  const [migrating, setMigrating] = useState(false);

  const handleImportOpencode = async () => {
    setImporting(true);
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
      setImporting(false);
    }
  };

  const handleMigrate = async () => {
    setMigrating(true);
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
      setMigrating(false);
    }
  };

  return (
    <>
      <ConfirmActionButton
        variant="ghost"
        size="sm"
        isLoading={importing}
        onConfirm={handleImportOpencode}
      >
        <Zap className="h-4 w-4 mr-2" />
        {t('aiGateway.importOpencode')}
      </ConfirmActionButton>
      <ConfirmActionButton
        variant="ghost"
        size="sm"
        isLoading={migrating}
        onConfirm={handleMigrate}
      >
        <Database className="h-4 w-4 mr-2" />
        {t('aiGateway.migrate')}
      </ConfirmActionButton>
    </>
  );
}
