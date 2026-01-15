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
          <section className="glass-card p-5">
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
                      className="absolute top-full right-0 mt-2 w-64 glass-card shadow-xl z-10 p-4"
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
                            className="input-deep w-full text-xs rounded-md px-2 py-1.5"
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
          <section className="glass-card overflow-hidden">
            <div className="divide-y divide-white/[0.03]">
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
                    <div key={ide.id} className={`flex items-center gap-4 p-4 hover:bg-white/[0.02] transition-colors ${isOperating ? 'opacity-75' : ''}`}>
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
                        {/* Status Badge - Static non-clickable pill */}
                        {isOperating ? (
                          <span className="inline-flex items-center gap-1.5 bg-indigo-500/20 text-indigo-400 rounded-full px-3 py-1 text-xs font-medium select-none">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span className="capitalize">{operation === 'patching' ? t('patcher.patching') : operation === 'unpatching' ? t('patcher.unpatching') : t('patcher.restoring')}...</span>
                          </span>
                        ) : ide.isPatched ? (
                          <span className="inline-flex items-center gap-1.5 bg-emerald-500/15 text-emerald-400 rounded-full px-3 py-1 text-xs font-medium select-none">
                            <CheckCircle className="w-3 h-3" />
                            {t('status.patched')} {ide.patchVersion && <span className="font-mono opacity-70">v{ide.patchVersion}</span>}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 bg-white/5 text-slate-500 rounded-full px-3 py-1 text-xs font-medium select-none">
                            <XCircle className="w-3 h-3" />
                            {t('status.notPatched')}
                          </span>
                        )}
                        {/* Action Icons - Separate from status */}
                        <div className="flex items-center gap-1">
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
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Trae Pro Patch Section */}
          <section className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center text-white shadow-lg">
                  <Terminal size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-white">{t('patcher.traeProPatch')}</h3>
                    <span className="flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400">
                      <Crown size={10} />
                      {t('patcher.traeProFull')}
                    </span>
                  </div>
                  <p className="text-2xs text-slate-500 mt-0.5">{t('patcher.traeProDescription')}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {traePatchLoading ? (
                  <div className="flex items-center gap-1.5 bg-indigo-500/20 text-indigo-400 rounded-full px-3 py-1 text-xs font-medium">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>{t('patcher.patching')}...</span>
                  </div>
                ) : traePatched === null ? (
                  <div className="flex items-center gap-1.5 bg-amber-500/20 text-amber-400 rounded-full px-3 py-1 text-xs font-medium">
                    <AlertCircle className="w-3 h-3" />
                    {t('patcher.traeNotInstalled')}
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
                      {t('patcher.patching')}...
                    </>
                  ) : (
                    <>
                      <Sparkles size={14} />
                      {t('patcher.traeFullPatch')}
                    </>
                  )}
                </button>
              </div>
            </div>
            
            {/* Patch Status Grid - Nested blocks with subtle background differences, NO inner borders */}
            {traePatched !== null && (
              <div className="grid grid-cols-3 gap-3 mt-4 bg-white/[0.01] rounded-lg p-3">
                <div className={`p-3 rounded-md transition-colors ${traePatched ? 'bg-emerald-500/8' : 'bg-white/[0.02]'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-2xs text-slate-500 uppercase tracking-wider">{t('patcher.traeStorage')}</span>
                    {traePatched ? (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-slate-600" />
                    )}
                  </div>
                  <p className={`text-sm font-medium ${traePatched ? 'text-white' : 'text-slate-400'}`}>{traePatched ? t('patcher.traePro') : t('patcher.traeFree')}</p>
                </div>
                <div className={`p-3 rounded-md transition-colors ${traeExtensionPatched ? 'bg-emerald-500/8' : 'bg-white/[0.02]'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-2xs text-slate-500 uppercase tracking-wider">{t('patcher.traeExtension')}</span>
                    {traeExtensionPatched ? (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-slate-600" />
                    )}
                  </div>
                  <p className={`text-sm font-medium ${traeExtensionPatched ? 'text-white' : 'text-slate-400'}`}>{traeExtensionPatched ? t('patcher.traePatched') : t('patcher.traeOriginal')}</p>
                </div>
                <div className={`p-3 rounded-md transition-colors ${traeWorkbenchPatched ? 'bg-emerald-500/8' : 'bg-white/[0.02]'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-2xs text-slate-500 uppercase tracking-wider">{t('patcher.traeWorkbench')}</span>
                    {traeWorkbenchPatched ? (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-slate-600" />
                    )}
                  </div>
                  <p className={`text-sm font-medium ${traeWorkbenchPatched ? 'text-white' : 'text-slate-400'}`}>{traeWorkbenchPatched ? t('patcher.traePatched') : t('patcher.traeOriginal')}</p>
                </div>
              </div>
            )}
          </section>

          {/* Backups Section - Compact */}
          <section className="glass-card p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Archive className="w-4 h-4 text-slate-500" />
                <h3 className="text-sm font-semibold text-white">{t('patcher.backups')}</h3>
                <span className="text-2xs text-slate-600 bg-white/5 px-1.5 py-0.5 rounded tabular-nums">
                  {filteredBackups.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {detectedIDEs.length > 0 && allBackups.length > 0 && (
                  <select
                    value={selectedIDEFilter || ''}
                    onChange={(e) => setSelectedIDEFilter(e.target.value || null)}
                    className="input-deep text-xs py-1 px-2 w-32 rounded-md"
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
              <div className="text-center py-4 text-slate-500 flex flex-col items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-xs">{t('patcher.loadingBackups')}</span>
              </div>
            ) : filteredBackups.length === 0 ? (
              <div className="text-center py-4 text-slate-600">
                <HardDrive className="w-5 h-5 mx-auto mb-2 opacity-50" />
                <p className="text-xs">{selectedIDEFilter ? t('patcher.noBackupsForIde') : t('patcher.noBackups')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[150px] overflow-y-auto scrollbar-thin">
                {filteredBackups.map((backup: BackupInfo) => {
                  const ide = detectedIDEs.find((i: DetectedIDE) => i.id === backup.ideId);
                  const isRestoring = operationInProgress[backup.ideId] === 'restoring';

                  return (
                    <div key={backup.id} className="flex items-center gap-2 p-2 bg-white/[0.02] rounded-lg hover:bg-white/[0.04] transition-colors">
                      <div className="w-6 h-6 rounded bg-white/[0.05] flex items-center justify-center text-slate-500 shrink-0">
                        <Archive size={12} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium text-white truncate block">{backup.ideName}</span>
                        <span className="text-[10px] text-slate-600">{formatDate(backup.createdAt)} • {formatSize(backup.size)}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button 
                          onClick={() => handleRestoreBackup(backup.id)} 
                          disabled={isRestoring || !backup.isValid || !ide} 
                          className="p-1 text-slate-500 hover:text-emerald-400 hover:bg-emerald-500/10 rounded disabled:opacity-40" 
                          title={t('patcher.restore')}
                        >
                          {isRestoring ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                        </button>
                        <button 
                          onClick={() => handleDeleteBackup(backup.id)} 
                          className="p-1 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded" 
                          title={t('common.delete')}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Patch Info */}
          <section className="glass-card p-4">
            <h3 className="text-sm font-semibold text-white mb-3">{t('patcher.patchInformation')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-white/[0.02] rounded-lg p-4">
                <p className="text-2xs text-slate-500 uppercase tracking-wider mb-1">{t('patcher.patchedIdes')}</p>
                <p className="text-xl font-bold text-white tabular-nums">
                  {detectedIDEs.filter((ide: DetectedIDE) => ide.isPatched).length} / {detectedIDEs.length}
                </p>
              </div>
              <div className="bg-white/[0.02] rounded-lg p-4">
                <p className="text-2xs text-slate-500 uppercase tracking-wider mb-1">{t('patcher.totalBackups')}</p>
                <p className="text-xl font-bold text-white tabular-nums">{allBackups.length}</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
