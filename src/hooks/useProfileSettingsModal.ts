import { useCallback, useEffect } from 'react';

import { useProfileModalUiState } from './profileSettings/useProfileModalUiState';
import { useProfileDraftState } from './profileSettings/useProfileDraftState';
import { useProfileProxyManager } from './profileSettings/useProfileProxyManager';
import { useProfileActions } from './profileSettings/useProfileActions';
import { useProfileImportExport } from './profileSettings/useProfileImportExport';

export type { SettingsTab } from './profileSettings/schema';
export {
  defaultSettings,
  mergeSettings,
  cloneSettings,
  windowModeOptions,
  windowPresetOptions,
  parsePositiveIntOrNull,
  sanitizeAlias,
  makeUniqueAlias,
  buildUniqueDuplicateAlias,
  extractActionErrorMessage,
} from './profileSettings/schema';

export interface UseProfileSettingsModalParams {
  alias: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function useProfileSettingsModal({ alias, isOpen, onClose, onSaved }: UseProfileSettingsModalParams) {
  const ui = useProfileModalUiState();

  const draftState = useProfileDraftState({
    alias,
    isOpen,
    activeTab: ui.activeTab,
    setShowAdvanced: ui.setShowAdvanced,
    setShowCookieEditor: ui.setShowCookieEditor,
    setResetAllConfirmOpen: ui.setResetAllConfirmOpen,
  });

  const proxy = useProfileProxyManager({
    alias,
    isOpen,
    draft: draftState.draft,
    patchProxy: draftState.patchProxy,
  });

  const actions = useProfileActions({
    currentAlias: draftState.currentAlias,
    aliasDraft: draftState.aliasDraft,
    draft: draftState.draft,
    aliasValidationError: draftState.aliasValidationError,
    proxyLibrary: proxy.proxyLibrary,
    applyLoadedState: draftState.applyLoadedState,
    refreshAliases: draftState.refreshAliases,
    setError: draftState.setError,
    setDeleteConfirmOpen: ui.setDeleteConfirmOpen,
    onSaved,
    onClose,
  });

  const importExport = useProfileImportExport({
    currentAlias: draftState.currentAlias,
    isOpen,
    existingAliases: draftState.existingAliases,
    applyLoadedState: draftState.applyLoadedState,
    refreshAliases: draftState.refreshAliases,
    handleMakeAliasSafeBase: draftState.handleMakeAliasSafeBase,
    setError: draftState.setError,
    onSaved,
    onClose,
  });

  const { saving, duplicating, deleting } = actions;
  const { addProxySaving } = proxy;
  const { exportingBundle, importingBundle } = importExport;
  const { dirty } = draftState;
  const { setCloseConfirmOpen } = ui;

  const requestClose = useCallback(() => {
    if (saving || addProxySaving || duplicating || deleting || exportingBundle || importingBundle) {
      return;
    }

    if (dirty) {
      setCloseConfirmOpen(true);
      return;
    }

    onClose();
  }, [
    addProxySaving,
    deleting,
    dirty,
    duplicating,
    exportingBundle,
    importingBundle,
    onClose,
    saving,
    setCloseConfirmOpen,
  ]);

  useEffect(() => {
    if (!isOpen) return;

    const onEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        requestClose();
      }
    };

    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [isOpen, requestClose, saving]);

  return {
    draft: draftState.draft,
    aliasDraft: draftState.aliasDraft,
    loading: draftState.loading,
    saving: actions.saving,
    duplicating: actions.duplicating,
    deleting: actions.deleting,
    exportingBundle: importExport.exportingBundle,
    importingBundle: importExport.importingBundle,
    error: draftState.error,
    dirty: draftState.dirty,
    closeConfirmOpen: ui.closeConfirmOpen,
    deleteConfirmOpen: ui.deleteConfirmOpen,
    resetAllConfirmOpen: ui.resetAllConfirmOpen,
    importConfigOpen: importExport.importConfigOpen,
    importSourcePath: importExport.importSourcePath,
    importTargetMode: importExport.importTargetMode,
    importTargetAliasDraft: importExport.importTargetAliasDraft,
    importOverwrite: importExport.importOverwrite,
    existingAliases: draftState.existingAliases,
    showAdvanced: ui.showAdvanced,
    activeTab: ui.activeTab,
    showCookieEditor: ui.showCookieEditor,
    proxyLibrary: proxy.proxyLibrary,
    proxyLibraryLoading: proxy.proxyLibraryLoading,
    addProxyModalOpen: proxy.addProxyModalOpen,
    addProxyInput: proxy.addProxyInput,
    addProxyDraft: proxy.addProxyDraft,
    addProxyParsing: proxy.addProxyParsing,
    addProxyTesting: proxy.addProxyTesting,
    addProxySaving: proxy.addProxySaving,
    addProxyError: proxy.addProxyError,
    addProxyTestResult: proxy.addProxyTestResult,
    addProxyParsed: proxy.addProxyParsed,
    addProxyLastTestOk: proxy.addProxyLastTestOk,
    requireProxyTestBeforeSave: proxy.requireProxyTestBeforeSave,
    selectedProxyTesting: proxy.selectedProxyTesting,
    selectedProxyTestResult: proxy.selectedProxyTestResult,
    selectedProxyTestError: proxy.selectedProxyTestError,

    proxyEnabled: draftState.proxyEnabled,
    proxyLibraryId: draftState.proxyLibraryId,
    proxyMode: draftState.proxyMode,
    selectedLibraryProxy: proxy.selectedLibraryProxy,
    hasManualGeo: draftState.hasManualGeo,
    localeManual: draftState.localeManual,
    timezoneManual: draftState.timezoneManual,
    browserWindowMode: draftState.browserWindowMode,
    browserWindowWidth: draftState.browserWindowWidth,
    browserWindowHeight: draftState.browserWindowHeight,
    browserWindowMaximize: draftState.browserWindowMaximize,
    currentAlias: draftState.currentAlias,
    aliasValidationError: draftState.aliasValidationError,
    importNewAliasError: importExport.importNewAliasError,
    summary: draftState.summary,

    setCloseConfirmOpen: ui.setCloseConfirmOpen,
    setDeleteConfirmOpen: ui.setDeleteConfirmOpen,
    setResetAllConfirmOpen: ui.setResetAllConfirmOpen,
    setActiveTab: ui.setActiveTab,
    setShowCookieEditor: ui.setShowCookieEditor,
    setShowAdvanced: ui.setShowAdvanced,

    setAddProxyModalOpen: proxy.setAddProxyModalOpen,
    setAddProxyInput: proxy.setAddProxyInput,
    setAddProxyDraft: proxy.setAddProxyDraft,
    setAddProxyError: proxy.setAddProxyError,
    setAddProxyTestResult: proxy.setAddProxyTestResult,
    setAddProxyParsed: proxy.setAddProxyParsed,
    setAddProxyLastTestOk: proxy.setAddProxyLastTestOk,
    setRequireProxyTestBeforeSave: proxy.setRequireProxyTestBeforeSave,

    setImportConfigOpen: importExport.setImportConfigOpen,
    setImportTargetMode: importExport.setImportTargetMode,
    setImportTargetAliasDraft: importExport.setImportTargetAliasDraft,
    setImportOverwrite: importExport.setImportOverwrite,
    resetImportWorkflow: importExport.resetImportWorkflow,

    requestClose,
    handleSave: actions.handleSave,
    handleDuplicateProfile: actions.handleDuplicateProfile,
    handleDeleteProfile: actions.handleDeleteProfile,
    handleExportProfile: importExport.handleExportProfile,
    handleImportProfile: importExport.handleImportProfile,
    handleConfirmImportProfile: importExport.handleConfirmImportProfile,
    handleResetCurrentTab: draftState.handleResetCurrentTab,
    handleResetAllToDefaults: draftState.handleResetAllToDefaults,
    handleAliasChange: draftState.handleAliasChange,
    handleMakeAliasSafe: draftState.handleMakeAliasSafe,
    handleMakeImportAliasSafe: importExport.handleMakeImportAliasSafe,
    handleClearMain: draftState.handleClearMain,
    handleResetMainToDefaults: draftState.handleResetMainToDefaults,
    handleClearGeo: draftState.handleClearGeo,
    handleClearData: draftState.handleClearData,
    handleCopyPath: actions.handleCopyPath,
    handleOpenPath: actions.handleOpenPath,
    handlePickCookieFile: draftState.handlePickCookieFile,
    patchBrowserWindow: draftState.patchBrowserWindow,
    patchProxy: draftState.patchProxy,
    openAddProxyModal: proxy.openAddProxyModal,
    handleTestSelectedProxy: proxy.handleTestSelectedProxy,
    handleParseAddProxyInput: proxy.handleParseAddProxyInput,
    handleTestAddProxyDraft: proxy.handleTestAddProxyDraft,
    handleSaveAndUseAddProxy: proxy.handleSaveAndUseAddProxy,
    normalizeProxyDraft: proxy.normalizeProxyDraft,
    update: draftState.update,
  };
}
