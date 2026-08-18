/**
 * Migration utilities for provider strategies
 */

import type { ProviderEmailStrategy, ProviderEmailStrategies } from '../types';
import { createLogger } from '../../../lib/observability/logger';
const log = createLogger('Migration');

const DEFAULT_EMAIL_STRATEGY: ProviderEmailStrategy = {
  strategy: 'custom',
  customDomain: '',
  thirtyThreeMailDomain: '33mail.com',
  addyioDomain: '',
};

/**
 * Load provider strategies from localStorage with migration support
 */
export const loadProviderStrategies = (): ProviderEmailStrategies => {
  try {
    const stored = localStorage.getItem('providerEmailStrategies');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // fall through to defaults
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
    v0_app: { ...DEFAULT_EMAIL_STRATEGY },
    bitbucket: { ...DEFAULT_EMAIL_STRATEGY },
    claude: { ...DEFAULT_EMAIL_STRATEGY },
    anthropic: { ...DEFAULT_EMAIL_STRATEGY },
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
    log.debug('Saved provider strategies to localStorage');
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