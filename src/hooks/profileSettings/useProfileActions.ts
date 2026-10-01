import { useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import {
  deleteFingerprintProfile,
  listFingerprintProfiles,
  loadFingerprintProfile,
  renameFingerprintProfileAlias,
  saveFingerprintProfile,
  saveProfileSettings,
  type BrowserFingerprintProfile,
  type ProfileSettingsV1,
} from '@/lib/backend/modules/profiles';
import { copyToClipboard, openInFileManager } from '@/lib/backend/modules/utils';
import {
  ensureProxySaveUseAllowed,
  ProxyLibraryError,
  type ProxyLibraryEntry,
} from '@/lib/backend/modules/proxyLibrary';
import {
  buildUniqueDuplicateAlias,
  extractActionErrorMessage,
  mergeSettings,
} from './schema';

interface UseProfileActionsParams {
  currentAlias: string;
  aliasDraft: string;
  draft: ProfileSettingsV1;
  aliasValidationError: string | null;
  proxyLibrary: ProxyLibraryEntry[];
  applyLoadedState: (targetAlias: string, settings: ProfileSettingsV1) => void;
  refreshAliases: () => Promise<void>;
  setError: Dispatch<SetStateAction<string | null>>;
  setDeleteConfirmOpen: Dispatch<SetStateAction<boolean>>;
  onSaved?: () => void;
  onClose: () => void;
}

export function useProfileActions({
  currentAlias,
  aliasDraft,
  draft,
  aliasValidationError,
  proxyLibrary,
  applyLoadedState,
  refreshAliases,
  setError,
  setDeleteConfirmOpen,
  onSaved,
  onClose,
}: UseProfileActionsParams) {
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    if (!currentAlias || saving) return;
    setSaving(true);
    setError(null);

    try {
      if (aliasValidationError) {
        setError(aliasValidationError);
        return;
      }
      const nextAlias = aliasDraft.trim();

      const normalized = mergeSettings({
        ...draft,
        version: 1,
      });

      if (normalized.network.proxy?.enabled) {
        const selectedId = normalized.network.proxy.proxyLibraryId?.trim() ?? '';
        if (!selectedId) {
          setError(t('profileProxy.addProxyTestRequiredMessage'));
          return;
        }

        const selectedProxy = proxyLibrary.find(item => item.id === selectedId) ?? null;
        if (!selectedProxy) {
          setError(t('profileProxy.addProxyTestRequiredMessage'));
          return;
        }

        let guardOk = true;
        try {
          guardOk = await ensureProxySaveUseAllowed({
            proxyLibraryId: selectedId,
          });
        } catch (guardError) {
          if (guardError instanceof ProxyLibraryError) {
            const isGuardFailure = guardError.code === 'proxy_save_use_guard_failed';
            if (isGuardFailure) {
              setError(t('profileProxy.addProxyTestRequiredMessage'));
              return;
            }
            const guardMessage = guardError.message?.trim();
            if (guardMessage) {
              setError(guardMessage);
              return;
            }
          }
          guardOk = false;
        }

        if (!guardOk) {
          setError(t('profileProxy.addProxyTestRequiredMessage'));
          return;
        }
      }

      let savedAlias = currentAlias;
      if (nextAlias !== currentAlias) {
        await renameFingerprintProfileAlias({
          currentAlias,
          nextAlias,
        });
        savedAlias = nextAlias;
      }

      await saveProfileSettings({ alias: savedAlias, settings: normalized });
      applyLoadedState(savedAlias, normalized);
      await refreshAliases();
      toast.success(t('common.saved') || 'Saved');
      onSaved?.();
      onClose();
    } catch (e) {
      console.error('[ProfileSettingsModal] Failed to save settings:', e);
      setError(
        extractActionErrorMessage(e, t('common.error') || 'Failed to save profile settings')
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicateProfile = async () => {
    if (!currentAlias || duplicating) return;
    if (aliasValidationError) {
      setError(aliasValidationError);
      return;
    }
    setDuplicating(true);
    setError(null);

    try {
      const aliases = await listFingerprintProfiles();
      const duplicateAlias = buildUniqueDuplicateAlias(currentAlias, aliases);

      // Fingerprint file exists only on legacy profiles; settings-only profiles have none to copy.
      const source = await loadFingerprintProfile({ email: currentAlias });
      if (source) {
        await saveFingerprintProfile({
          email: duplicateAlias,
          profile: source as BrowserFingerprintProfile,
        });
      }

      const normalized = mergeSettings({
        ...draft,
        version: 1,
      });
      await saveProfileSettings({ alias: duplicateAlias, settings: normalized });

      await refreshAliases();
      toast.success(`Profile duplicated: ${duplicateAlias}`);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to duplicate profile');
    } finally {
      setDuplicating(false);
    }
  };

  const handleDeleteProfile = async () => {
    if (!currentAlias || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteFingerprintProfile({ email: currentAlias });
      toast.success(t('accounts.profileDeleteSuccess') || 'Profile deleted');
      setDeleteConfirmOpen(false);
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('accounts.profileDeleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  const handleCopyPath = async (value: string | null | undefined, label: string) => {
    const text = value?.trim();
    if (!text) {
      toast.error(`${label} is empty`);
      return;
    }

    try {
      await copyToClipboard({ text });
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Failed to copy ${label.toLowerCase()}`);
    }
  };

  const handleOpenPath = async (value: string | null | undefined, label: string) => {
    const text = value?.trim();
    if (!text) {
      toast.error(`${label} is empty`);
      return;
    }

    try {
      await openInFileManager({ path: text });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Failed to open ${label.toLowerCase()}`);
    }
  };

  return {
    saving,
    duplicating,
    deleting,
    handleSave,
    handleDuplicateProfile,
    handleDeleteProfile,
    handleCopyPath,
    handleOpenPath,
  };
}
