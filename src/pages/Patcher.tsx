import { useEffect, useState } from 'react';
import {
  Search,
  Download,
  Trash2,
  CheckCircle,
  XCircle,
  RefreshCw,
  AlertCircle,
  Archive,
  RotateCcw,
  Loader2,
  Code2,
  Wind,
  Terminal,
  Code,
  Info,
  Settings as SettingsIcon,
} from 'lucide-react';
import Header from '../components/layout/Header';
import { usePatcherStore } from '../stores/patcher';
import { useAppStore } from '../stores/app';
import { t } from '../lib/i18n';
import type { DetectedIDE, UIBackupInfo } from '../types';

const IDE_CONFIG: Record<string, { icon: React.ReactNode; gradient: string; label: string }> = {
  kiro: { icon: <Code2 size={18} />, gradient: 'from-purple-500 to-violet-600', label: 'Kiro' },
  windsurf: { icon: <Wind size={18} />, gradient: 'from-teal-400 to-cyan-500', label: 'Windsurf' },
  trae: { icon: <Terminal size={18} />, gradient: 'from-orange-500 to-amber-500', label: 'Trae' },
  vscode: { icon: <Code2 size={18} />, gradient: 'from-blue-500 to-blue-600', label: 'VS Code' },
  vscodium: { icon: <Code2 size={18} />, gradient: 'from-green-500 to-emerald-600', label: 'VSCodium' },
  other: { icon: <Terminal size={18} />, gradient: 'from-slate-500 to-slate-600', label: 'Other' },
};

// Patch versions configuration
const PATCH_VERSIONS: Record<string, Array<{ id: string; label: string; description: string }>> = {
  kiro: [
    { id: 'v2', label: 'v2', description: 'Injection-based patch (stable)' },
    { id: 'v3', label: 'v3', description: 'Enhanced spoofing + injection' },
  ],
  windsurf: [
    { id: 'v1', label: 'v1', description: 'Standard patch' },
  ],
  trae: [
    { id: 'v1', label: 'v1', description: 'Pro features unlock' },
  ],
};

// Patch options configuration (checkboxes)
const PATCH_OPTIONS: Record<string, Array<{ id: string; label: string; description: string; defaultEnabled: boolean }>> = {
  kiro: [
    { id: 'logRequests', label: 'Log API requests', description: 'Enable detailed request logging', defaultEnabled: false },
    { id: 'spoofFingerprint', label: 'Spoof fingerprint', description: 'Randomize hardware fingerprint', defaultEnabled: true },
    { id: 'bypassRateLimit', label: 'Bypass rate limits', description: 'Remove API rate limiting', defaultEnabled: true },
  ],
  windsurf: [
    { id: 'logRequests', label: 'Log API requests', description: 'Enable detailed request logging', defaultEnabled: false },
  ],
  trae: [
    { id: 'unlockPro', label: 'Unlock Pro features', description: 'Enable all Pro functionality', defaultEnabled: true },
    { id: 'removeWatermark', label: 'Remove watermark', description: 'Hide Pro badge', defaultEnabled: false },
  ],
};

const getIDEIcon = (type: string) => (IDE_CONFIG[type] || IDE_CONFIG.other).icon;
const getIDEGradient = (type: string) => (IDE_CONFIG[type] || IDE_CONFIG.other).gradient;
const getIDELabel = (type: string) => (IDE_CONFIG[type] || IDE_CONFIG.other).label;

const truncateMiddle = (path: string, maxLength: number = 50): string => {
  if (path.length <= maxLength) return path;
  const parts = path.split(/[/\\]/);
  if (parts.length <= 2) return path;
  const fileName = parts[parts.length - 1];
  const firstPart = parts[0];
  const remaining = maxLength - firstPart.length - fileName.length - 5;
  if (remaining < 0) return `...${fileName}`;
  return `${firstPart}${parts.length > 2 ? '/.../' : '/'}${fileName}`;
};

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (dateStr: string): string => {
  return new Date(dateStr).toLocaleDateString(undefined, { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
};

export default function PatcherV2() {
  const { language } = useAppStore();
  const {
    detectedIDEs,
    backups,
    scanning,
    backupsLoading,
    error,
    operationInProgress,
    patchStrategy,
    logRequests,
    setPatchStrategy,
    setLogRequests,
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

  useEffect(() => {
    scanForIDEs();
    listBackups();
  }, [scanForIDEs, listBackups]);

  // Auto-select first IDE
  useEffect(() => {
    if (!selectedIDE && detectedIDEs.length > 0) {
      setSelectedIDE(detectedIDEs[0].id);
    }
  }, [detectedIDEs, selectedIDE]);

  // Initialize patch options for each IDE
  useEffect(() => {
    const newOptions: Record<string, Record<string, boolean>> = {};
    detectedIDEs.forEach(ide => {
      if (!patchOptions[ide.id]) {
        const ideOptions = PATCH_OPTIONS[ide.type] || [];
        newOptions[ide.id] = {};
        ideOptions.forEach(opt => {
          newOptions[ide.id][opt.id] = opt.defaultEnabled;
        });
      }
    });
    if (Object.keys(newOptions).length > 0) {
      setPatchOptions(prev => ({ ...prev, ...newOptions }));
    }
  }, [detectedIDEs]);

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
        message: String(error) 
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
        message: String(error) 
      });
    }
  };

  const togglePatchOption = (ideId: string, optionId: string) => {
    setPatchOptions(prev => ({
      ...prev,
      [ideId]: {
        ...prev[ideId],
        [optionId]: !prev[ideId]?.[optionId],
      },
    }));
  };

  const currentIDE = detectedIDEs.find(ide => ide.id === selectedIDE);
  const currentIDEBackups = currentIDE 
    ? (backups[currentIDE.id] || []) as UIBackupInfo[]
    : [];
  const isOperating = currentIDE ? !!operationInProgress[currentIDE.id] : false;
  const operation = currentIDE ? operationInProgress[currentIDE.id] : null;

  const availableVersions = currentIDE ? PATCH_VERSIONS[currentIDE.type] || [] : [];
  const availableOptions = currentIDE ? PATCH_OPTIONS[currentIDE.type] || [] : [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header 
        title={t('patcher.title')} 
        subtitle={t('patcher.subtitle')} 
        icon={<Code size={18} />} 
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1400px] mx-auto flex flex-col gap-6">
          
          {/* Error Alert */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center gap-3">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-sm text-red-400 flex-1">{error}</p>
              <button 
                onClick={clearError} 
                className="text-red-400 hover:text-red-300"
              >
                <XCircle size={16} />
              </button>
            </div>
          )}

          {/* Scan Control */}
          <section className="glass-card p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  {t('patcher.detectedIdes')}
                </h2>
                <p className="text-2xs text-slate-500 mt-0.5">
                  {t('patcher.scanDescription')}
                </p>
              </div>
              <button 
                onClick={handleScan} 
                disabled={scanning} 
                className="btn-primary py-1.5 text-xs"
              >
                {scanning ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    {t('patcher.scanning')}
                  </>
                ) : (
                  <>
                    <Search size={14} />
                    {t('patcher.scanForIdes')}
                  </>
                )}
              </button>
            </div>
          </section>

          {/* IDE Tabs */}
          {detectedIDEs.length > 0 && (
            <section className="glass-card overflow-hidden">
              {/* Tabs Header */}
              <div className="flex items-center gap-1 p-2 border-b border-white/[0.05] overflow-x-auto scrollbar-thin">
                {detectedIDEs.map((ide: DetectedIDE) => {
                  const isActive = selectedIDE === ide.id;
                  return (
                    <button
                      key={ide.id}
                      onClick={() => setSelectedIDE(ide.id)}
                      className={`
                        flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                        transition-all whitespace-nowrap
                        ${isActive 
                          ? 'bg-white/10 text-white shadow-sm' 
                          : 'text-slate-400 hover:text-white hover:bg-white/5'
                        }
                      `}
                    >
                      <div className={`
                        w-6 h-6 rounded-md bg-gradient-to-br ${getIDEGradient(ide.type)} 
                        flex items-center justify-center text-white shrink-0
                      `}>
                        {getIDEIcon(ide.type)}
                      </div>
                      <span>{getIDELabel(ide.type)}</span>
                      {ide.isPatched ? (
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-slate-600" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Tab Content */}
              {currentIDE && (
                <div className="p-6 space-y-6">
                  
                  {/* Information Section */}
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                      <Info size={14} className="text-slate-500" />
                      {t('patcher.information')}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="bg-white/[0.02] rounded-lg p-3">
                        <p className="text-2xs text-slate-500 mb-1">Status</p>
                        <div className="flex items-center gap-2">
                          {isOperating ? (
                            <>
                              <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                              <span className="text-sm text-indigo-400 capitalize">
                                {operation === 'patching' ? t('patcher.patching') : 
                                 operation === 'unpatching' ? t('patcher.unpatching') : 
                                 t('patcher.restoring')}...
                              </span>
                            </>
                          ) : currentIDE.isPatched ? (
                            <>
                              <CheckCircle className="w-4 h-4 text-emerald-400" />
                              <span className="text-sm text-emerald-400">
                                {t('status.patched')}
                              </span>
                            </>
                          ) : (
                            <>
                              <XCircle className="w-4 h-4 text-slate-500" />
                              <span className="text-sm text-slate-500">
                                {t('status.notPatched')}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="bg-white/[0.02] rounded-lg p-3">
                        <p className="text-2xs text-slate-500 mb-1">Version</p>
                        <p className="text-sm text-white font-mono">
                          {currentIDE.patchVersion || currentIDE.version || 'N/A'}
                        </p>
                      </div>
                      <div className="bg-white/[0.02] rounded-lg p-3">
                        <p className="text-2xs text-slate-500 mb-1">Path</p>
                        <p className="text-sm text-white font-mono truncate" title={currentIDE.path}>
                          {currentIDE.path ? truncateMiddle(currentIDE.path) : 'Not found'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Patch Section */}
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                      <SettingsIcon size={14} className="text-slate-500" />
                      {t('patcher.patchSettings')}
                    </h3>
                    
                    <div className="bg-white/[0.02] rounded-lg p-4 space-y-4">
                      {/* Patch Version Selection */}
                      {availableVersions.length > 1 && (
                        <div>
                          <label className="text-xs text-slate-400 block mb-2">
                            Patch Version
                          </label>
                          <div className="space-y-2">
                            {availableVersions.map(version => (
                              <label 
                                key={version.id}
                                className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] cursor-pointer transition-colors"
                              >
                                <input
                                  type="radio"
                                  name={`version-${currentIDE.id}`}
                                  value={version.id}
                                  checked={selectedPatchVersion[currentIDE.id] === version.id || 
                                          (!selectedPatchVersion[currentIDE.id] && currentIDE.patchVersion === version.id)}
                                  onChange={() => setSelectedPatchVersion(prev => ({
                                    ...prev,
                                    [currentIDE.id]: version.id
                                  }))}
                                  className="mt-0.5 w-4 h-4 rounded-full border-white/20 bg-white/10 text-primary focus:ring-0 focus:ring-offset-0"
                                />
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm text-white font-medium">
                                      {version.label}
                                    </span>
                                    {currentIDE.patchVersion === version.id && (
                                      <span className="text-2xs px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                                        Current
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-2xs text-slate-500 mt-0.5">
                                    {version.description}
                                  </p>
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Patch Options (Checkboxes) */}
                      {availableOptions.length > 0 && (
                        <div>
                          <label className="text-xs text-slate-400 block mb-2">
                            Patch Options
                          </label>
                          <div className="space-y-2">
                            {availableOptions.map(option => (
                              <label 
                                key={option.id}
                                className="flex items-start gap-3 p-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] cursor-pointer transition-colors"
                              >
                                <input
                                  type="checkbox"
                                  checked={patchOptions[currentIDE.id]?.[option.id] ?? option.defaultEnabled}
                                  onChange={() => togglePatchOption(currentIDE.id, option.id)}
                                  className="mt-0.5 w-4 h-4 rounded border-white/20 bg-white/10 text-primary focus:ring-0 focus:ring-offset-0"
                                />
                                <div className="flex-1">
                                  <span className="text-sm text-white font-medium block">
                                    {option.label}
                                  </span>
                                  <p className="text-2xs text-slate-500 mt-0.5">
                                    {option.description}
                                  </p>
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Global Settings */}
                      <div className="pt-3 border-t border-white/[0.05]">
                        <label className="text-xs text-slate-400 block mb-2">
                          Global Settings
                        </label>
                        <div className="space-y-2">
                          <label className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] cursor-pointer transition-colors">
                            <input
                              type="checkbox"
                              checked={logRequests}
                              onChange={(e) => setLogRequests(e.target.checked)}
                              className="w-4 h-4 rounded border-white/20 bg-white/10 text-primary focus:ring-0 focus:ring-offset-0"
                            />
                            <div className="flex-1">
                              <span className="text-sm text-white font-medium block">
                                {t('patcher.logRequests')}
                              </span>
                              <p className="text-2xs text-slate-500 mt-0.5">
                                Enable detailed API request logging
                              </p>
                            </div>
                          </label>
                          <div className="p-3 rounded-lg bg-white/[0.02]">
                            <label className="text-sm text-white font-medium block mb-2">
                              {t('patcher.strategy')}
                            </label>
                            <select
                              value={patchStrategy}
                              onChange={(e) => setPatchStrategy(e.target.value as 'injection' | 'legacy')}
                              className="input-deep w-full text-xs rounded-md px-3 py-2"
                            >
                              <option value="injection">Injection (Recommended)</option>
                              <option value="legacy">Legacy (Regex)</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-3 pt-3">
                        {currentIDE.isPatched ? (
                          <button
                            onClick={() => handleUnpatch(currentIDE.id)}
                            disabled={isOperating || !currentIDE.canPatch}
                            className="btn-danger flex-1"
                          >
                            <Trash2 size={16} />
                            {t('patcher.removePatch')}
                          </button>
                        ) : (
                          <button
                            onClick={() => handlePatch(currentIDE.id)}
                            disabled={isOperating || !currentIDE.canPatch}
                            className="btn-primary flex-1"
                          >
                            <Download size={16} />
                            {t('patcher.applyPatch')}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Backups Section */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                        <Archive size={14} className="text-slate-500" />
                        {t('patcher.backups')} ({currentIDEBackups.length})
                      </h3>
                      <button
                        onClick={() => listBackups()}
                        disabled={backupsLoading}
                        className="btn-ghost text-xs py-1 px-2"
                      >
                        <RefreshCw size={12} className={backupsLoading ? 'animate-spin' : ''} />
                        {t('common.refresh')}
                      </button>
                    </div>

                    {backupsLoading && currentIDEBackups.length === 0 ? (
                      <div className="text-center py-8 text-slate-500 flex flex-col items-center gap-2">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span className="text-xs">{t('patcher.loadingBackups')}</span>
                      </div>
                    ) : currentIDEBackups.length === 0 ? (
                      <div className="text-center py-8 text-slate-600 bg-white/[0.02] rounded-lg">
                        <Archive className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-xs">{t('patcher.noBackups')}</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {currentIDEBackups.map((backup: UIBackupInfo) => {
                          const isRestoring = operationInProgress[backup.ideId] === 'restoring';
                          return (
                            <div
                              key={backup.id}
                              className="flex items-center gap-3 p-3 bg-white/[0.02] rounded-lg hover:bg-white/[0.04] transition-colors"
                            >
                              <div className="w-8 h-8 rounded bg-white/[0.05] flex items-center justify-center text-slate-500 shrink-0">
                                <Archive size={16} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-medium text-white truncate block">
                                  {backup.ideName}
                                </span>
                                <span className="text-[10px] text-slate-600">
                                  {formatDate(backup.createdAt)} • {formatSize(backup.size)}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => handleRestoreBackup(backup.id)}
                                  disabled={isRestoring || !backup.isValid}
                                  className="p-1.5 text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 rounded disabled:opacity-40"
                                  title={t('patcher.restore')}
                                >
                                  {isRestoring ? (
                                    <Loader2 size={14} className="animate-spin" />
                                  ) : (
                                    <RotateCcw size={14} />
                                  )}
                                </button>
                                <button
                                  onClick={() => handleDeleteBackup(backup.id)}
                                  className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded"
                                  title={t('common.delete')}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
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
                Click "Scan for IDEs" to detect installed IDEs
              </p>
              <button onClick={handleScan} className="btn-primary">
                <Search size={16} />
                {t('patcher.scanForIdes')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
