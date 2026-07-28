/**
 * IDE Patcher Module
 *
 * Handles all IDE patching operations including:
 * - IDE detection
 * - Patch status checking
 * - Applying/removing patches
 * - Backup management
 * - IDE verification
 * - Trae-specific patching (storage, extension, workbench)
 */

import type { DetectedIDE, PatchStatus, PatchResult } from '../../../types/ui';
import type { BackupInfo } from '../../../types/generated';
import { safeInvoke } from '../core';

// ============================================
// Types
// ============================================

export interface PatchIDEParams {
  ideId: string;
  createBackup?: boolean;
  strategy?: 'injection' | 'legacy';
}

export interface UnpatchIDEParams {
  ideId: string;
  restoreBackup?: boolean;
}

export interface RestoreBackupParams {
  ideType: string;
  backupPath: string;
}

export interface UIBackupInfo {
  id: string;
  ideId: string;
  ideName: string;
  ideVersion: string;
  createdAt: string;
  path: string;
  size: number;
  isValid: boolean;
}

// ============================================
// IDE Detection & Status
// ============================================

/**
 * Detect installed IDEs
 */
export async function detectIDEs(): Promise<DetectedIDE[]> {
  return safeInvoke<DetectedIDE[]>('detect_ides');
}

/**
 * Get patch status for a specific IDE
 */
export async function getPatchStatus(params: { ideId: string }): Promise<PatchStatus> {
  return safeInvoke<PatchStatus>('get_patch_status', { ideType: params.ideId });
}

// ============================================
// Patch Operations
// ============================================

/**
 * Apply patch to an IDE
 */
export async function patchIDE(params: PatchIDEParams): Promise<PatchResult> {
  return safeInvoke<PatchResult>('apply_patch', {
    ideType: params.ideId,
    strategy: params.strategy || 'injection', // Default to injection
  });
}

/**
 * Remove patch from an IDE
 */
export async function unpatchIDE(params: UnpatchIDEParams): Promise<PatchResult> {
  return safeInvoke<PatchResult>('remove_patch', {
    ideType: params.ideId,
  });
}

// ============================================
// Backup Management
// ============================================

/**
 * List all backups
 */
export async function listBackups(params?: { ideId?: string }): Promise<UIBackupInfo[]> {
  const rustBackups = await safeInvoke<BackupInfo[]>('list_backups', {
    ideType: params?.ideId || 'kiro',
  });

  // Convert Rust BackupInfo to UI BackupInfo
  return rustBackups.map(backup => ({
    id: backup.path, // Use path as ID
    ideId: params?.ideId || 'kiro',
    ideName: params?.ideId || 'Kiro',
    ideVersion: 'unknown',
    createdAt: backup.createdAt,
    path: backup.path,
    size: backup.fileSize,
    isValid: true, // Assume valid if returned by Rust
  }));
}

/**
 * Restore a backup
 */
export async function restoreBackup(params: RestoreBackupParams): Promise<PatchResult> {
  return safeInvoke<PatchResult>('restore_backup', {
    ideType: params.ideType,
    backupPath: params.backupPath,
  });
}

/**
 * Delete a backup
 */
export async function deleteBackup(params: { backupId: string }): Promise<void> {
  return safeInvoke<void>('delete_backup', { backupId: params.backupId });
}

// ============================================
// Trae Storage Patch
// ============================================

/**
 * Check if Trae storage is patched (Pro enabled)
 */
export async function isTraePatched(): Promise<boolean> {
  return safeInvoke<boolean>('is_trae_patched');
}

/**
 * Patch all Trae files (storage + extension + workbench)
 */
export async function patchTraeFull(): Promise<PatchResult> {
  return safeInvoke<PatchResult>('patch_trae_full');
}

/**
 * Check if Trae extension.js is patched
 */
export async function isTraeExtensionPatched(): Promise<boolean> {
  return safeInvoke<boolean>('is_trae_extension_patched');
}

/**
 * Check if Trae workbench is patched
 */
export async function isTraeWorkbenchPatched(): Promise<boolean> {
  return safeInvoke<boolean>('is_trae_workbench_patched');
}
