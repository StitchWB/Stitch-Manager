import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GoogleSheetsParams } from '@/lib/tauri/modules/googleSheets';
import { useRegistrationStore } from '../stores/registration';

type SheetsTestStatus = 'idle' | 'loading' | 'success' | 'error';

type SheetsDatasetHandlers = {
  refresh: () => Promise<void>;
  testConnection: () => Promise<boolean>;
};

type UseSheetsConfigStateArgs = {
  resolvedViewMode: 'list' | 'graph' | 'sheets';
};

export type UseSheetsConfigState = {
  sheetsSpreadsheetId: string;
  sheetsServiceAccountJson: string;
  sheetsTestStatus: SheetsTestStatus;
  sheetsTestMessage: string | null;
  sheetsTouched: boolean;
  showSheetsConfig: boolean;
  sheetsParams: GoogleSheetsParams | null;
  handleTestSheets: () => Promise<void>;
  handleRefreshSheets: () => Promise<void>;
  handleToggleSheetsConfig: () => void;
  handleSheetsSpreadsheetIdChange: (value: string) => void;
  handleSheetsServiceAccountJsonChange: (value: string) => void;
  registerSheetsHandlers: (handlers: SheetsDatasetHandlers) => void;
};

export function useSheetsConfigState({
  resolvedViewMode,
}: UseSheetsConfigStateArgs): UseSheetsConfigState {
  const registrationConfig = useRegistrationStore(state => state.config);
  const setAdvancedSettings = useRegistrationStore(state => state.setAdvancedSettings);
  const saveRegistrationSettings = useRegistrationStore(state => state.saveImmediately);

  const [sheetsSpreadsheetId, setSheetsSpreadsheetId] = useState(
    registrationConfig.advanced.googleSheetsSpreadsheetId || ''
  );
  const [sheetsServiceAccountJson, setSheetsServiceAccountJson] = useState(
    registrationConfig.advanced.googleSheetsServiceAccountJson || ''
  );
  const [sheetsTestStatus, setSheetsTestStatus] = useState<SheetsTestStatus>('idle');
  const [sheetsTestMessage, setSheetsTestMessage] = useState<string | null>(null);
  const [sheetsTouched, setSheetsTouched] = useState(false);
  const [showSheetsConfig, setShowSheetsConfig] = useState(false);
  const datasetHandlersRef = useRef<SheetsDatasetHandlers | null>(null);

  const registerSheetsHandlers = useCallback((handlers: SheetsDatasetHandlers) => {
    datasetHandlersRef.current = handlers;
  }, []);

  // Persist Google Sheets settings back to DB (plaintext; encryption deferred)
  useEffect(() => {
    if (!sheetsTouched) return;
    const timer = setTimeout(() => {
      setAdvancedSettings({
        googleSheetsSpreadsheetId: sheetsSpreadsheetId,
        googleSheetsServiceAccountJson: sheetsServiceAccountJson,
      });
      void saveRegistrationSettings();
    }, 500);
    return () => clearTimeout(timer);
  }, [
    sheetsTouched,
    sheetsSpreadsheetId,
    sheetsServiceAccountJson,
    saveRegistrationSettings,
    setAdvancedSettings,
  ]);

  const sheetsParams = useMemo<GoogleSheetsParams | null>(() => {
    if (!sheetsSpreadsheetId.trim() || !sheetsServiceAccountJson.trim()) return null;
    return {
      spreadsheetId: sheetsSpreadsheetId.trim(),
      serviceAccountJson: sheetsServiceAccountJson.trim(),
    };
  }, [sheetsSpreadsheetId, sheetsServiceAccountJson]);

  // Force config panel to be visible when user is in Graph/Sheets without params.
  // This avoids setState-in-effect (lint rule) and keeps behavior deterministic.
  const shouldForceShowConfig = resolvedViewMode !== 'list' && !sheetsParams;

  const handleTestSheets = useCallback(async () => {
    setSheetsTouched(true);
    setSheetsTestStatus('loading');
    setSheetsTestMessage(null);
    const ok = (await datasetHandlersRef.current?.testConnection?.()) ?? false;
    setSheetsTestStatus(ok ? 'success' : 'error');
    setSheetsTestMessage(ok ? 'Connection ok' : 'Connection failed');
  }, []);

  const handleRefreshSheets = useCallback(async () => {
    setSheetsTouched(true);
    await datasetHandlersRef.current?.refresh?.();
  }, []);

  const handleSheetsSpreadsheetIdChange = useCallback((value: string) => {
    setSheetsTouched(true);
    setSheetsSpreadsheetId(value);
    setSheetsTestStatus('idle');
    setSheetsTestMessage(null);
  }, []);

  const handleSheetsServiceAccountJsonChange = useCallback((value: string) => {
    setSheetsTouched(true);
    setSheetsServiceAccountJson(value);
    setSheetsTestStatus('idle');
    setSheetsTestMessage(null);
  }, []);

  const handleToggleSheetsConfig = useCallback(() => {
    if (shouldForceShowConfig) {
      setShowSheetsConfig(true);
      return;
    }
    setShowSheetsConfig(current => !current);
  }, [shouldForceShowConfig]);

  return useMemo(
    () => ({
      sheetsSpreadsheetId,
      sheetsServiceAccountJson,
      sheetsTestStatus,
      sheetsTestMessage,
      sheetsTouched,
      showSheetsConfig: showSheetsConfig || shouldForceShowConfig,
      sheetsParams,
      handleTestSheets,
      handleRefreshSheets,
      handleToggleSheetsConfig,
      handleSheetsSpreadsheetIdChange,
      handleSheetsServiceAccountJsonChange,
      registerSheetsHandlers,
    }),
    [
      sheetsSpreadsheetId,
      sheetsServiceAccountJson,
      sheetsTestStatus,
      sheetsTestMessage,
      sheetsTouched,
      showSheetsConfig,
      shouldForceShowConfig,
      sheetsParams,
      handleTestSheets,
      handleRefreshSheets,
      handleToggleSheetsConfig,
      handleSheetsSpreadsheetIdChange,
      handleSheetsServiceAccountJsonChange,
      registerSheetsHandlers,
    ]
  );
}
