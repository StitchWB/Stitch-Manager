/**
 * Migration utilities for provider strategies
 */

import type { ProviderName } from '../../../types/ui';
import type { IMAPConfig, ProviderEmailStrategy, ProviderEmailStrategies } from '../types';

const DEFAULT_EMAIL_STRATEGY: ProviderEmailStrategy = {
  strategy: 'custom',
  customDomain: '',
  thirtyThreeMailDomain: '33mail.com',
  addyioDomain: '',
};

/**
 * Migrate old providerImapConfigs format to new providerEmailStrategies format
 */
export const migrateProviderStrategies = (): ProviderEmailStrategies | null => {
  try {
    const stored = localStorage.getItem('providerEmailStrategies');
    if (stored) {
      console.log('[MIGRATION] Found providerEmailStrategies, no migration needed');
      return JSON.parse(stored);
    }

    // Check for old format
    const oldStored = localStorage.getItem('providerImapConfigs');
    if (!oldStored) {
      console.log('[MIGRATION] No old data found');
      return null;
    }

    console.log('[MIGRATION] Found old providerImapConfigs, migrating...');
    const oldConfigs = JSON.parse(oldStored);
    const providerEmailStrategies = {} as ProviderEmailStrategies;

    // Convert old format to new format (extract only strategy and domain info)
    for (const [provider, oldConfig] of Object.entries(oldConfigs)) {
      const old = oldConfig as IMAPConfig;
      providerEmailStrategies[provider as ProviderName] = {
        strategy: old.strategy || 'custom',
        customDomain: old.server ? `${old.email?.split('@')[1] || ''}` : '',
        thirtyThreeMailDomain: old.thirtyThreeMailDomain || '33mail.com',
        addyioDomain: old.addyioDomain || '',
      };
    }

    // Save migrated data in new format
    localStorage.setItem('providerEmailStrategies', JSON.stringify(providerEmailStrategies));
    // Remove old format
    localStorage.removeItem('providerImapConfigs');
    console.log('[MIGRATION] Migration completed, old data removed');

    return providerEmailStrategies;
  } catch (error) {
    console.error('[MIGRATION] Migration failed:', error);
    return null;
  }
};

/**
 * Load provider strategies from localStorage with migration support
 */
export const loadProviderStrategies = (): ProviderEmailStrategies => {
  const migrated = migrateProviderStrategies();
  if (migrated) {
    return migrated;
  }

  // Return defaults if no stored data
  return {
    kiro: { ...DEFAULT_EMAIL_STRATEGY },
    windsurf: { ...DEFAULT_EMAIL_STRATEGY },
    trae: { ...DEFAULT_EMAIL_STRATEGY },
    github: { ...DEFAULT_EMAIL_STRATEGY },
    aws: { ...DEFAULT_EMAIL_STRATEGY },
    copilot: { ...DEFAULT_EMAIL_STRATEGY },
    openai: { ...DEFAULT_EMAIL_STRATEGY },
  };
};

/**
 * Save provider strategies to localStorage
 */
export const saveProviderStrategies = (strategies: ProviderEmailStrategies): void => {
  try {
    localStorage.setItem('providerEmailStrategies', JSON.stringify(strategies));
    console.log('[MIGRATION] Saved provider strategies to localStorage');
  } catch (error) {
    console.warn('[MIGRATION] Failed to save provider strategies:', error);
  }
};
