import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useGoogleSheetsDataset } from '@/hooks/useGoogleSheetsDataset';
import { useRegistrationStore } from '@/stores/registration';
import type { ComposedFlow } from '@/lib/scenarioFlow/types';

type UseSetupTabStateParams = {
  isOpen: boolean;
  flow: ComposedFlow | null;
  updateFlow: (fn: (prev: ComposedFlow) => ComposedFlow) => void;
};

export function useSetupTabState({ isOpen, flow, updateFlow }: UseSetupTabStateParams) {
  const registrationConfig = useRegistrationStore((state) => state.config);
  const sheetsParams = useMemo(() => {
    const spreadsheetId = registrationConfig.advanced.googleSheetsSpreadsheetId?.trim();
    const serviceAccountJson = registrationConfig.advanced.googleSheetsServiceAccountJson?.trim();
    if (!spreadsheetId || !serviceAccountJson) return null;
    return { spreadsheetId, serviceAccountJson };
  }, [
  registrationConfig.advanced.googleSheetsServiceAccountJson,
  registrationConfig.advanced.googleSheetsSpreadsheetId]
  );
  const {
    dataset: sheetsDataset,
    isLoading: sheetsLoading,
    error: sheetsError,
    refresh: refreshSheets
  } = useGoogleSheetsDataset({
    autoFetch: Boolean(isOpen && sheetsParams),
    params: sheetsParams
  });
  const [selectedSheetId, setSelectedSheetId] = useState<string>('');
  const [selectedSheetColumn, setSelectedSheetColumn] = useState<string>('');

  const sheetOptions = useMemo(
    () => [
    { value: '', label: sheetsLoading ? 'Loading sheets...' : 'Select sheet' },
    ...(sheetsDataset?.sheets ?? []).map((sheet) => ({
      value: sheet.id,
      label: `${sheet.name} (${sheet.rowCount ?? sheet.rows.length})`
    }))],

    [sheetsDataset?.sheets, sheetsLoading]
  );

  const sheetColumnOptions = useMemo(() => {
    const sheet = (sheetsDataset?.sheets ?? []).find((item) => item.id === selectedSheetId);
    const columns = sheet?.columns ?? [];
    return [
    { value: '', label: 'Select column' },
    ...columns.map((col) => ({ value: col, label: col }))];

  }, [selectedSheetId, sheetsDataset?.sheets]);

  const inputDefaultEntries = useMemo(() => Object.entries(flow?.inputDefaults ?? {}), [flow]);

  const importEmailsFromSheet = useCallback(() => {
    const sheet = (sheetsDataset?.sheets ?? []).find((item) => item.id === selectedSheetId);
    if (!sheet) {
      toast.error('Select a sheet first');
      return;
    }
    if (!selectedSheetColumn) {
      toast.error('Select a column first');
      return;
    }

    const values = sheet.rows.
    map((row) => {
      const value = row[selectedSheetColumn];
      if (typeof value === 'string') return value.trim();
      if (typeof value === 'number') return String(value);
      return '';
    }).
    filter(Boolean).
    filter((value) => value.includes('@'));

    if (values.length === 0) {
      toast.error('No email-like values found in selected column');
      return;
    }

    updateFlow((prev) => {
      const rest = prev.dataLists.filter((d) => d.id !== 'emails_pool');
      return {
        ...prev,
        dataLists: [
        {
          id: 'emails_pool',
          values,
          strategy: 'next'
        },
        ...rest]

      };
    });
    toast.success(`Imported ${values.length} emails from Google Sheets`);
  }, [selectedSheetColumn, selectedSheetId, sheetsDataset?.sheets, updateFlow]);

  const addInputDefault = useCallback(() => {
    updateFlow((prev) => {
      const existingKeys = new Set(Object.keys(prev.inputDefaults ?? {}));
      let idx = 1;
      let key = `input_${idx}`;
      while (existingKeys.has(key)) {
        idx += 1;
        key = `input_${idx}`;
      }
      return {
        ...prev,
        inputDefaults: {
          ...(prev.inputDefaults ?? {}),
          [key]: ''
        }
      };
    });
  }, [updateFlow]);

  const updateInputDefault = useCallback(
    (oldKey: string, newKey: string, value: string) => {
      const trimmedKey = newKey.trim();
      updateFlow((prev) => {
        const next = { ...(prev.inputDefaults ?? {}) };
        delete next[oldKey];
        if (trimmedKey) {
          next[trimmedKey] = value;
        }
        return {
          ...prev,
          inputDefaults: next
        };
      });
    },
    [updateFlow]
  );

  const removeInputDefault = useCallback(
    (key: string) => {
      updateFlow((prev) => {
        const next = { ...(prev.inputDefaults ?? {}) };
        delete next[key];
        return {
          ...prev,
          inputDefaults: next
        };
      });
    },
    [updateFlow]
  );

  return {
    sheetsParams,
    sheetsError,
    selectedSheetId,
    setSelectedSheetId,
    selectedSheetColumn,
    setSelectedSheetColumn,
    sheetOptions,
    sheetColumnOptions,
    refreshSheets,
    importEmailsFromSheet,
    inputDefaultEntries,
    addInputDefault,
    updateInputDefault,
    removeInputDefault
  };
}
