/**
 * Settings Module
 * 
 * Handles all settings-related operations including:
 * - Get/update application settings
 * - Addy.io integration (connection test, account, domains, recipients)
 * - IMAP connection testing
 * - Email counter management
 */

import { emit } from '@/lib/events';
import type {
  SettingsData,
  AddyIoTokenDetails,
  AddyIoAccountDetails,
  AddyIoRecipient,
  AddyIoDomainOptions,
} from '../../../types/generated';
import { safeInvoke } from '../core';

// ============================================
// Settings Management
// ============================================

/**
 * Get current application settings
 */
export async function getSettings(): Promise<SettingsData> {
  return safeInvoke<SettingsData>('get_settings');
}

/**
 * Update application settings
 */
type ExtendedSettingsData = SettingsData & {
  captchaSoundFile?: string;
};

export async function updateSettings(
  updates: Partial<ExtendedSettingsData>
): Promise<SettingsData> {
  // Load current settings to avoid overwriting fields not included in the partial update.
  // The Rust update_settings command replaces ALL fields, so missing fields would reset
  // to their defaults (e.g. headless -> false) if we send a partial update.
  let settings = updates;
  try {
    const current = await getSettings();
    settings = { ...current, ...updates };
  } catch {
    // If getSettings fails, proceed with partial update (may reset other fields to defaults)
  }

  const result = await safeInvoke<SettingsData>('update_settings', { settings });
  // Emit event so other components can sync
  await emit('SETTINGS_UPDATED', result);
  return result;
}

// ============================================
// Addy.io Integration
// ============================================

/**
 * Test addy.io API connection
 */
export async function testAddyioConnection(apiToken: string): Promise<AddyIoTokenDetails> {
  return safeInvoke('test_addyio_connection', { apiToken });
}

/**
 * Get addy.io account details
 */
export async function getAddyioAccount(apiToken: string): Promise<AddyIoAccountDetails> {
  return safeInvoke('get_addyio_account', { apiToken });
}

/**
 * Get addy.io domain options
 */
export async function getAddyioDomains(apiToken: string): Promise<AddyIoDomainOptions> {
  return safeInvoke('get_addyio_domains', { apiToken });
}

/**
 * Get addy.io recipients
 */
export async function getAddyioRecipients(apiToken: string): Promise<AddyIoRecipient[]> {
  return safeInvoke('get_addyio_recipients', { apiToken });
}

// ============================================
// Email Counter Management
// ============================================

/**
 * Get next counter value for email generation
 * Counter increments per provider and strategy combination
 */
export async function getNextCounter(params: {
  provider: string;
  strategy: string;
}): Promise<number> {
  return safeInvoke<number>('get_next_counter', {
    provider: params.provider,
    strategy: params.strategy,
  });
}

/**
 * Get email counter value for a provider and strategy
 */
export async function getEmailCounter(params: {
  provider: string;
  strategy: string;
}): Promise<number> {
  return safeInvoke<number>('get_email_counter', {
    provider: params.provider,
    strategy: params.strategy,
  });
}

/**
 * Set email counter value for a provider and strategy
 */
export async function setEmailCounter(params: {
  provider: string;
  strategy: string;
  counter: number;
}): Promise<void> {
  return safeInvoke<void>('set_email_counter', {
    provider: params.provider,
    strategy: params.strategy,
    counter: params.counter,
  });
}
