import { useCallback, useEffect, useRef } from 'react';
import { create } from 'zustand';
import { updateSettings } from '@/lib/backend';
import { t } from '@/lib/i18n';
import { useLogsStore } from '@/stores/logs';
import type { SettingsData } from '@/types/generated';

export const SETTINGS_SECRET_MASK = '********';

type SaveStatus = 'idle' | 'success' | 'error';

interface SettingsSaveState {
  isSaving: boolean;
  saveStatus: SaveStatus;
  errorMessage: string;
}

export const useSettingsSaveStore = create<SettingsSaveState>(() => ({
  isSaving: false,
  saveStatus: 'idle',
  errorMessage: '',
}));

let successTimer: ReturnType<typeof setTimeout> | null = null;

export async function saveSettingsSlice(
  partial: Partial<SettingsData>,
  logLabel: string
): Promise<boolean> {
  if (successTimer) {
    clearTimeout(successTimer);
    successTimer = null;
  }
  useSettingsSaveStore.setState({ isSaving: true, saveStatus: 'idle', errorMessage: '' });
  try {
    await updateSettings(partial);
    useSettingsSaveStore.setState({ isSaving: false, saveStatus: 'success' });
    successTimer = setTimeout(() => {
      successTimer = null;
      useSettingsSaveStore.setState({ saveStatus: 'idle' });
    }, 3000);
    return true;
  } catch (error) {
    console.error('[Settings] Save failed:', error);
    useSettingsSaveStore.setState({
      isSaving: false,
      saveStatus: 'error',
      errorMessage: error instanceof Error ? error.message : t('settings.failedToSave'),
    });
    useLogsStore.getState().addLog({
      level: 'error',
      message: `${logLabel}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      source: 'settings',
    });
    return false;
  }
}

export function useDebouncedSave(save: () => void | Promise<void>, delayMs = 800) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // Flush a pending save on unmount so switching category can't drop the last edit.
  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        void saveRef.current();
      }
    },
    []
  );

  return useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void saveRef.current();
    }, delayMs);
  }, [delayMs]);
}
