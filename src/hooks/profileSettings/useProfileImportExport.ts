import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { openFileDialog, saveFileDialog } from '@/lib/fileDialog';
import { t } from '@/lib/i18n';
import {
  exportFingerprintProfileBundle,
  getProfileSettings,
  importFingerprintProfileBundle,
  type ProfileSettingsV1,
} from '@/lib/backend/modules/profiles';
import { defaultSettings, getAliasValidationKey } from './schema';

interface UseProfileImportExportParams {
  currentAlias: string;
  isOpen: boolean;
  existingAliases: string[];
  applyLoadedState: (targetAlias: string, settings: ProfileSettingsV1) => void;
  refreshAliases: () => Promise<void>;
  handleMakeAliasSafeBase: (raw: string, current: string) => string;
  setError: Dispatch<SetStateAction<string | null>>;
  onSaved?: () => void;
  onClose: () => void;
}

export function useProfileImportExport({
  currentAlias,
  isOpen,
  existingAliases,
  applyLoadedState,
  refreshAliases,
  handleMakeAliasSafeBase,
  setError,
  onSaved,
  onClose,
}: UseProfileImportExportParams) {
  const [exportingBundle, setExportingBundle] = useState(false);
  const [importingBundle, setImportingBundle] = useState(false);
  const [importConfigOpen, setImportConfigOpen] = useState(false);
  const [importSourcePath, setImportSourcePath] = useState<string | null>(null);
  const [importTargetMode, setImportTargetMode] = useState<'current' | 'new'>('current');
  const [importTargetAliasDraft, setImportTargetAliasDraft] = useState('');
  const [importOverwrite, setImportOverwrite] = useState(true);

  const importNewAliasValidationKey = useMemo(
    () =>
      importTargetMode === 'new'
        ? getAliasValidationKey(importTargetAliasDraft, existingAliases, '')
        : null,
    [existingAliases, importTargetAliasDraft, importTargetMode]
  );
  const importNewAliasError = importNewAliasValidationKey
    ? t(importNewAliasValidationKey) || 'Profile alias is invalid'
    : null;

  const resetImportWorkflow = useCallback(() => {
    setImportConfigOpen(false);
    setImportSourcePath(null);
    setImportTargetMode('current');
    setImportTargetAliasDraft('');
    setImportOverwrite(true);
  }, []);

  useEffect(() => {
    if (isOpen) return;
      queueMicrotask(() => {
    resetImportWorkflow();
      });
  }, [isOpen, resetImportWorkflow]);

  const handleMakeImportAliasSafe = useCallback(() => {
    const unique = handleMakeAliasSafeBase(importTargetAliasDraft, '');
    if (unique !== importTargetAliasDraft) {
      setImportTargetAliasDraft(unique);
      toast.success(t('accounts.profileSettingsAliasMakeSafeApplied') || 'Alias adjusted');
    }
  }, [handleMakeAliasSafeBase, importTargetAliasDraft]);

  const handleExportProfile = async () => {
    if (!currentAlias || exportingBundle) return;

    try {
      const suggestedName = `${currentAlias.replace(/[^a-zA-Z0-9._-]+/g, '_')}.profile.bundle.json`;
      const destination = await saveFileDialog({
        title: t('accounts.profileSettingsExportDialogTitle') || 'Export profile bundle',
        defaultPath: suggestedName,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });

      if (!destination) return;

      setExportingBundle(true);
      await exportFingerprintProfileBundle({ alias: currentAlias, destinationPath: destination });
      toast.success(t('accounts.profileSettingsExportSuccess') || 'Profile exported');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('accounts.profileSettingsExportFailed'));
    } finally {
      setExportingBundle(false);
    }
  };

  const handleImportProfile = async () => {
    if (!currentAlias || importingBundle) return;

    try {
      setError(null);
      const selected = await openFileDialog({
        title: t('accounts.profileSettingsImportDialogTitle') || 'Import profile bundle',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!selected) return;

      const sourcePath = Array.isArray(selected) ? selected[0] : selected;
      if (!sourcePath) return;

      setImportSourcePath(sourcePath);
      setImportTargetMode('current');
      setImportTargetAliasDraft('');
      setImportOverwrite(true);
      setImportConfigOpen(true);
    } catch {
      setError(t('accounts.profileSettingsImportPickFailed') || 'Failed to pick import file');
    }
  };

  const handleConfirmImportProfile = async () => {
    if (!currentAlias || importingBundle || !importSourcePath) return;

    const targetAlias = importTargetMode === 'new' ? importTargetAliasDraft.trim() : currentAlias;

    if (!targetAlias) {
      setError(t('accounts.profileSettingsAliasRequired') || 'Profile alias is required');
      return;
    }
    if (importTargetMode === 'new' && importNewAliasError) {
      setError(importNewAliasError);
      return;
    }

    try {
      setImportingBundle(true);
      setError(null);
      const importedAlias = await importFingerprintProfileBundle({
        sourcePath: importSourcePath,
        targetAlias,
        overwrite: importOverwrite,
      });

      if (importedAlias === currentAlias) {
        const record = await getProfileSettings({ alias: importedAlias });
        applyLoadedState(importedAlias, record?.settings ?? defaultSettings);
      }

      resetImportWorkflow();
      await refreshAliases();
      toast.success(t('accounts.profileSettingsImportSuccess') || 'Profile imported');
      onSaved?.();

      if (importedAlias !== currentAlias) {
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('accounts.profileSettingsImportFailed'));
    } finally {
      setImportingBundle(false);
    }
  };

  return {
    exportingBundle,
    importingBundle,
    importConfigOpen,
    importSourcePath,
    importTargetMode,
    importTargetAliasDraft,
    importOverwrite,
    importNewAliasError,
    setImportConfigOpen,
    setImportTargetMode,
    setImportTargetAliasDraft,
    setImportOverwrite,
    resetImportWorkflow,
    handleMakeImportAliasSafe,
    handleExportProfile,
    handleImportProfile,
    handleConfirmImportProfile,
  };
}
