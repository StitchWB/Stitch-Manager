import { create } from 'zustand';
import type { SettingsData } from '../types/generated';
import type { BackgroundManagerConfig } from '../lib/backend/modules/backgroundManager';

interface SettingsState {
  settings: SettingsData | null;
  backgroundManagerConfig: BackgroundManagerConfig | null;
  
  setSettings: (settings: SettingsData) => void;
  setBackgroundManagerConfig: (config: BackgroundManagerConfig) => void;
}

export const useSettingsStore = create<SettingsState>(set => ({
  settings: null,
  backgroundManagerConfig: null,
  
  setSettings: settings => set({ settings }),
  setBackgroundManagerConfig: config => set({ backgroundManagerConfig: config }),
}));
