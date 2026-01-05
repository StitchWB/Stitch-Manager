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
  MousePointer2,
  Wind,
  Terminal,
  Filter,
} from 'lucide-react';
import Header from '../components/layout/Header';
import { usePatcherStore } from '../stores/patcher';
import type { DetectedIDE, BackupInfo, IDEType } from '../types';

// IDE type icons and colors configuration
const IDE_CONFIG: Record<IDEType, { icon: React.ReactNode; gradient: string; label: string }> = {
  vscode: {
    icon: <Code2 size={20} />,
    gradient: 'from-blue-500 to-blue-600',
    label: 'VS Code',
  },
  cursor: {
    icon: <MousePointer2 size={20} />,
    gradient: 'from-purple-500 to-pink-500',
    label: 'Cursor',
  },
  windsurf: {
    icon: <Wind size={20} />,
    gradient: 'from-teal-400 to-cyan-500',
    label: 'Windsurf',
  },
  vscodium: {
    icon: <Code2 size={20} />,
    gradient: 'from-green-500 to-emerald-600',
    label: 'VSCodium',
  },
  other: {
    icon: <Terminal size={20} />,
    gradient: 'from-slate-500 to-slate-600',
    label: 'Other',
  },
};

// Get IDE icon component
const getIDEIcon = (type: IDEType) => {
  const config = IDE_CONFIG[type] || IDE_CONFIG.other;
  return config.icon;
};

// Get IDE gradient class
const getIDEGradient = (type: IDEType) => {
  const config = IDE_CONFIG[type] || IDE_CONFIG.other;
  return config.gradient;
};

export default function Patcher() {
  // Store state
  const {
    detectedIDEs,
    backups,
    scanning,
    loading,
    error,
    operationInProgress,
    detectIDEs,
    applyPatch,
    removePatch,
    listBackups,
    restoreBackup,
    deleteBackup,
    clearError,
  } = usePatcherStore();

  // Local state for backup confirmation dialogs
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [createBackupOnPatch, setCreateBackupOnPatch] = useState(true);
  const [restoreBackupOnUnpatch, setRestoreBackupOnUnpatch] = useState(true);
  const [selectedIDEFilter, setSelectedIDEFilter] = useState<string | null>(null);

  // Scan for IDEs on mount
  useEffect(() => {
    detectIDEs();
    listBackups();
  }, [detectIDEs, listBackups]);

  // Handlers
  const handleScan = async () => {
    clearError();
    await detectIDEs();
    await listBackups();
  };

  const handlePatch = async (ideId: string) => {
    clearError();
    try {
      await applyPatch(ideId, createBackupOnPatch);
    } catch {
      // Error is already set in store
    }
  };

  const handleUnpatch = async (ideId: string) => {
    clearError();
    try {
      await removePatch(ideId, restoreBackupOnUnpatch);
    } catch {
      // Error is already set in store
    }
  };

  const handleRestoreBackup = async (backupId: string) => {
    clearError();
    try {
      await restoreBackup(backupId);
      await listBackups();
    } catch {
      // Error is already set in store
    }
  };

  const handleDeleteBackup = async (backupId: string) => {
    clearError();
    try {
      await deleteBackup(backupId);
      setConfirmDelete(null);
    } catch {
      // Error is already set in store
    }
  };

  // Get all backups as flat array, optionally filtered by selected IDE
  const allBackups: BackupInfo[] = Object.values(backups).flat() as BackupInfo[];
  const filteredBackups = selectedIDEFilter
    ? allBackups.filter((b: BackupInfo) => b.ideId === selectedIDEFilter)
    : allBackups;

  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Format date
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Check if any operation is in progress
  const isAnyOperationInProgress = Object.values(operationInProgress).some(Boolean);

  return (
    <>
      <Header title="IDE Patcher Module" subtitle="Manage IDE patches and extensions" />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1400px] mx-auto flex flex-col gap-6">
          {/* Error Alert */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-red-400">{error}</p>
              </div>
              <button
                onClick={clearError}
                className="text-red-400 hover:text-red-300 transition-colors"
              >
                <XCircle size={18} />
              </button>
            </div>
          )}

          {/* Scan Control */}
          <section className="bg-surface-dark border border-border-dark rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Detected IDEs</h2>
                <p className="text-sm text-slate-400 mt-1">
                  Scan your system to detect installed IDEs and manage patches
                </p>
              </div>
              <div className="flex items-center gap-4">
                {/* Backup options */}
                <div className="flex items-center gap-4 text-sm">
                  <label className="flex items-center gap-2 text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={createBackupOnPatch}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCreateBackupOnPatch(e.target.checked)}
                      className="rounded border-slate-600 bg-slate-700 text-primary focus:ring-primary"
                    />
                    Backup on patch
                  </label>
                  <label className="flex items-center gap-2 text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={restoreBackupOnUnpatch}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRestoreBackupOnUnpatch(e.target.checked)}
                      className="rounded border-slate-600 bg-slate-700 text-primary focus:ring-primary"
                    />
                    Restore on unpatch
                  </label>
                </div>
                <button
                  onClick={handleScan}
                  disabled={scanning || isAnyOperationInProgress}
                  className="bg-primary hover:bg-blue-600 disabled:bg-slate-700 disabled:cursor-not-allowed text-white font-medium py-2 px-4 rounded-lg shadow-lg shadow-primary/20 transition-all flex items-center gap-2"
                >
                  {scanning ? (
                    <>
                      <RefreshCw size={18} className="animate-spin" />
                      Scanning...
                    </>
                  ) : (
                    <>
                      <Search size={18} />
                      Scan for IDEs
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>

          {/* IDE List */}
          <section className="bg-surface-dark border border-border-dark rounded-lg overflow-hidden">
            <div className="divide-y divide-border-dark">
              {scanning && detectedIDEs.length === 0 ? (
                <div className="p-8 text-center text-slate-400 flex flex-col items-center gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <span>Scanning for installed IDEs...</span>
                </div>
              ) : detectedIDEs.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  No IDEs detected. Click "Scan for IDEs" to search your system.
                </div>
              ) : (
                detectedIDEs.map((ide: DetectedIDE) => {
                  const operation = operationInProgress[ide.id];
                  const isOperating = !!operation;

                  return (
                    <div
                      key={ide.id}
                      className={`flex items-center gap-4 p-4 hover:bg-white/5 transition-colors ${
                        isOperating ? 'opacity-75' : ''
                      }`}
                    >
                      {/* IDE Icon */}
                      <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${getIDEGradient(ide.type)} flex items-center justify-center text-white`}>
                        {getIDEIcon(ide.type)}
                      </div>

                      {/* IDE Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-white font-medium">{ide.name}</h3>
                          <span className="text-xs text-slate-400 font-mono bg-background-dark px-2 py-0.5 rounded">
                            {ide.version}
                          </span>
                          {!ide.canPatch && (
                            <span className="text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded">
                              Unsupported
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-500 truncate mt-1">{ide.path}</p>
                      </div>

                      {/* Patch Status */}
                      <div className="flex items-center gap-4">
                        {isOperating ? (
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/15 border border-blue-500/20">
                            <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                            <span className="text-sm font-medium text-blue-400 capitalize">
                              {operation}...
                            </span>
                          </div>
                        ) : ide.isPatched ? (
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/15 border border-green-500/20">
                            <CheckCircle className="w-4 h-4 text-green-400" />
                            <span className="text-sm font-medium text-green-400">
                              Patched {ide.patchVersion && `(${ide.patchVersion})`}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-500/15 border border-slate-500/20">
                            <XCircle className="w-4 h-4 text-slate-400" />
                            <span className="text-sm font-medium text-slate-400">Not Patched</span>
                          </div>
                        )}

                        {/* Actions */}
                        {ide.isPatched ? (
                          <button
                            onClick={() => handleUnpatch(ide.id)}
                            disabled={isOperating || !ide.canPatch}
                            className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Remove Patch"
                          >
                            <Trash2 size={18} />
                          </button>
                        ) : (
                          <button
                            onClick={() => handlePatch(ide.id)}
                            disabled={isOperating || !ide.canPatch}
                            className="p-2 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Apply Patch"
                          >
                            <Download size={18} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Backups Section */}
          <section className="bg-surface-dark border border-border-dark rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Archive className="w-5 h-5 text-slate-400" />
                <h3 className="text-base font-medium text-white">Backups</h3>
                <span className="text-xs text-slate-500 bg-background-dark px-2 py-0.5 rounded">
                  {filteredBackups.length} backup{filteredBackups.length !== 1 ? 's' : ''}
                  {selectedIDEFilter && ` (filtered)`}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {/* IDE Filter Dropdown */}
                {detectedIDEs.length > 0 && allBackups.length > 0 && (
                  <div className="relative">
                    <select
                      value={selectedIDEFilter || ''}
                      onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedIDEFilter(e.target.value || null)}
                      className="appearance-none bg-background-dark border border-border-dark rounded-lg px-3 py-1.5 pr-8 text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                    >
                      <option value="">All IDEs</option>
                      {detectedIDEs.map((ide: DetectedIDE) => (
                        <option key={ide.id} value={ide.id}>
                          {ide.name}
                        </option>
                      ))}
                    </select>
                    <Filter className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                  </div>
                )}
                <button
                  onClick={() => listBackups()}
                  disabled={loading}
                  className="text-sm text-slate-400 hover:text-white transition-colors flex items-center gap-1"
                >
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                  Refresh
                </button>
              </div>
            </div>

            {loading && allBackups.length === 0 ? (
              <div className="text-center py-6 text-slate-400 flex flex-col items-center gap-2">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span>Loading backups...</span>
              </div>
            ) : filteredBackups.length === 0 ? (
              <div className="text-center py-6 text-slate-500">
                <HardDrive className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>{selectedIDEFilter ? 'No backups for selected IDE' : 'No backups available'}</p>
                <p className="text-xs mt-1">Backups are created when patching IDEs</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredBackups.map((backup: BackupInfo) => {
                  const ide = detectedIDEs.find((i: DetectedIDE) => i.id === backup.ideId);
                  const isRestoring = operationInProgress[backup.ideId] === 'restoring';

                  return (
                    <div
                      key={backup.id}
                      className="flex items-center gap-4 p-3 bg-background-dark rounded-lg"
                    >
                      <div className={`w-10 h-10 rounded-lg ${ide ? `bg-gradient-to-br ${getIDEGradient(ide.type)}` : 'bg-slate-700'} flex items-center justify-center text-white`}>
                        {ide ? getIDEIcon(ide.type) : <Archive size={18} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-medium">{backup.ideName}</span>
                          <span className="text-xs text-slate-500 font-mono">
                            v{backup.ideVersion}
                          </span>
                          {!backup.isValid && (
                            <span className="text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded">
                              Invalid
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                          <span>{formatDate(backup.createdAt)}</span>
                          <span>•</span>
                          <span>{formatSize(backup.size)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleRestoreBackup(backup.id)}
                          disabled={isRestoring || !backup.isValid || !ide}
                          className="p-2 rounded-lg text-slate-400 hover:text-green-400 hover:bg-green-400/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Restore Backup"
                        >
                          {isRestoring ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <RotateCcw size={16} />
                          )}
                        </button>
                        {confirmDelete === backup.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDeleteBackup(backup.id)}
                              className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="px-2 py-1 text-xs bg-slate-600 text-white rounded hover:bg-slate-500 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(backup.id)}
                            className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-400/10 transition-all"
                            title="Delete Backup"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Patch Info */}
          <section className="bg-surface-dark border border-border-dark rounded-lg p-6">
            <h3 className="text-base font-medium text-white mb-3">Patch Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-background-dark rounded-lg p-4">
                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">
                  Current Version
                </p>
                <p className="text-lg font-semibold text-white">v2.1.4</p>
              </div>
              <div className="bg-background-dark rounded-lg p-4">
                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">
                  Patched IDEs
                </p>
                <p className="text-lg font-semibold text-white">
                  {detectedIDEs.filter((ide: DetectedIDE) => ide.isPatched).length} /{' '}
                  {detectedIDEs.length}
                </p>
              </div>
              <div className="bg-background-dark rounded-lg p-4">
                <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">
                  Total Backups
                </p>
                <p className="text-lg font-semibold text-white">{allBackups.length}</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
