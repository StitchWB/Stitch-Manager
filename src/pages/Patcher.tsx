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
  HardDrive,
  Code2,
  Wind,
  Terminal,
  Code,
  Settings,
  Crown,
  Sparkles,
} from 'lucide-react';
import Header from '../components/layout/Header';
import { usePatcherStore } from '../stores/patcher';
import { useAppStore } from '../stores/app';
import { t } from '../lib/i18n';
import type { DetectedIDE, BackupInfo } from '../types';

const IDE_CONFIG: Record<string, { icon: React.ReactNode; gradient: string; label: string }> = {
  kiro: { icon: <Code2 size={18} />, gradient: 'from-purple-500 to-violet-600', label: 'Kiro' },
  windsurf: { icon: <Wind size={18} />, gradient: 'from-teal-400 to-cyan-500', label: 'Windsurf' },
  trae: { icon: <Terminal size={18} />, gradient: 'from-orange-500 to-amber-500', label: 'Trae' },
  vscode: { icon: <Code2 size={18} />, gradient: 'from-blue-500 to-blue-600', label: 'VS Code' },
  vscodium: { icon: <Code2 size={18} />, gradient: 'from-green-500 to-emerald-600', label: 'VSCodium' },
  other: { icon: <Terminal size={18} />, gradient: 'from-slate-500 to-slate-600', label: 'Other' },
};

const getIDEIcon = (type: string) => (IDE_CONFIG[type] || IDE_CONFIG.other).icon;
const getIDEGradient = (type: string) => (IDE_CONFIG[type] || IDE_CONFIG.other).gradient;

const truncateMiddle = (path: string, maxLength: number = 35): string => {
  if (path.length <= maxLength) return path;
  const parts = path.split('/');
  if (parts.length <= 2) return path;
  const fileName = parts[parts.length - 1];
  const firstPart = parts[0];
  const remaining = maxLength - firstPart.length - fileName.length - 5; // 5 for "/.../""
  if (remaining < 0) return `.../${fileName}`;
  return `${firstPart}/.../${fileName}`;
};

export default function Patcher() {
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
    traePatched,
    traeExtensionPatched,
    traeWorkbenchPatched,
    traePatchLoading,
    setPatchStrategy,
    setLogRequests,
    detectIDEs: scanForIDEs, // Renamed to avoid conflict
    applyPatch,
    removePatch,
    listBackups,
    restoreBackup,
    deleteBackup,
    clearError,
    checkTraePatched,
    patchTraeFull,
  } = usePatcherStore();

  // Force re-render when language changes
  void language; // Force re-render on language change

  const [selectedIDEFilter, setSelectedIDEFilter] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    scanForIDEs();
    listBackups();
    checkTraePatched();
  }, [scanForIDEs, listBackups, checkTraePatched]);

  // Handle Escape key to close settings dropdown
  useEffect(() => {
    if (!showSettings) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowSettings(false);
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showSettings]);

  // Close settings dropdown when clicking outside
  useEffect(() => {
    if (!showSettings) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-settings-dropdown]')) {
        setShowSettings(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSettings]);

  const handleScan = async () => { clearError(); await scanForIDEs(); await listBackups(); await checkTraePatched(); };
  const handlePatch = async (ideId: string) => { 
    clearError(); 
    try { 
      await applyPatch(ideId, true); 
    } catch (err) {
      // Error is already set in the store by the applyPatch function
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
      // Error is already set in the store by the removePatch function
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
      addNotification({ type: 'error', title: t('patcher.restoreFailed'), message: String(error) });
    } 
  };
  const handleDeleteBackup = async (backupId: string) => { 
    clearError(); 
    try { 
      await deleteBackup(backupId); 
      await listBackups(); 
    } catch (error) {
      const { addNotification } = useAppStore.getState();
      addNotification({ type: 'error', title: t('patcher.deleteFailed'), message: String(error) });
    } 
  };
  const handlePatchTraeFull = async () => { 
    clearError(); 
    try { 
      await patchTraeFull(); 
    } catch (error) {
      const { addNotification } = useAppStore.getState();
      addNotification({ type: 'error', title: t('patcher.patchTraeFailed'), message: String(error) });
    } 
  };

  const allBackups: BackupInfo[] = Object.values(backups).flat() as BackupInfo[];
  const filteredBackups = selectedIDEFilter ? allBackups.filter((b: BackupInfo) => b.ideId === selectedIDEFilter) : allBackups;

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const isAnyOperationInProgress = Object.values(operationInProgress).some(Boolean);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header title={t('patcher.title')} subtitle={t('patcher.subtitle')} icon={<Code size={18} />} />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1400px] mx-auto flex flex-col gap-6">
          
          {/* Error Alert */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center gap-3">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-sm text-red-400 flex-1">{error}</p>
              <button onClick={clearError} className="text-red-400 hover:text-red-300"><XCircle size={16} /></button>
            </div>
          )}


          {/* Scan Control */}
          <section className="card p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">{t('patcher.detectedIdes')}</h2>
                <p className="text-2xs text-slate-500 mt-0.5">{t('patcher.scanDescription')}</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative" data-settings-dropdown>
                  <button 
                    onClick={() => setShowSettings(!showSettings)} 
                    className="btn-icon text-slate-500 hover:text-white hover:bg-white/10"
                    aria-label={t('patcher.settings')}
                    aria-expanded={showSettings}
                    aria-haspopup="true"
                  >
                    <Settings size={16} aria-hidden="true" />
                  </button>
                  {showSettings && (
                    <div 
                      className="absolute top-full right-0 mt-2 w-64 bg-slate-800 border border-white/10 rounded-lg shadow-xl z-10 p-4"
                      role="menu"
                      aria-label={t('patcher.settingsMenu')}
                    >
                      <h4 className="text-xs font-semibold text-white mb-3">{t('patcher.settings')}</h4>
                      <div className="space-y-3">
                        <div>
                          <label htmlFor="patchStrategy" className="text-2xs text-slate-400 block mb-1">{t('patcher.strategy')}</label>
                          <select
                            id="patchStrategy"
                            value={patchStrategy}
                            onChange={(e) => setPatchStrategy(e.target.value as 'injection' | 'legacy')}
                            className="input-ds w-full text-xs"
                          >
                            <option value="injection">Injection (Recommended)</option>
                            <option value="legacy">Legacy (Regex)</option>
                          </select>
                        </div>
                        <label className="flex items-center gap-2 text-slate-300 cursor-pointer text-xs">
                          <input 
                            type="checkbox" 
                            checked={logRequests} 
                            onChange={(e) => setLogRequests(e.target.checked)} 
                            className="w-3.5 h-3.5 rounded border-white/20 bg-white/10 text-primary focus:ring-0 focus:ring-offset-0"
                          />
                          {t('patcher.logRequests')}
                        </label>
                      </div>
                    </div>
                  )}
                </div>
                <button onClick={handleScan} disabled={scanning || isAnyOperationInProgress} className="btn-primary py-1.5 text-xs">
                  {scanning ? <><RefreshCw size={14} className="animate-spin" />{t('patcher.scanning')}</> : <><Search size={14} />{t('patcher.scanForIdes')}</>}
                </button>
              </div>
            </div>
          </section>

          {/* IDE List */}
          <section className="card overflow-hidden">
            <div className="divide-y divide-white/5">
              {scanning && detectedIDEs.length === 0 ? (
                <div className="p-8 text-center text-slate-500 flex flex-col items-center gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <span className="text-xs">{t('patcher.scanningForIdes')}</span>
                </div>
              ) : detectedIDEs.length === 0 ? (
                <div className="p-8 text-center text-slate-600 text-xs">
                  {t('patcher.noIdesDetected')}
                </div>
              ) : (
                detectedIDEs.map((ide: DetectedIDE) => {
                  const operation = operationInProgress[ide.id];
                  const isOperating = !!operation;

                  return (
                    <div key={ide.id} className={`flex items-center gap-4 p-3 hover:bg-white/[0.02] transition-colors ${isOperating ? 'opacity-75' : ''}`}>
                      <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${getIDEGradient(ide.type)} flex items-center justify-center text-white shadow-lg shrink-0`}>
                        {getIDEIcon(ide.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-white font-medium text-sm">{ide.name}</h3>
                          {ide.version && <span className="text-2xs text-slate-500 font-mono bg-white/5 px-1.5 py-0.5 rounded">{ide.version}</span>}
                          {!ide.canPatch && !ide.path && <span className="badge-warning">{t('status.notFound')}</span>}
                        </div>
                        {ide.path ? (
                          <p className="text-2xs text-slate-600 mt-0.5 font-mono" title={ide.path}>{truncateMiddle(ide.path)}</p>
                        ) : (
                          <p className="text-2xs text-slate-700 mt-0.5 italic">{t('patcher.ideNotDetected')}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-3 ml-auto shrink-0">
                        {isOperating ? (
                          <div className="badge-info flex items-center gap-1.5">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span className="capitalize">{operation === 'patching' ? t('patcher.patching') : operation === 'unpatching' ? t('patcher.unpatching') : t('patcher.restoring')}...</span>
                          </div>
                        ) : ide.isPatched ? (
                          <div className="badge-success flex items-center gap-1.5">
                            <CheckCircle className="w-3 h-3" />
                            {t('status.patched')} {ide.patchVersion && <span className="font-mono opacity-70">v{ide.patchVersion}</span>}
                          </div>
                        ) : (
                          <div className="badge-neutral flex items-center gap-1.5">
                            <XCircle className="w-3 h-3" />
                            {t('status.notPatched')}
                          </div>
                        )}
                        {ide.isPatched ? (
                          <button onClick={() => handleUnpatch(ide.id)} disabled={isOperating || !ide.canPatch} className="btn-icon text-slate-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50" title={t('patcher.removePatch')}>
                            <Trash2 size={16} />
                          </button>
                        ) : (
                          <button onClick={() => handlePatch(ide.id)} disabled={isOperating || !ide.canPatch} className="btn-icon text-slate-500 hover:text-primary hover:bg-primary/10 disabled:opacity-50" title={t('patcher.applyPatch')}>
                            <Download size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Trae Pro Patch Section */}
          <section className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center text-white shadow-lg">
                  <Terminal size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">Trae Pro Patch</h3>
                    <span className="flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
                      <Crown size={10} />
                      Full
                    </span>
                  </div>
                  <p className="text-2xs text-slate-500 mt-0.5">Patch storage, extension, and workbench for Pro features</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {traePatchLoading ? (
                  <div className="badge-info flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Patching...</span>
                  </div>
                ) : traePatched === null ? (
                  <div className="badge-warning flex items-center gap-1.5">
                    <AlertCircle className="w-3 h-3" />
                    Not Installed
                  </div>
                ) : null}
                <button
                  onClick={handlePatchTraeFull}
                  disabled={traePatchLoading || traePatched === null}
                  className="btn-primary py-1.5 text-xs"
                >
                  {traePatchLoading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Patching...
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} />
                      Full Patch
                    </>
                  )}
                </button>
              </div>
            </div>
            
            {/* Patch Status Grid */}
            {traePatched !== null && (
              <div className="grid grid-cols-3 gap-3">
                <div className={`p-3 rounded-lg border ${traePatched ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-white/[0.02] border-white/5'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-2xs text-slate-400">Storage</span>
                    {traePatched ? (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-slate-500" />
                    )}
                  </div>
                  <p className="text-xs text-white font-medium">{traePatched ? 'Pro' : 'Free'}</p>
                </div>
                <div className={`p-3 rounded-lg border ${traeExtensionPatched ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-white/[0.02] border-white/5'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-2xs text-slate-400">Extension</span>
                    {traeExtensionPatched ? (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-slate-500" />
                    )}
                  </div>
                  <p className="text-xs text-white font-medium">{traeExtensionPatched ? 'Patched' : 'Original'}</p>
                </div>
                <div className={`p-3 rounded-lg border ${traeWorkbenchPatched ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-white/[0.02] border-white/5'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-2xs text-slate-400">Workbench</span>
                    {traeWorkbenchPatched ? (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-slate-500" />
                    )}
                  </div>
                  <p className="text-xs text-white font-medium">{traeWorkbenchPatched ? 'Patched' : 'Original'}</p>
                </div>
              </div>
            )}
          </section>

          {/* Backups Section */}
          <section className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Archive className="w-4 h-4 text-slate-500" />
                <h3 className="text-sm font-semibold text-white">{t('patcher.backups')}</h3>
                <span className="text-2xs text-slate-600 bg-white/5 px-1.5 py-0.5 rounded tabular-nums">
                  {filteredBackups.length} {t('patcher.backup')}{filteredBackups.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {detectedIDEs.length > 0 && allBackups.length > 0 && (
                  <select
                    value={selectedIDEFilter || ''}
                    onChange={(e) => setSelectedIDEFilter(e.target.value || null)}
                    className="input-ds text-xs py-1 px-2 w-32"
                  >
                    <option value="">{t('patcher.allIdes')}</option>
                    {detectedIDEs.map((ide: DetectedIDE) => <option key={ide.id} value={ide.id}>{ide.name}</option>)}
                  </select>
                )}
                <button onClick={() => listBackups()} disabled={backupsLoading} className="btn-ghost text-xs py-1 px-2">
                  <RefreshCw size={12} className={backupsLoading ? 'animate-spin' : ''} /> {t('common.refresh')}
                </button>
              </div>
            </div>

            {backupsLoading && allBackups.length === 0 ? (
              <div className="text-center py-6 text-slate-500 flex flex-col items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-xs">{t('patcher.loadingBackups')}</span>
              </div>
            ) : filteredBackups.length === 0 ? (
              <div className="text-center py-6 text-slate-600">
                <HardDrive className="w-6 h-6 mx-auto mb-2 opacity-50" />
                <p className="text-xs">{selectedIDEFilter ? t('patcher.noBackupsForIde') : t('patcher.noBackups')}</p>
                <p className="text-2xs mt-1 text-slate-700">{t('patcher.backupsCreatedWhenPatching')}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredBackups.map((backup: BackupInfo) => {
                  const ide = detectedIDEs.find((i: DetectedIDE) => i.id === backup.ideId);
                  const isRestoring = operationInProgress[backup.ideId] === 'restoring';

                  return (
                    <div key={backup.id} className="flex items-center gap-3 p-3 bg-vsc-sidebar rounded-lg border border-vsc-border hover:border-vsc-border-light transition-colors">
                      <div className="w-8 h-8 rounded-md bg-vsc-panel flex items-center justify-center text-vsc-text-muted shrink-0">
                        <Archive size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-medium text-vsc-text truncate">{backup.ideName}</span>
                          <span className="text-2xs text-vsc-text-muted bg-vsc-panel px-1.5 py-0.5 rounded">{backup.ideVersion}</span>
                          {!backup.isValid && (
                            <span className="text-2xs text-vsc-red bg-vsc-red/10 px-1.5 py-0.5 rounded">{t('status.invalid')}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-vsc-text-muted">
                          <span>{formatDate(backup.createdAt)}</span>
                          <span className="opacity-50">•</span>
                          <span>{formatSize(backup.size)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-auto shrink-0">
                        <button 
                          onClick={() => handleRestoreBackup(backup.id)} 
                          disabled={isRestoring || !backup.isValid || !ide} 
                          className="btn-icon text-vsc-text-muted hover:text-vsc-green hover:bg-vsc-green/10 disabled:opacity-40 disabled:cursor-not-allowed" 
                          title={t('patcher.restore')}
                        >
                          {isRestoring ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                        </button>
                        <button 
                          onClick={() => handleDeleteBackup(backup.id)} 
                          className="btn-icon text-vsc-text-muted hover:text-vsc-red hover:bg-vsc-red/10" 
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
          </section>

          {/* Patch Info */}
          <section className="card p-4">
            <h3 className="text-sm font-semibold text-white mb-3">{t('patcher.patchInformation')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="bg-white/[0.02] rounded-lg p-3 border border-white/5">
                <p className="text-2xs text-slate-500 uppercase tracking-wider mb-1">{t('patcher.patchedIdes')}</p>
                <p className="text-base font-bold text-white tabular-nums">
                  {detectedIDEs.filter((ide: DetectedIDE) => ide.isPatched).length} / {detectedIDEs.length}
                </p>
              </div>
              <div className="bg-white/[0.02] rounded-lg p-3 border border-white/5">
                <p className="text-2xs text-slate-500 uppercase tracking-wider mb-1">{t('patcher.totalBackups')}</p>
                <p className="text-base font-bold text-white tabular-nums">{allBackups.length}</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
