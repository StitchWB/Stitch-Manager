import { useEffect, useMemo, useState } from 'react';

import { Search, AlertCircle, XCircle, Code, Settings as SettingsIcon, Code2 } from 'lucide-react';
import Header from '../components/layout/Header';
import { usePatcherStore } from '../stores/patcher';
import { useAppStore } from '../stores/app';
import { t } from '../lib/i18n';
import type { UIBackupInfo } from '../types/ui';
import { PATCH_VERSIONS, PATCH_OPTIONS } from '../constants/patcher';
import {
  IDEGrid,
  IDEInfoPanel,
  PatchActionsBar,
  BackupsList,
  PatcherSettingsDrawer,
} from '../components/patcher';

import { getKiroPatchConfig, saveKiroPatchConfig } from '@/lib/tauri';
import type { KiroPatchConfig } from '../types/kiro-patch';
import { Button, ButtonBase } from '@/components/ui';

export default function PatcherV2() {
  const { language } = useAppStore();
  const {
    detectedIDEs,
    backups,
    scanning,
    backupsLoading,
    error,
    operationInProgress,
    detectIDEs: scanForIDEs,
    applyPatch,
    removePatch,
    listBackups,
    restoreBackup,
    deleteBackup,
    clearError,
  } = usePatcherStore();

  void language;

  const [selectedIDE, setSelectedIDE] = useState<string | null>(null);
  const [selectedPatchVersion, setSelectedPatchVersion] = useState<Record<string, string>>({});
  const [patchOptions, setPatchOptions] = useState<Record<string, Record<string, boolean>>>({});
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);
  const [kiroPatchConfig, setKiroPatchConfig] = useState<KiroPatchConfig | null>(null);

  const currentIDE = detectedIDEs.find(ide => ide.id === selectedIDE);
  const currentIDEBackups = currentIDE ? ((backups[currentIDE.id] || []) as UIBackupInfo[]) : [];
  const isOperating = currentIDE ? !!operationInProgress[currentIDE.id] : false;
  const operation = currentIDE ? operationInProgress[currentIDE.id] : null;

  const availableVersions = currentIDE ? PATCH_VERSIONS[currentIDE.type] || [] : [];
  const availableOptions = currentIDE ? PATCH_OPTIONS[currentIDE.type] || [] : [];

  useEffect(() => {
    scanForIDEs();
    listBackups();
  }, [scanForIDEs, listBackups]);

  // Load config once
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const config = await getKiroPatchConfig();
        if (!cancelled) {
          queueMicrotask(() => setKiroPatchConfig(config));
        }
      } catch (err) {
        console.error('Failed to load Kiro patch config:', err);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const configDrivenPatchOptions = useMemo(() => {
    if (!kiroPatchConfig) return null;
    const computed: Record<string, Record<string, boolean>> = {};

    detectedIDEs.forEach(ide => {
      const ideOptions = PATCH_OPTIONS[ide.type] || [];
      computed[ide.id] = {};

      if (ide.type === 'kiro') {
        ideOptions.forEach(opt => {
          const savedValue =
            kiroPatchConfig.modules[opt.id as keyof typeof kiroPatchConfig.modules];
          computed[ide.id][opt.id] = savedValue !== undefined ? savedValue : opt.defaultEnabled;
        });
      } else {
        ideOptions.forEach(opt => {
          computed[ide.id][opt.id] = opt.defaultEnabled;
        });
      }
    });

    return computed;
  }, [detectedIDEs, kiroPatchConfig]);

  useEffect(() => {
    if (!configDrivenPatchOptions) return;
    queueMicrotask(() => {
      setPatchOptions(prev => {
        const next = { ...prev };
        for (const [ideId, options] of Object.entries(configDrivenPatchOptions)) {
          if (!next[ideId]) {
            next[ideId] = options;
          }
        }
        return next;
      });
    });
  }, [configDrivenPatchOptions]);

  // Auto-select first IDE
  useEffect(() => {
    if (!selectedIDE && detectedIDEs.length > 0) {
      queueMicrotask(() => setSelectedIDE(detectedIDEs[0].id));
    }
  }, [detectedIDEs, selectedIDE]);

  const handleScan = async () => {
    clearError();
    await scanForIDEs();
    await listBackups();
  };

  const handlePatch = async (ideId: string) => {
    clearError();
    try {
      await applyPatch(ideId, true);
    } catch (err) {
      console.error('Patch failed:', err);
      const { addNotification } = useAppStore.getState();
      addNotification({
        type: 'error',
        title: t('patcher.patchFailed'),
        message: String(err),
      });
    }
  };

  const handleUnpatch = async (ideId: string) => {
    clearError();
    try {
      await removePatch(ideId, true);
    } catch (err) {
      console.error('Unpatch failed:', err);
      const { addNotification } = useAppStore.getState();
      addNotification({
        type: 'error',
        title: t('patcher.unpatchFailed'),
        message: String(err),
      });
    }
  };

  const handleRestoreBackup = async (backupId: string) => {
    clearError();
    try {
      await restoreBackup(backupId);
      await listBackups();
    } catch (error) {
      const { addNotification } = useAppStore.getState();
      addNotification({
        type: 'error',
        title: t('patcher.restoreFailed'),
        message: String(error),
      });
    }
  };

  const handleDeleteBackup = async (backupId: string) => {
    clearError();
    try {
      await deleteBackup(backupId);
      await listBackups();
    } catch (error) {
      const { addNotification } = useAppStore.getState();
      addNotification({
        type: 'error',
        title: t('patcher.deleteFailed'),
        message: String(error),
      });
    }
  };

  const togglePatchOption = async (ideId: string, optionId: string) => {
    const newValue = !patchOptions[ideId]?.[optionId];

    // Update local state
    setPatchOptions(prev => ({
      ...prev,
      [ideId]: {
        ...prev[ideId],
        [optionId]: newValue,
      },
    }));

    // Save to Kiro patch config if this is Kiro IDE
    const ide = detectedIDEs.find(i => i.id === ideId);
    if (ide?.type === 'kiro' && kiroPatchConfig) {
      try {
        const updatedConfig: KiroPatchConfig = {
          ...kiroPatchConfig,
          modules: {
            ...kiroPatchConfig.modules,
            [optionId]: newValue,
          },
        };
        await saveKiroPatchConfig(updatedConfig);
        setKiroPatchConfig(updatedConfig);
      } catch (err) {
        console.error('Failed to save patch options:', err);
        const { addNotification } = useAppStore.getState();
        addNotification({
          type: 'error',
          title: 'Failed to save options',
          message: String(err),
        });
      }
    }
  };

  const toggleAllOptions = async (enable: boolean) => {
    if (!currentIDE) return;
    const newOpts = { ...patchOptions[currentIDE.id] };
    const options = PATCH_OPTIONS[currentIDE.type] || [];
    options.forEach(opt => {
      newOpts[opt.id] = enable;
    });

    // Update local state
    setPatchOptions(prev => ({ ...prev, [currentIDE.id]: newOpts }));

    // Save to Kiro patch config if this is Kiro IDE
    if (currentIDE.type === 'kiro' && kiroPatchConfig) {
      try {
        const updatedModules = { ...kiroPatchConfig.modules };
        options.forEach(opt => {
          updatedModules[opt.id as keyof typeof updatedModules] = enable;
        });

        const updatedConfig: KiroPatchConfig = {
          ...kiroPatchConfig,
          modules: updatedModules,
        };
        await saveKiroPatchConfig(updatedConfig);
        setKiroPatchConfig(updatedConfig);
      } catch (err) {
        console.error('Failed to save patch options:', err);
        const { addNotification } = useAppStore.getState();
        addNotification({
          type: 'error',
          title: 'Failed to save options',
          message: String(err),
        });
      }
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('patcher.title')}
        subtitle={t('patcher.subtitle')}
        icon={<Code size={18} />}
        actions={
          <Button
            onClick={() => setShowSettingsDrawer(true)}
            variant="primary"
            size="sm"
            leftIcon={<SettingsIcon size={14} />}
            className="shadow-lg shadow-indigo-500/20"
          >
            {t('patcher.advancedSettings')}
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1400px] mx-auto flex flex-col gap-6">
          {/* Error Alert */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center gap-3">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-sm text-red-400 flex-1">{error}</p>
              <ButtonBase
                type="button"
                onClick={clearError}
                className="text-red-400 hover:text-red-300"
              >
                <XCircle size={16} />
              </ButtonBase>
            </div>
          )}

          {/* Scan Control */}
          <section className="glass-card p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">{t('patcher.detectedIdes')}</h2>
                <p className="text-2xs text-slate-500 mt-0.5">{t('patcher.scanDescription')}</p>
              </div>
              <Button
                onClick={handleScan}
                disabled={scanning}
                variant="primary"
                size="sm"
                leftIcon={
                  scanning ? <Search size={14} className="animate-spin" /> : <Search size={14} />
                }
              >
                {scanning ? t('patcher.scanning') : t('patcher.scanForIdes')}
              </Button>
            </div>
          </section>

          {/* IDE Tabs and Content */}
          {detectedIDEs.length > 0 && (
            <section className="glass-card overflow-hidden">
              <IDEGrid ides={detectedIDEs} selectedIDE={selectedIDE} onSelectIDE={setSelectedIDE} />

              {currentIDE && (
                <div className="p-6 space-y-6">
                  {/* Information Section */}
                  <IDEInfoPanel
                    ide={currentIDE}
                    isOperating={isOperating}
                    operation={operation as 'patching' | 'unpatching' | 'restoring' | null}
                  />

                  {/* Patch Actions */}
                  <PatchActionsBar
                    isPatched={currentIDE.isPatched}
                    canPatch={currentIDE.canPatch}
                    isOperating={isOperating}
                    availableVersions={availableVersions}
                    availableOptions={availableOptions}
                    selectedVersion={selectedPatchVersion[currentIDE.id]}
                    currentPatchVersion={currentIDE.patchVersion}
                    selectedOptions={patchOptions[currentIDE.id] || {}}
                    onPatch={() => handlePatch(currentIDE.id)}
                    onUnpatch={() => handleUnpatch(currentIDE.id)}
                    onSelectVersion={versionId =>
                      setSelectedPatchVersion(prev => ({
                        ...prev,
                        [currentIDE.id]: versionId,
                      }))
                    }
                    onToggleOption={optionId => togglePatchOption(currentIDE.id, optionId)}
                    onToggleAllOptions={toggleAllOptions}
                  />

                  {/* Backups Section */}
                  <BackupsList
                    backups={currentIDEBackups}
                    isLoading={backupsLoading}
                    operationInProgress={operationInProgress}
                    onRestore={handleRestoreBackup}
                    onDelete={handleDeleteBackup}
                    onRefresh={listBackups}
                  />
                </div>
              )}
            </section>
          )}

          {/* Empty State */}
          {!scanning && detectedIDEs.length === 0 && (
            <div className="glass-card p-12 text-center">
              <Code2 className="w-12 h-12 mx-auto mb-4 text-slate-600" />
              <h3 className="text-lg font-semibold text-white mb-2">
                {t('patcher.noIdesDetected')}
              </h3>
              <p className="text-sm text-slate-500 mb-6">
                {t('patcher.noIdesDetectedDescription')}
              </p>
              <Button onClick={handleScan} variant="primary" leftIcon={<Search size={16} />}>
                {t('patcher.scanForIdes')}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Patcher Settings Drawer */}
      <PatcherSettingsDrawer
        isOpen={showSettingsDrawer}
        onClose={() => setShowSettingsDrawer(false)}
      />
    </div>
  );
}
