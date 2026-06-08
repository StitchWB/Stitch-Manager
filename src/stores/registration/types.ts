/**
 * Shared types for registration stores
 */

import type { ProviderName } from '../../types/ui';

// Mail strategy type
export type MailStrategy = 'custom' | 'gmail' | 'cf-to-imap';

// Email strategy type
export type EmailStrategy = 'static' | 'counter' | 'addyio' | 'addyio_counter';

// IMAP configuration (kept for future email verification)
export interface IMAPConfig {
  strategy: MailStrategy;
  // Email generation strategy
  emailStrategy?: EmailStrategy;
  // Custom domain fields (GLOBAL - shared across providers)
  server: string;
  port: number;
  email: string;
  password: string;
  useTLS: boolean;
  // Email pattern configuration (for custom domain pattern generation)
  emailCustomPrefix: string;
  // Gmail alias fields (GLOBAL - shared across providers)
  gmailBase: string;
  gmailAlias: string;
  gmailAppPassword: string;
  // Addy.io fields (GLOBAL - shared across providers)
  addyioEnabled?: boolean;
  addyioApiToken?: string;
  addyioDomain?: string;
  addyioAliasFormat?: string;
  addyioAutoDelete?: boolean;
  addyioDefaultRecipientId?: string;
  addyioDescriptionTemplate?: string;
  addyioFromName?: string;
  // 33mail fields (GLOBAL - shared across providers)
  thirtyThreeMailEnabled?: boolean;
  thirtyThreeMailUsername?: string;
  thirtyThreeMailDomain?: string;
  thirtyThreeMailTemplate?: string;
  // Mail.tm fields (GLOBAL - shared across providers)
  mailtmEnabled?: boolean;
  // CF-to-IMAP: explicit email generation domain (overrides imap.email domain)
  emailGenerationDomain?: string;
}

// Provider-specific email strategy settings (NOT including IMAP credentials)
export interface ProviderEmailStrategy {
  strategy: MailStrategy; // custom/gmail/cf-to-imap
  // For custom domain - which domain to use
  customDomain?: string;
  // For 33mail - which domain to use
  thirtyThreeMailDomain?: string;
  // For addyio - which domain to use
  addyioDomain?: string;
}

// Provider-specific configurations (email strategy only, IMAP is global)
export interface ProviderEmailStrategies {
  kiro: ProviderEmailStrategy;
  kiro_v2: ProviderEmailStrategy;
  windsurf: ProviderEmailStrategy;
  trae: ProviderEmailStrategy;
  github: ProviderEmailStrategy;
  aws: ProviderEmailStrategy;
  copilot: ProviderEmailStrategy;
  openai: ProviderEmailStrategy;
  fireworks: ProviderEmailStrategy;
  bitbucket: ProviderEmailStrategy;
  claude: ProviderEmailStrategy;
  gemini: ProviderEmailStrategy;
  antigravity: ProviderEmailStrategy;
  aws_builder_id: ProviderEmailStrategy;
}

// Proxy configuration
export interface ProxyConfig {
  enabled: boolean;
  url: string;
  username?: string;
  password?: string;
  type: 'http' | 'socks5';
  list: string;
  rotationEnabled: boolean;
  proxyLibraryId?: string;
}

// Auto-registration credentials
export interface AutoRegCredentials {
  email: string;
  password: string;
}

// Email pattern types
export type EmailPattern =
  | 'random'
  | 'name_random'
  | 'provider_timestamp'
  | 'custom_prefix'
  | 'name_counter';

// Name pattern types
export type NamePattern = 'random' | 'from_email' | 'custom';

// Pattern configuration
export interface PatternConfig {
  emailPattern: EmailPattern;
  emailCustomPrefix: string;
  namePattern: NamePattern;
  nameCustomFirst: string;
  nameCustomLast: string;
}

// Advanced settings configuration
export interface AdvancedSettings {
  // Main settings (always visible)
  headless: boolean;
  speedMultiplier: number; // 0.5 to 2.0
  delayBetweenAccounts: number; // 1-10 seconds

  // Advanced settings (collapsible)
  verificationCodeTimeout: number; // 60-180s
  oauthCallbackTimeout: number; // 30-180s
  allowAccessWait: number; // 60-300s
  pageLoadTimeout: number; // 2-15s
  elementWaitTimeout: number; // 1-10s
  imapPollInterval: number; // 0.5-5s
  passwordLength: number; // 12-24
  realisticTyping: boolean;
  humanDelays: boolean;
  screenshotsOnError: boolean;
  captchaTimeout: number; // in minutes
  captchaSoundEnabled: boolean;
  captchaSoundFile: string; // e.g. 'alert1.mp3' from /sounds/

  // Card pool (pipe/CSV/space format, one per line)
  cardsText?: string;
  cardBin?: string; // BIN for auto-generating Live cards

  // Google Sheets Identity Graph (NO encryption in this phase)
  googleSheetsSpreadsheetId?: string;
  googleSheetsServiceAccountJson?: string;
}

// Registration configuration (simplified)
export interface RegistrationConfig {
  provider: ProviderName;
  credentials: AutoRegCredentials;
  imap: IMAPConfig; // Global IMAP config (shared across all providers)
  providerEmailStrategies: ProviderEmailStrategies; // Provider-specific email strategies
  proxy: ProxyConfig;
  patterns: PatternConfig;
  advanced: AdvancedSettings;
  count: number;
  timeout: number;
  retryAttempts: number;
  uiScale: number;
  logVerbosity?: string;
}

// Save status for UI feedback
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// Defaults
export const DEFAULT_IMAP_CONFIG: IMAPConfig = {
  strategy: 'custom',
  server: '',
  port: 993,
  email: '',
  password: '',
  useTLS: true,
  emailCustomPrefix: '',
  gmailBase: '',
  gmailAlias: '',
  gmailAppPassword: '',
  // Addy.io defaults
  addyioEnabled: false,
  addyioApiToken: '',
  addyioDomain: '',
  addyioAliasFormat: 'uuid',
  addyioAutoDelete: false,
  addyioDefaultRecipientId: '',
  addyioDescriptionTemplate: '',
  addyioFromName: '',
  // 33mail defaults
  thirtyThreeMailEnabled: false,
  thirtyThreeMailUsername: '',
  thirtyThreeMailDomain: '33mail.com',
  emailGenerationDomain: '',
};

export const DEFAULT_EMAIL_STRATEGY: ProviderEmailStrategy = {
  strategy: 'custom',
  customDomain: '',
  thirtyThreeMailDomain: '33mail.com',
  addyioDomain: '',
};

export const DEFAULT_CONFIG: RegistrationConfig = {
  provider: 'kiro',
  credentials: {
    email: '',
    password: '',
  },
  imap: { ...DEFAULT_IMAP_CONFIG },
  providerEmailStrategies: {
    kiro: { ...DEFAULT_EMAIL_STRATEGY },
    kiro_v2: { ...DEFAULT_EMAIL_STRATEGY },
    windsurf: { ...DEFAULT_EMAIL_STRATEGY },
    trae: { ...DEFAULT_EMAIL_STRATEGY },
    github: { ...DEFAULT_EMAIL_STRATEGY },
    aws: { ...DEFAULT_EMAIL_STRATEGY },
    copilot: { ...DEFAULT_EMAIL_STRATEGY },
    openai: { ...DEFAULT_EMAIL_STRATEGY },
    fireworks: { ...DEFAULT_EMAIL_STRATEGY },
    bitbucket: { ...DEFAULT_EMAIL_STRATEGY },
    claude: { ...DEFAULT_EMAIL_STRATEGY },
    gemini: { ...DEFAULT_EMAIL_STRATEGY },
    antigravity: { ...DEFAULT_EMAIL_STRATEGY },
    aws_builder_id: { ...DEFAULT_EMAIL_STRATEGY },
  },
  proxy: {
    enabled: false,
    url: '',
    username: '',
    password: '',
    type: 'http',
    list: '',
    rotationEnabled: false,
  },
  patterns: {
    emailPattern: 'provider_timestamp',
    emailCustomPrefix: '',
    namePattern: 'random',
    nameCustomFirst: '',
    nameCustomLast: '',
  },
  advanced: {
    // Main settings
    headless: false,
    speedMultiplier: 1.0,
    delayBetweenAccounts: 2,
    // Advanced settings
    verificationCodeTimeout: 120,
    oauthCallbackTimeout: 90,
    allowAccessWait: 120,
    pageLoadTimeout: 5,
    elementWaitTimeout: 2,
    imapPollInterval: 1,
    passwordLength: 16,
    realisticTyping: true,
    humanDelays: true,
    screenshotsOnError: true,
    captchaTimeout: 5,
    captchaSoundEnabled: true,
    captchaSoundFile: 'taksi.mp3',
    cardsText: '',
    cardBin: '',

    // Google Sheets Identity Graph (plaintext; encryption deferred)
    googleSheetsSpreadsheetId: '',
    googleSheetsServiceAccountJson: '',
  },
  count: 1,
  timeout: 60000,
  retryAttempts: 3,
  uiScale: 1.0,
  logVerbosity: 'normal',
};
