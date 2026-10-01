import { useMemo } from 'react';
import { t } from '@/lib/i18n';

import { useGoogleSheetsDataset } from '../../../../hooks/useGoogleSheetsDataset';
import { useRegistrationStore } from '../../../../stores/registration';
import { Button, Select, Textarea } from '@/components/ui';
import type { SchedulerTaskFormState } from './types';

interface EmailSourceEditorProps {
  state: SchedulerTaskFormState;
  set: (patch: Partial<SchedulerTaskFormState>) => void;
}

export function EmailSourceEditor({ state, set }: EmailSourceEditorProps) {
  const registrationConfig = useRegistrationStore(s => s.config);

  const sheetsParams = useMemo(() => {
    const spreadsheetId = registrationConfig.advanced.googleSheetsSpreadsheetId?.trim();
    const serviceAccountJson = registrationConfig.advanced.googleSheetsServiceAccountJson?.trim();
    if (!spreadsheetId || !serviceAccountJson) return null;
    return { spreadsheetId, serviceAccountJson };
  }, [
    registrationConfig.advanced.googleSheetsSpreadsheetId,
    registrationConfig.advanced.googleSheetsServiceAccountJson,
  ]);

  const {
    dataset: sheetsDataset,
    isLoading: sheetsLoading,
    error: sheetsError,
    refresh: refreshSheets,
  } = useGoogleSheetsDataset({
    autoFetch: state.taskType === 'composedFlow' && state.emailSourceMode === 'googleSheets',
    params: sheetsParams,
  });

  const sheetOptions = useMemo(
    () => [
      { value: '', label: sheetsLoading ? t('scheduler.loadingSheets') : t('scheduler.selectSheet') },
      ...(sheetsDataset?.sheets ?? []).map(sheet => ({
        value: sheet.id,
        label: `${sheet.name} (${sheet.rowCount ?? sheet.rows.length})`,
      })),
    ],
    [sheetsDataset?.sheets, sheetsLoading]
  );

  const sheetColumnOptions = useMemo(() => {
    const selectedSheet = (sheetsDataset?.sheets ?? []).find(s => s.id === state.emailSheetId);
    const columns = selectedSheet?.columns ?? [];
    return [
      { value: '', label: t('scheduler.selectColumn') },
      ...columns.map(col => ({ value: col, label: col })),
    ];
  }, [sheetsDataset?.sheets, state.emailSheetId]);

  return (
    <>
      <Select
        label={t('scheduler.emailSourceOverride')}
        value={state.emailSourceMode}
        options={[
          { value: 'none', label: t('scheduler.none') },
          { value: 'manualList', label: t('scheduler.manualList') },
          { value: 'googleSheets', label: t('scheduler.googleSheetsColumn') },
        ]}
        onValueChange={value =>
          set({
            emailSourceMode: value as SchedulerTaskFormState['emailSourceMode'],
          })
        }
      />

      {state.emailSourceMode === 'googleSheets' ? (
        <Select
          label="Email source policy"
          value={state.emailSourcePolicy}
          options={[
{ value: 'strict', label: t('scheduler.strict') },
    { value: 'fallback_to_pool', label: t('scheduler.fallbackToPool') },
    { value: 'prefer_pool', label: t('scheduler.preferPool') },
          ]}
          onValueChange={value =>
            set({
              emailSourcePolicy: value as SchedulerTaskFormState['emailSourcePolicy'],
            })
          }
        />
      ) : null}

      {state.emailSourceMode === 'manualList' ? (
        <Textarea
          label="Email list (one per line)"
          rows={4}
          value={state.emailListRaw}
          onChange={e => set({ emailListRaw: e.target.value })}
          placeholder={'first@example.com\nsecond@example.com'}
          className="bg-vsc-input border-vsc-border text-vsc-text font-mono text-sm"
          shellClassName="bg-vsc-input border-vsc-border"
        />
      ) : null}

      {state.emailSourceMode === 'googleSheets' ? (
        <div className="rounded-md border border-vsc-border bg-vsc-input/30 p-3 space-y-3">
          {!sheetsParams ? (
            <div className="text-xs text-amber-300">
              {t('scheduler.configureGoogleSheets')}
            </div>
          ) : (
            <>
              {sheetsError ? <div className="text-xs text-amber-300">{sheetsError}</div> : null}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <Select
                  label={t('scheduler.sheet')}
                  value={state.emailSheetId}
                  options={sheetOptions}
                  onValueChange={value =>
                    set({
                      emailSheetId: value,
                      emailSheetColumn: '',
                    })
                  }
                />
                <Select
                  label={t('scheduler.column')}
                  value={state.emailSheetColumn}
                  options={sheetColumnOptions}
                  onValueChange={value => set({ emailSheetColumn: value })}
                />
                <div className="flex items-end">
                  <Button variant="secondary" onClick={() => void refreshSheets()}>
                    {t('scheduler.refreshSheets')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
