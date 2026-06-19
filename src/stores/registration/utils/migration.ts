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
      if (import.meta.env.DEV) console.debug('[MIGRATION] Found providerEmailStrategies, no migration needed');
      return JSON.parse(stored);
    }

    // Check for old format
    const oldStored = localStorage.getItem('providerImapConfigs');
    if (!oldStored) {
      if (import.meta.env.DEV) console.debug('[MIGRATION] No old data found');
      return null;
    }

    if (import.meta.env.DEV) console.debug('[MIGRATION] Found old providerImapConfigs, migrating...');
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
    if (import.meta.env.DEV) console.debug('[MIGRATION] Migration completed, old data removed');

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
    kiro_v2: { ...DEFAULT_EMAIL_STRATEGY },
    windsurf: { ...DEFAULT_EMAIL_STRATEGY },
    trae: { ...DEFAULT_EMAIL_STRATEGY },
    github: { ...DEFAULT_EMAIL_STRATEGY },
    aws: { ...DEFAULT_EMAIL_STRATEGY },
    copilot: { ...DEFAULT_EMAIL_STRATEGY },
    openai: { ...DEFAULT_EMAIL_STRATEGY },
    fireworks: { ...DEFAULT_EMAIL_STRATEGY },
    qoder: { ...DEFAULT_EMAIL_STRATEGY },
    bitbucket: { ...DEFAULT_EMAIL_STRATEGY },
    claude: { ...DEFAULT_EMAIL_STRATEGY },
    gemini: { ...DEFAULT_EMAIL_STRATEGY },
    antigravity: { ...DEFAULT_EMAIL_STRATEGY },
    aws_builder_id: { ...DEFAULT_EMAIL_STRATEGY },
  };
};

/**
 * Save provider strategies to localStorage
 */
export const saveProviderStrategies = (strategies: ProviderEmailStrategies): void => {
  try {
    localStorage.setItem('providerEmailStrategies', JSON.stringify(strategies));
    if (import.meta.env.DEV) console.debug('[MIGRATION] Saved provider strategies to localStorage');
  } catch (error) {
    console.warn('[MIGRATION] Failed to save provider strategies:', error);
  }
};

export const loadEmailGenerationDomain = (): string => {
  try {
    return localStorage.getItem('emailGenerationDomain') || '';
  } catch {
    return '';
  }
};

export const saveEmailGenerationDomain = (domain: string): void => {
  try {
    localStorage.setItem('emailGenerationDomain', domain);
  } catch (error) {
    console.warn('[MIGRATION] Failed to save emailGenerationDomain:', error);
  }
};
