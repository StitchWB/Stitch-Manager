/**
 * IDE Patcher Module
 *
 * Handles all IDE patching operations including:
 * - IDE detection
 * - Patch status checking
 * - Applying/removing patches
 * - Backup management
 * - IDE verification
 */

import type { DetectedIDE, PatchStatus, PatchResult } from '../../../types/ui';
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
  backupId: string;
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

interface BackendBackupInfo {
  id: string;
  path: string;
  size: number;
  createdAt: string;
}

// ============================================
// IDE Detection & Status
// ============================================

/**
 * Detect installed IDEs
 * @param force - If true, bypass cache and rescan (default: false)
 */
export async function detectIDEs(force: boolean = false): Promise<DetectedIDE[]> {
  return safeInvoke<DetectedIDE[]>('detect_ides', { force });
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
    createBackup: params.createBackup ?? true, // Default to true
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
  const backups = await safeInvoke<BackendBackupInfo[]>('list_backups', {
    ideType: params?.ideId || 'kiro',
  });

  return backups.map(backup => ({
    id: backup.id,
    ideId: params?.ideId || 'kiro',
    ideName: params?.ideId || 'Kiro',
    ideVersion: 'unknown',
    createdAt: backup.createdAt,
    path: backup.path,
    size: backup.size,
    isValid: true,
  }));
}

/**
 * Restore a backup
 */
export async function restoreBackup(params: RestoreBackupParams): Promise<PatchResult> {
  return safeInvoke<PatchResult>('restore_backup', {
    backupId: params.backupId,
  });
}

/**
 * Delete a backup
 */
export async function deleteBackup(params: { backupId: string }): Promise<void> {
  return safeInvoke<void>('delete_backup', { backupId: params.backupId });
}

// ============================================
// IDE Launch
// ============================================

/**
 * Launch an IDE
 */
export async function launchIDE(ideId: string): Promise<void> {
  return safeInvoke<void>('launch_ide', { ideId });
}
