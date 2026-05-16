import { Database, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Button, Input, SectionHeader, Textarea } from '@/components/ui';
import { t } from '@/lib/i18n';
import {
  fetchGoogleSheetsDataset,
  initGoogleSheetsSchema,
  normalizeSpreadsheetId,
  testGoogleSheetsConnection,
} from '@/lib/tauri/modules/googleSheets';

const SETTINGS_SECRET_MASK = '********';

interface GoogleSheetsSettingsSectionProps {
  spreadsheetId: string;
  serviceAccountJson: string;
  hasStoredServiceAccountJson?: boolean;
  onSpreadsheetIdChange: (value: string) => void;
  onServiceAccountJsonChange: (value: string) => void;
  onSave: () => void;
}

type ConnectionStatus = 'idle' | 'loading' | 'success' | 'error';

export function GoogleSheetsSettingsSection({
  spreadsheetId,
  serviceAccountJson,
  hasStoredServiceAccountJson,
  onSpreadsheetIdChange,
  onServiceAccountJsonChange,
  onSave,
}: GoogleSheetsSettingsSectionProps) {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [message, setMessage] = useState<string>('');
  const [busyAction, setBusyAction] = useState<'test' | 'init' | 'refresh' | null>(null);

  const canRunActions = Boolean(
    spreadsheetId.trim() && (serviceAccountJson.trim() || hasStoredServiceAccountJson)
  );

  const handleSpreadsheetIdBlur = () => {
    const normalized = normalizeSpreadsheetId(spreadsheetId);
    if (normalized !== spreadsheetId) {
      onSpreadsheetIdChange(normalized);
    }
  };

  const runTest = async () => {
    if (!canRunActions) {
      setStatus('error');
      setMessage(t('settings.googleSheets.required'));
      return;
    }
    setBusyAction('test');
    setStatus('loading');
    setMessage('');
    try {
      const result = await testGoogleSheetsConnection({
        spreadsheetId: spreadsheetId.trim(),
        serviceAccountJson: serviceAccountJson.trim() || SETTINGS_SECRET_MASK,
      });
      setStatus('success');
      setMessage(
        result.warnings.length
          ? `${t('settings.googleSheets.connectionOkWithWarnings')}: ${result.warnings[0]}`
          : t('settings.googleSheets.connectionOk')
      );
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  };

  const runInitSchema = async () => {
    if (!canRunActions) {
      setStatus('error');
      setMessage(t('settings.googleSheets.required'));
      return;
    }
    setBusyAction('init');
    setStatus('loading');
    setMessage('');
    try {
      const result = await initGoogleSheetsSchema({
        spreadsheetId: spreadsheetId.trim(),
        serviceAccountJson: serviceAccountJson.trim() || SETTINGS_SECRET_MASK,
      });
      setStatus('success');
      setMessage(
        result.warnings.length
          ? `${t('settings.googleSheets.schemaInitedWithWarnings')}: ${result.warnings[0]}`
          : t('settings.googleSheets.schemaInited')
      );
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  };

  const runRefresh = async () => {
    if (!canRunActions) {
      setStatus('error');
      setMessage(t('settings.googleSheets.required'));
      return;
    }
    setBusyAction('refresh');
    setStatus('loading');
    setMessage('');
    try {
      const dataset = await fetchGoogleSheetsDataset({
        spreadsheetId: spreadsheetId.trim(),
        serviceAccountJson: serviceAccountJson.trim() || SETTINGS_SECRET_MASK,
      });
      setStatus('success');
      setMessage(
        `${t('settings.googleSheets.datasetLoaded')}: ` +
          `${dataset.identities.length} identities, ${dataset.links.length} links`
      );
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <SectionHeader
      title={t('settings.googleSheets.title')}
      description={t('settings.googleSheets.description')}
      icon={<Database className="w-4 h-4 text-emerald-400" />}
      className="pt-2"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3">
          <Input
            label={t('settings.googleSheets.spreadsheetId')}
            value={spreadsheetId}
            onChange={e => onSpreadsheetIdChange(e.target.value)}
            onBlur={handleSpreadsheetIdBlur}
            hint={t('settings.googleSheets.spreadsheetIdHint')}
            placeholder="1AbCDEF..."
          />

          <Textarea
            label={t('settings.googleSheets.serviceAccountJson')}
            value={serviceAccountJson}
            onChange={e => onServiceAccountJsonChange(e.target.value)}
            rows={8}
            placeholder='{"type":"service_account", ...}'
            hint={
              hasStoredServiceAccountJson
                ? 'JSON сохранён (скрыт). Можно оставить поле пустым — кнопки будут использовать сохранённый ключ.'
                : undefined
            }
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" onClick={onSave}>
            {t('common.save')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={runTest}
            disabled={busyAction !== null || !canRunActions}
            leftIcon={<ShieldCheck className="w-3.5 h-3.5" />}
          >
            {busyAction === 'test'
              ? t('settings.googleSheets.testing')
              : t('settings.googleSheets.testConnection')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={runInitSchema}
            disabled={busyAction !== null || !canRunActions}
            leftIcon={<Database className="w-3.5 h-3.5" />}
          >
            {busyAction === 'init'
              ? t('settings.googleSheets.initializing')
              : t('settings.googleSheets.initSchema')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={runRefresh}
            disabled={busyAction !== null || !canRunActions}
            leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          >
            {busyAction === 'refresh'
              ? t('settings.googleSheets.refreshing')
              : t('settings.googleSheets.refreshDataset')}
          </Button>
        </div>

        {message ? (
          <div
            className={`rounded-md border px-3 py-2 text-xs ${
              status === 'success'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                : status === 'error'
                  ? 'border-red-500/40 bg-red-500/10 text-red-200'
                  : 'border-white/10 bg-white/5 text-slate-300'
            }`}
          >
            {message}
          </div>
        ) : null}

        <div className="text-[11px] text-slate-500">{t('settings.googleSheets.securityHint')}</div>
      </div>
    </SectionHeader>
  );
}
