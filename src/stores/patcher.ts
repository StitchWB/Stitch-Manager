import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type {
  DetectedIDE,
  PatchStatus,
  PatchStatusType,
  BackupInfo,
  PatchResult,
} from '../types';
import {
  detectIDEs,
  getPatchStatus,
  patchIDE,
  unpatchIDE,
  listBackups,
  restoreBackup,
  deleteBackup,
  patchTraeFull,
  isTraePatched,
  isTraeExtensionPatched,
  isTraeWorkbenchPatched,
  TauriError,
} from '../lib/tauri';

// ============================================
// Types
// ============================================

interface PatcherState {
  // State
  detectedIDEs: DetectedIDE[];
  patchStatus: Record<string, PatchStatus>;
  backups: Record<string, BackupInfo[]>;
  scanning: boolean;
  backupsLoading: boolean;
  error: string | null;
  
  // Operation status
  operationInProgress: Record<string, 'patching' | 'unpatching' | 'restoring' | null>;

  // Patch settings
  patchStrategy: 'injection' | 'legacy';
  logRequests: boolean;
  
  // Trae storage patch state
  traePatched: boolean | null;
  traeExtensionPatched: boolean | null;
  traeWorkbenchPatched: boolean | null;
  traePatchLoading: boolean;
  
  // Actions
  detectIDEs: () => Promise<DetectedIDE[]>;
  getAllPatchStatuses: () => Promise<void>;
  applyPatch: (ideId: string, createBackup?: boolean) => Promise<PatchResult>;
  removePatch: (ideId: string, restoreBackup?: boolean) => Promise<PatchResult>;
  setPatchStrategy: (strategy: 'injection' | 'legacy') => void;
  setLogRequests: (log: boolean) => void;
  
  // Trae storage patch actions
  checkTraePatched: () => Promise<boolean>;
  patchTraeFull: () => Promise<PatchResult>;
  
  // Backup management
  listBackups: (ideId?: string) => Promise<BackupInfo[]>;
  restoreBackup: (backupId: string) => Promise<PatchResult>;
  deleteBackup: (backupId: string) => Promise<void>;
  
  // Error handling
  clearError: () => void;
}

// ============================================
// Store
// ============================================

export const usePatcherStore = create<PatcherState>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state
        detectedIDEs: [],
        patchStatus: {},
        backups: {},
        scanning: false,
        backupsLoading: false,
        error: null,
        operationInProgress: {},
        patchStrategy: 'injection', // Default to new method
        logRequests: false,
        traePatched: null,
        traeExtensionPatched: null,
        traeWorkbenchPatched: null,
        traePatchLoading: false,

        // ============================================
        // IDE Detection
        // ============================================

        detectIDEs: async () => {
          set({ scanning: true, error: null });
          try {
            const ides = await detectIDEs();
            set({ detectedIDEs: ides, scanning: false });
            
            // Fetch patch status for all detected IDEs
            await get().getAllPatchStatuses();
            
            return ides;
          } catch (error) {
            const message = error instanceof TauriError ? error.message : String(error);
            set({ error: message, scanning: false });
            throw error;
          }
        },

        // ============================================
        // Patch Status
        // ============================================

        getPatchStatus: async (ideId: string) => {
          try {
            const status = await getPatchStatus({ ideId });
            set((state) => ({
              patchStatus: { ...state.patchStatus, [ideId]: status },
            }));
            return status;
          } catch (error) {
            const message = error instanceof TauriError ? error.message : String(error);
            // Set error status for this IDE
            const errorStatus: PatchStatus = {
              ideId,
              status: 'error',
              error: message,
            };
            set((state) => ({
              patchStatus: { ...state.patchStatus, [ideId]: errorStatus },
            }));
            throw error;
          }
        },

        getAllPatchStatuses: async () => {
          const { detectedIDEs } = get();
          const results = await Promise.allSettled(
            detectedIDEs.map((ide: DetectedIDE) => getPatchStatus({ ideId: ide.id }))
          );

          const newStatuses: Record<string, PatchStatus> = {};
          results.forEach((result, index) => {
            const ideId = detectedIDEs[index].id;
            if (result.status === 'fulfilled') {
              newStatuses[ideId] = result.value;
            } else {
              newStatuses[ideId] = {
                ideId,
                status: 'error',
                error: result.reason?.message || 'Failed to get status',
              };
            }
          });

          set((state) => ({
            patchStatus: { ...state.patchStatus, ...newStatuses },
          }));
        },

        // ============================================
        // Patching Operations
        // ============================================

        setPatchStrategy: (strategy) => set({ patchStrategy: strategy }),
        setLogRequests: (log) => set({ logRequests: log }),

        // ============================================
        // Trae Storage Patch
        // ============================================

        checkTraePatched: async () => {
          try {
            const [storagePatched, extensionPatched, workbenchPatched] = await Promise.all([
              isTraePatched().catch(() => null),
              isTraeExtensionPatched().catch(() => null),
              isTraeWorkbenchPatched().catch(() => null),
            ]);
            set({ 
              traePatched: storagePatched,
              traeExtensionPatched: extensionPatched,
              traeWorkbenchPatched: workbenchPatched,
            });
            return storagePatched ?? false;
          } catch (error) {
            // Trae not installed or storage not found
            set({ traePatched: null, traeExtensionPatched: null, traeWorkbenchPatched: null });
            return false;
          }
        },

        patchTraeFull: async () => {
          set({ traePatchLoading: true, error: null });
          try {
            const result = await patchTraeFull();
            if (result.success) {
              set({ 
                traePatched: true,
                traeExtensionPatched: true,
                traeWorkbenchPatched: true,
              });
            }
            set({ traePatchLoading: false });
            return result;
          } catch (error) {
            const message = error instanceof TauriError ? error.message : String(error);
            set({ error: message, traePatchLoading: false });
            throw error;
          }
        },

        applyPatch: async (ideId: string, createBackup = true) => { 
          set((state) => ({
            operationInProgress: { ...state.operationInProgress, [ideId]: 'patching' },
            error: null,
          }));

          try {
            const { patchStrategy } = get();
            const result = await patchIDE({ ideId, createBackup, strategy: patchStrategy });
            
            if (result.success) {
              // Update IDE status
              set((state) => ({
                detectedIDEs: state.detectedIDEs.map((ide: DetectedIDE) =>
                  ide.id === ideId ? { ...ide, isPatched: true } : ide
                ),
                patchStatus: {
                  ...state.patchStatus,
                  [ideId]: {
                    ideId,
                    status: 'patched' as PatchStatusType,
                    patchedAt: new Date().toISOString(),
                  },
                },
              }));

              // Refresh backups if a backup was created
              if (result.backupId) {
                await get().listBackups(ideId);
              }
            } else {
              // Set error state if patch was not successful
              set({ error: result.message || 'Patch failed for an unknown reason.' });
            }

            set((state) => ({
              operationInProgress: { ...state.operationInProgress, [ideId]: null },
            }));

            return result;
          } catch (error) {
            const message = error instanceof TauriError ? error.message : String(error);
            set((state) => ({
              error: message,
              operationInProgress: { ...state.operationInProgress, [ideId]: null },
            }));
            throw error;
          }
        },

        removePatch: async (ideId: string, restoreBackupFlag = true) => {
          set((state) => ({
            operationInProgress: { ...state.operationInProgress, [ideId]: 'unpatching' },
            error: null,
          }));

          try {
            const result = await unpatchIDE({ ideId, restoreBackup: restoreBackupFlag });
            
            if (result.success) {
              // Update IDE status
              set((state) => ({
                detectedIDEs: state.detectedIDEs.map((ide: DetectedIDE) =>
                  ide.id === ideId ? { ...ide, isPatched: false, patchVersion: undefined } : ide
                ),
                patchStatus: {
                  ...state.patchStatus,
                  [ideId]: {
                    ideId,
                    status: 'unpatched' as PatchStatusType,
                  },
                },
              }));
            }

            set((state) => ({
              operationInProgress: { ...state.operationInProgress, [ideId]: null },
            }));

            return result;
          } catch (error) {
            const message = error instanceof TauriError ? error.message : String(error);
            set((state) => ({
              error: message,
              operationInProgress: { ...state.operationInProgress, [ideId]: null },
            }));
            throw error;
          }
        },

        // ============================================
        // Backup Management
        // ============================================

        listBackups: async (ideId?: string) => {
          set({ backupsLoading: true });
          try {
            const backupList = await listBackups({ ideId });
            
            // Group backups by IDE
            const groupedBackups: Record<string, BackupInfo[]> = {};
            for (const backup of backupList) {
              if (!groupedBackups[backup.ideId]) {
                groupedBackups[backup.ideId] = [];
              }
              groupedBackups[backup.ideId].push(backup);
            }

            set((state) => ({
              backups: ideId
                ? { ...state.backups, [ideId]: backupList }
                : groupedBackups,
              backupsLoading: false,
            }));

            return backupList;
          } catch (error) {
            const message = error instanceof TauriError ? error.message : String(error);
            set({ error: message, backupsLoading: false });
            throw error;
          }
        },

        restoreBackup: async (backupId: string) => {
          // Find the IDE and backup info for this backup
          const { backups, detectedIDEs } = get();
          let ideId: string | null = null;
          let backup: BackupInfo | null = null;
          
          for (const [id, backupList] of Object.entries(backups)) {
            const foundBackup = backupList.find((b: BackupInfo) => b.id === backupId);
            if (foundBackup) {
              ideId = id;
              backup = foundBackup;
              break;
            }
          }

          if (!backup) {
            throw new Error(`Backup not found: ${backupId}`);
          }

          // Get the IDE type from the detected IDE
          const ide = detectedIDEs.find((i: DetectedIDE) => i.id === ideId);
          const ideType = ide?.type || 'kiro';

          if (ideId) {
            set((state) => ({
              operationInProgress: { ...state.operationInProgress, [ideId!]: 'restoring' },
              error: null,
            }));
          }

          try {
            const result = await restoreBackup({ ideType, backupPath: backup.path });
            
            if (result.success && ideId) {
              // Update IDE status
              set((state) => ({
                detectedIDEs: state.detectedIDEs.map((ide: DetectedIDE) =>
                  ide.id === ideId ? { ...ide, isPatched: false, patchVersion: undefined } : ide
                ),
                patchStatus: {
                  ...state.patchStatus,
                  [ideId]: {
                    ideId,
                    status: 'unpatched' as PatchStatusType,
                  },
                },
              }));
            }

            if (ideId) {
              set((state) => ({
                operationInProgress: { ...state.operationInProgress, [ideId!]: null },
              }));
            }

            return result;
          } catch (error) {
            const message = error instanceof TauriError ? error.message : String(error);
            set((state) => ({
              error: message,
              operationInProgress: ideId
                ? { ...state.operationInProgress, [ideId]: null }
                : state.operationInProgress,
            }));
            throw error;
          }
        },

        deleteBackup: async (backupId: string) => {
          try {
            await deleteBackup({ backupId });
            
            // Remove backup from state (backupId is the path)
            set((state) => {
              const newBackups = { ...state.backups };
              for (const ideId of Object.keys(newBackups)) {
                newBackups[ideId] = newBackups[ideId].filter((b: BackupInfo) => b.path !== backupId);
              }
              return { backups: newBackups };
            });
          } catch (error) {
            const message = error instanceof TauriError ? error.message : String(error);
            set({ error: message });
            throw error;
          }
        },

        // ============================================
        // Error Handling
        // ============================================

        clearError: () => {
          set({ error: null });
        },
      }),
      {
        name: 'patcher-store',
        partialize: (state) => ({
          // Only persist detected IDEs (not status which should be refreshed)
          detectedIDEs: state.detectedIDEs,
        }),
      }
    ),
    { name: 'patcher-store' }
  )
);


