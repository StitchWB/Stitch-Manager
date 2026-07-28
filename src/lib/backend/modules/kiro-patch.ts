/**
 * Kiro Patch V3 Module
 *
 * Handles Kiro Patch V3 operations including:
 * - Configuration management
 * - Machine ID generation and binding
 * - Patch application and removal
 * - Prompt management
 */

import type { KiroPatchConfig } from '../../../types/kiro-patch';
import { safeInvoke } from '../core';

// ============================================
// Configuration Management
// ============================================

/**
 * Get Kiro Patch V3 configuration
 */
export async function getKiroPatchConfig(): Promise<KiroPatchConfig> {
  return safeInvoke<KiroPatchConfig>('get_kiro_patch_config');
}

/**
 * Save Kiro Patch V3 configuration
 */
export async function saveKiroPatchConfig(config: KiroPatchConfig): Promise<void> {
  return safeInvoke<void>('save_kiro_patch_config', { config });
}

// ============================================
// Machine ID Management
// ============================================

/**
 * Generate a new machine ID
 */
export async function generateNewMachineId(): Promise<string> {
  return safeInvoke<string>('generate_new_machine_id');
}

/**
 * Bind a machine ID to an account
 */
export async function bindMachineIdToAccount(accountId: string, machineId: string): Promise<void> {
  return safeInvoke<void>('bind_machine_id_to_account', { accountId, machineId });
}

/**
 * Unbind an account from its machine ID
 */
export async function unbindAccount(accountId: string): Promise<void> {
  return safeInvoke<void>('unbind_account', { accountId });
}

// ============================================
// Patch Operations
// ============================================

/**
 * Copy default prompts to user folder
 */
export async function copyDefaultPrompts(): Promise<string> {
  return safeInvoke<string>('copy_default_prompts');
}

/**
 * Get prompt content
 */
export async function getPromptContent(promptName: string): Promise<string> {
  return safeInvoke<string>('get_prompt_content', { promptName });
}

/**
 * Save prompt content
 */
export async function savePromptContent(promptName: string, content: string): Promise<void> {
  return safeInvoke<void>('save_prompt_content', { promptName, content });
}

/**
 * Get default prompt content from resources
 */
export async function getDefaultPromptContent(promptName: string): Promise<string> {
  return safeInvoke<string>('get_default_prompt_content', { promptName });
}

/**
 * Reset prompt to Kiro default
 */
export async function resetPromptToDefault(promptName: string): Promise<void> {
  return safeInvoke<void>('reset_prompt_to_default', { promptName });
}

// ============================================
// Kiro Proxy Management
// ============================================

/**
 * Start the Kiro reverse proxy server
 */
export async function startKiroProxy(): Promise<{ success: boolean; port: number; running: boolean; message: string }> {
  return safeInvoke<{ success: boolean; port: number; running: boolean; message: string }>('start_kiro_proxy');
}

/**
 * Stop the Kiro reverse proxy server
 */
export async function stopKiroProxy(): Promise<{ success: boolean; message: string }> {
  return safeInvoke<{ success: boolean; message: string }>('stop_kiro_proxy');
}

/**
 * Get Kiro proxy status
 */
export async function getKiroProxyStatus(): Promise<{ running: boolean; port: number }> {
  return safeInvoke<{ running: boolean; port: number }>('kiro_proxy_status');
}
