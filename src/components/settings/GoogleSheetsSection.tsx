import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { getSettings } from '@/lib/backend';
import { normalizeSpreadsheetId } from '@/lib/backend/modules/googleSheets';
import { t } from '@/lib/i18n';
import type { SettingsData } from '@/types/generated';
import { GoogleSheetsSettingsSection } from './GoogleSheetsSettingsSection';
import { saveSettingsSlice, SETTINGS_SECRET_MASK } from './shared';

export function GoogleSheetsSection() {
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [serviceAccountJson, setServiceAccountJson] = useState('');
  const [hasStoredServiceAccountJson, setHasStoredServiceAccountJson] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = (await getSettings()) as unknown as SettingsData;
        if (cancelled) return;
        setSpreadsheetId(data.googleSheetsSpreadsheetId || '');
        setServiceAccountJson(
          data.googleSheetsServiceAccountJson === SETTINGS_SECRET_MASK
            ? ''
            : data.googleSheetsServiceAccountJson || ''
        );
        setHasStoredServiceAccountJson(
          Boolean(
            data.googleSheetsServiceAccountJson &&
              data.googleSheetsServiceAccountJson === SETTINGS_SECRET_MASK
          )
        );
      } catch (error) {
        console.error('Failed to load settings:', error);
        toast.error(t('settings.loadFailed'), { description: String(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = useCallback(async () => {
    const normalizedSpreadsheetId = normalizeSpreadsheetId(spreadsheetId);

    const partial: Partial<SettingsData> = {
      googleSheetsSpreadsheetId: normalizedSpreadsheetId,
    };
    if (serviceAccountJson.trim()) {
      partial.googleSheetsServiceAccountJson = serviceAccountJson;
    }

    const ok = await saveSettingsSlice(partial, 'Failed to save settings');
    if (!ok) return;

    if (normalizedSpreadsheetId !== spreadsheetId) {
      setSpreadsheetId(normalizedSpreadsheetId);
    }
    if (serviceAccountJson.trim()) {
      setServiceAccountJson('');
      setHasStoredServiceAccountJson(true);
    }
  }, [spreadsheetId, serviceAccountJson]);

  return (
    <GoogleSheetsSettingsSection
      spreadsheetId={spreadsheetId}
      serviceAccountJson={serviceAccountJson}
      hasStoredServiceAccountJson={hasStoredServiceAccountJson}
      onSpreadsheetIdChange={value => setSpreadsheetId(value)}
      onServiceAccountJsonChange={value => setServiceAccountJson(value)}
      onSave={handleSave}
    />
  );
}
