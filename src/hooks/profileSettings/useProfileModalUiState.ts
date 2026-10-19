import { useState } from 'react';
import { useUIState } from '../useUIState';
import type { SettingsTab } from './schema';

export function useProfileModalUiState() {
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [resetAllConfirmOpen, setResetAllConfirmOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeTab, setActiveTab] = useUIState<SettingsTab>('profile-settings-active-tab', 'main', 'session');
  const [showCookieEditor, setShowCookieEditor] = useState(false);

  return {
    closeConfirmOpen,
    setCloseConfirmOpen,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    resetAllConfirmOpen,
    setResetAllConfirmOpen,
    showAdvanced,
    setShowAdvanced,
    activeTab,
    setActiveTab,
    showCookieEditor,
    setShowCookieEditor,
  };
}
