import { useCallback } from 'react';
import { Download, RefreshCw, Trash2 } from 'lucide-react';
import { useLogsStore } from '../../stores/logs';
import { useRegistrationStore } from '../../stores/registration';
import { useUIPreferencesStore } from '../../stores/uiPreferences';
import { t } from '../../lib/i18n';
import { Badge, Button, ConfirmActionButton } from '@/components/ui';

export function LogExportMenu() {
  const { logVerbosity } = useRegistrationStore();
  const { logs, isLoading, fetchLogs, clearLogs, exportLogs } = useLogsStore();
  const { setLogsSelectedLogId } = useUIPreferencesStore();

  const handleRefresh = useCallback(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleClear = useCallback(async () => {
    try {
      await clearLogs();
      setLogsSelectedLogId(null);
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  }, [clearLogs, setLogsSelectedLogId]);

  const handleExport = useCallback(async () => {
    try {
      const content = await exportLogs('json');
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stitch-logs-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export logs:', err);
    }
  }, [exportLogs]);

  return (
    <div className="flex items-center gap-2">
      <Badge variant="info" size="sm">
        {t('logs.verbosityLabel')}: {logVerbosity}
      </Badge>
      <Button
        size="xs"
        variant="secondary"
        onClick={handleRefresh}
        isLoading={isLoading}
        leftIcon={<RefreshCw size={12} />}
      >
        {t('logs.refresh')}
      </Button>
      <Button
        size="xs"
        variant="secondary"
        onClick={handleExport}
        disabled={logs.length === 0}
        leftIcon={<Download size={12} />}
      >
        {t('logs.export')}
      </Button>
      <ConfirmActionButton
        size="xs"
        variant="danger"
        onConfirm={handleClear}
        disabled={logs.length === 0}
        leftIcon={<Trash2 size={12} />}
      >
        {t('logs.clear')}
      </ConfirmActionButton>
    </div>
  );
}
