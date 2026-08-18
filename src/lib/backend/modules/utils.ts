/**
 * Utility Functions Module
 *
 * Handles miscellaneous utility operations including:
 * - Clipboard operations
 * - Browser/file manager operations
 * - Application metadata
 * - Dashboard statistics
 * - Backend health checks
 * - WebSocket helpers
 */

import type { DashboardStats } from '../../../types/generated';
import { safeInvoke } from '../core';

// ============================================
// Clipboard & System Operations
// ============================================

/**
 * Copy text to clipboard
 */
export async function copyToClipboard(params: { text: string }): Promise<void> {
  return safeInvoke<void>('copy_to_clipboard', { text: params.text });
}

/**
 * Open URL in default browser
 */
export async function openInBrowser(params: { url: string }): Promise<void> {
  return safeInvoke<void>('open_in_browser', { url: params.url });
}

/**
 * Open file in system file manager
 */
export async function openInFileManager(params: { path: string }): Promise<void> {
  return safeInvoke<void>('open_in_file_manager', { path: params.path });
}

// ============================================
// Dashboard & Statistics
// ============================================

/**
 * Get dashboard statistics
 */
export async function getDashboardStats(): Promise<DashboardStats> {
  return safeInvoke<DashboardStats>('get_dashboard_stats');
}

/**
 * Get the database file path
 */
export async function getDatabasePath(): Promise<string> {
  return safeInvoke<string>('get_database_path');
}
