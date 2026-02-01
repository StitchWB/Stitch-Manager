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
  HelpCircle,
  ChevronDown,
} from 'lucide-react';
import Header from '../components/layout/Header';
import { usePatcherStore } from '../stores/patcher';
import { useAppStore } from '../stores/app';
import { t } from '../lib/i18n';
import type { DetectedIDE, UIBackupInfo } from '../types';
import PatcherSettingsDrawer from '../components/patcher/PatcherSettingsDrawer';
import { Tooltip } from '../components/Tooltip';
import { Button } from '../components/ui/Button';

const IDE_CONFIG: Record<string, { icon: React.ReactNode; gradient: string; label: string }> = {
  kiro: { icon: <Code2 size={18} />, gradient: 'from-purple-500 to-violet-600', label: 'Kiro' },
  windsurf: { icon: <Wind size={18} />, gradient: 'from-teal-400 to-cyan-500', label: 'Windsurf' },
  trae: { icon: <Terminal size={18} />, gradient: 'from-orange-500 to-amber-500', label: 'Trae' },
  vscode: { icon: <Code2 size={18} />, gradient: 'from-blue-500 to-blue-600', label: 'VS Code' },
  vscodium: {
    icon: <Code2 size={18} />,
    gradient: 'from-green-500 to-emerald-600',
    label: 'VSCodium',
  },
  other: { icon: <Terminal size={18} />, gradient: 'from-slate-500 to-slate-600', label: 'Other' },
};

// Patch versions configuration
const PATCH_VERSIONS: Record<string, Array<{ id: string; label: string; description: string }>> = {
  kiro: [
    { id: 'v2', label: 'v2', description: 'Injection-based patch (stable)' },
    { id: 'v3', label: 'v3', description: 'Enhanced spoofing + injection' },
  ],
  windsurf: [{ id: 'v1', label: 'v1', description: 'Standard patch' }],
  trae: [{ id: 'v1', label: 'v1', description: 'Pro features unlock' }],
};

// Patch options configuration (checkboxes)
const PATCH_OPTIONS: Record<
  string,
  Array<{ id: string; labelKey: string; descKey: string; defaultEnabled: boolean }>
> = {
  kiro: [
    {
      id: 'machineIdSpoofing',
      labelKey: 'patcher.machineIdSpoofing',
      descKey: 'patcher.machineIdSpoofingDesc',
      defaultEnabled: true,
    },
    {
      id: 'telemetryBlocking',
      labelKey: 'patcher.blockTelemetry',
      descKey: 'patcher.blockTelemetryDesc',
      defaultEnabled: true,
    },
    {
      id: 'rateLimitBypass',
      labelKey: 'patcher.bypassRateLimits',
      descKey: 'patcher.bypassRateLimitsDesc',
      defaultEnabled: true,
    },
    {
      id: 'osSpoofing',
      labelKey: 'patcher.osSpoofing',
      descKey: 'patcher.osSpoofingDesc',
      defaultEnabled: true,
    },
    {
      id: 'commandSpoofing',
      labelKey: 'patcher.commandSpoofing',
      descKey: 'patcher.commandSpoofingDesc',
      defaultEnabled: true,
    },
    {
      id: 'constantPatching',
      labelKey: 'patcher.constantPatching',
      descKey: 'patcher.constantPatchingDesc',
      defaultEnabled: true,
    },
    {
      id: 'authWatcher',
      labelKey: 'patcher.authWatcher',
      descKey: 'patcher.authWatcherDesc',
      defaultEnabled: true,
    },
    {
      id: 'customPrompts',
      labelKey: 'patcher.customPrompts',
      descKey: 'patcher.customPromptsDesc',
      defaultEnabled: true,
    },
    {
      id: 'requestSpy',
      labelKey: 'patcher.requestSpy',
      descKey: 'patcher.requestSpyDesc',
      defaultEnabled: false,
    },
    {
      id: 'errorSuppression',
      labelKey: 'patcher.errorSuppression',
      descKey: 'patcher.errorSuppressionDesc',
      defaultEnabled: false,
    },
  ],
  windsurf: [],
  trae: [
    {
      id: 'unlockPro',
      labelKey: 'patcher.unlockPro',
      descKey: 'patcher.unlockProDesc',
      defaultEnabled: true,
    },
    {
      id: 'removeWatermark',
      labelKey: 'patcher.removeWatermark',
      descKey: 'patcher.removeWatermarkDesc',
      defaultEnabled: false,
    },
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
    minute: '2-digit',
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
    setPatchStrategy,
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

  // Settings drawer state
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false);

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

  const togglePatchOption = (ideId: string, optionId: string) => {
    setPatchOptions(prev => ({
      ...prev,
      [ideId]: {
        ...prev[ideId],
        ...{ [optionId]: !prev[ideId]?.[optionId] },
      },
    }));
  };

  const toggleAllOptions = (enable: boolean) => {
    if (!currentIDE) return;
    const newOpts = { ...patchOptions[currentIDE.id] };
    const options = PATCH_OPTIONS[currentIDE.type] || [];
    options.forEach(opt => {
      newOpts[opt.id] = enable;
    });
    setPatchOptions(prev => ({ ...prev, [currentIDE.id]: newOpts }));
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
              <button onClick={clearError} className="text-red-400 hover:text-red-300">
                <XCircle size={16} />
              </button>
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
                leftIcon={scanning ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
              >
                {scanning ? t('patcher.scanning') : t('patcher.scanForIdes')}
              </Button>
            </div>
          </section>

          {/* IDE Tabs */}
          {detectedIDEs.length > 0 && (
            <section className="glass-card overflow-hidden">
              {/* IDE Tabs */}
              <div className="flex items-center gap-2 p-1.5 border-b border-white/[0.05] overflow-x-auto scrollbar-thin pb-4">
                {detectedIDEs.map((ide: DetectedIDE) => {
                  const isActive = selectedIDE === ide.id;
                  const gradient = getIDEGradient(ide.type);

                  return (
                    <button
                      key={ide.id}
                      onClick={() => setSelectedIDE(ide.id)}
                      className={`
                        relative group flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-medium
                        transition-all duration-300 whitespace-nowrap overflow-hidden
                        ${
                          isActive
                            ? 'text-white shadow-[0_0_20px_rgba(0,0,0,0.3)] ring-1 ring-white/10'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
                        }
                      `}
                    >
                      {isActive && (
                        <div
                          className={`absolute inset-0 bg-gradient-to-r ${gradient} opacity-20`}
                        />
                      )}

                      <div
                        className={`
                        relative w-7 h-7 rounded-lg flex items-center justify-center text-white shrink-0
                        shadow-lg transition-transform duration-300 group-hover:scale-110
                        ${isActive ? `bg-gradient-to-br ${gradient}` : 'bg-white/10'}
                      `}
                      >
                        {getIDEIcon(ide.type)}
                      </div>

                      <span className="relative z-10 tracking-wide">{getIDELabel(ide.type)}</span>

                      {ide.isPatched ? (
                        <div className="relative z-10 flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.3)]">
                          <CheckCircle className="w-3 h-3" />
                        </div>
                      ) : (
                        <div className="relative z-10 flex items-center justify-center w-5 h-5 rounded-full bg-slate-500/10 text-slate-500">
                          <XCircle className="w-3 h-3" />
                        </div>
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
                    <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2 px-1">
                      <Info size={14} className="text-primary" />
                      {t('patcher.information')}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="bg-gradient-to-br from-white/[0.04] to-white/[0.01] border border-white/5 rounded-xl p-4 shadow-sm group hover:border-white/10 transition-colors">
                        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1.5 group-hover:text-slate-400 transition-colors">
                          Status
                        </p>
                        <div className="flex items-center gap-2">
                          {isOperating ? (
                            <>
                              <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                              <span className="text-sm font-medium text-indigo-400 capitalize">
                                {operation === 'patching'
                                  ? t('patcher.patching')
                                  : operation === 'unpatching'
                                    ? t('patcher.unpatching')
                                    : t('patcher.restoring')}
                                ...
                              </span>
                            </>
                          ) : currentIDE.isPatched ? (
                            <>
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
                              <span className="text-sm font-medium text-emerald-400">
                                {t('status.patched')}
                              </span>
                            </>
                          ) : (
                            <>
                              <div className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                              <span className="text-sm font-medium text-slate-400">
                                {t('status.notPatched')}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="bg-gradient-to-br from-white/[0.04] to-white/[0.01] border border-white/5 rounded-xl p-4 shadow-sm group hover:border-white/10 transition-colors">
                        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1.5 group-hover:text-slate-400 transition-colors">
                          Version
                        </p>
                        <p className="text-sm font-medium text-white font-mono">
                          {currentIDE.patchVersion || currentIDE.version || 'N/A'}
                        </p>
                      </div>

                      <div className="bg-gradient-to-br from-white/[0.04] to-white/[0.01] border border-white/5 rounded-xl p-4 shadow-sm group hover:border-white/10 transition-colors">
                        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-1.5 group-hover:text-slate-400 transition-colors">
                          Path
                        </p>
                        <p
                          className="text-sm font-medium text-white font-mono truncate"
                          title={currentIDE.path}
                        >
                          {currentIDE.path ? truncateMiddle(currentIDE.path) : 'Not found'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Patch Action Bar (Combined) */}
                  <div className="bg-gradient-to-r from-white/[0.04] to-white/[0.01] rounded-xl p-4 border border-white/5 shadow-sm">
                    <div className="flex flex-wrap items-center gap-4">
                      {/* Version Selector (Compact Pills) */}
                      {availableVersions.length > 1 && (
                        <div className="flex items-center gap-2 bg-black/20 p-1 rounded-lg">
                          {availableVersions.map(version => {
                            const isSelected =
                              selectedPatchVersion[currentIDE.id] === version.id ||
                              (!selectedPatchVersion[currentIDE.id] &&
                                currentIDE.patchVersion === version.id);
                            return (
                              <button
                                key={version.id}
                                onClick={() =>
                                  setSelectedPatchVersion(prev => ({
                                    ...prev,
                                    [currentIDE.id]: version.id,
                                  }))
                                }
                                className={`
                                  px-3 py-1.5 rounded-md text-xs font-medium transition-all
                                  ${
                                    isSelected
                                      ? 'bg-primary text-white shadow-lg shadow-primary/25'
                                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                                  }
                                `}
                              >
                                {version.label}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Strategy Selector (Inline) */}
                      <div className="relative">
                        <select
                          value={patchStrategy}
                          onChange={e => setPatchStrategy(e.target.value as 'injection' | 'legacy')}
                          className="appearance-none bg-[#0a0a0c]/50 border border-white/10 text-white text-xs rounded-lg px-3 py-1.5 pr-8 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
                        >
                          <option value="injection">Injection</option>
                          <option value="legacy">Legacy</option>
                        </select>
                        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
                      </div>

                      <div className="flex-1" />

                      {/* Main Action Button */}
                      {currentIDE.isPatched ? (
                        <Button
                          onClick={() => handleUnpatch(currentIDE.id)}
                          disabled={isOperating || !currentIDE.canPatch}
                          variant="danger"
                          size="md"
                          leftIcon={<Trash2 size={16} />}
                          className="shadow-lg shadow-red-500/10 hover:shadow-red-500/20"
                        >
                          {t('patcher.removePatch')}
                        </Button>
                      ) : (
                        <Button
                          onClick={() => handlePatch(currentIDE.id)}
                          disabled={isOperating || !currentIDE.canPatch}
                          variant="primary"
                          size="md"
                          leftIcon={<Download size={16} />}
                          className="shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/40"
                        >
                          {t('patcher.applyPatch')}
                        </Button>
                      )}
                    </div>

                    {/* Patch Options Grid */}
                    {availableOptions.length > 0 && (
                      <div className="pt-4 border-t border-white/5">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                            {t('patcher.patchOptions')}
                          </h4>
                          <div className="flex gap-2">
                            <button
                              onClick={() => toggleAllOptions(true)}
                              className="text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                            >
                              All
                            </button>
                            <button
                              onClick={() => toggleAllOptions(false)}
                              className="text-[10px] px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                            >
                              None
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                          {availableOptions.map(option => (
                            <label
                              key={option.id}
                              className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] hover:border-white/10 cursor-pointer transition-all duration-200 group"
                            >
                              <div className="flex items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={
                                    patchOptions[currentIDE.id]?.[option.id] ??
                                    option.defaultEnabled
                                  }
                                  onChange={() => togglePatchOption(currentIDE.id, option.id)}
                                  className="
                                    appearance-none w-4 h-4 rounded border border-white/20 bg-white/5 
                                    checked:bg-primary checked:border-primary checked:bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22white%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M12.207%204.793a1%201%200%20010%201.414l-5%205a1%201%200%2001-1.414%200l-2-2a1%201%200%20011.414-1.414L6.5%209.086l4.293-4.293a1%201%200%20011.414%200z%22%2F%3E%3C%2Fsvg%3E')]
                                    focus:ring-0 focus:ring-offset-0 transition-all cursor-pointer shrink-0
                                  "
                                />
                                <span className="text-sm text-slate-300 group-hover:text-white transition-colors">
                                  {t(option.labelKey)}
                                </span>
                              </div>
                              <Tooltip content={t(option.descKey)}>
                                <HelpCircle
                                  size={14}
                                  className="text-slate-600 hover:text-slate-400 transition-colors"
                                />
                              </Tooltip>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Backups Section */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                        <Archive size={14} className="text-slate-500" />
                        {t('patcher.backups')} ({currentIDEBackups.length})
                      </h3>
                      <Button
                        onClick={() => listBackups()}
                        disabled={backupsLoading}
                        variant="ghost"
                        size="xs"
                        leftIcon={<RefreshCw size={12} className={backupsLoading ? 'animate-spin' : ''} />}
                      >
                        {t('common.refresh')}
                      </Button>
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
                                <Tooltip content={t('patcher.restore')}>
                                  <button
                                    onClick={() => handleRestoreBackup(backup.id)}
                                    disabled={isRestoring || !backup.isValid}
                                    className="p-1.5 text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 rounded disabled:opacity-40"
                                  >
                                    {isRestoring ? (
                                      <Loader2 size={14} className="animate-spin" />
                                    ) : (
                                      <RotateCcw size={14} />
                                    )}
                                  </button>
                                </Tooltip>
                                <Tooltip content={t('common.delete')}>
                                  <button
                                    onClick={() => handleDeleteBackup(backup.id)}
                                    className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </Tooltip>
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
