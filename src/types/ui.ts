import type { Account, DashboardStats, KiroPatchConfig, PatchResult, Provider } from './generated';

// Re-export generated Provider type for backward compatibility
export type ProviderName = Provider;

export type Theme = 'dark' | 'light' | 'system';

export interface ProviderInfo {
  id: ProviderName;
  name: string;
  version: string;
  activeCount: number;
  status: 'active' | 'down' | 'maintenance';
  color: string;
}

export type AccountStatus = 'active' | 'banned' | 'limit_hit' | 'expired' | 'unknown';

export interface AccountStatusInfo {
  provider: string;
  email: string;
  isActive: boolean;
  plan: string;
  quotaUsed: number;
  quotaLimit: number;
  quotaPercent: number;
  flowCreditsUsed?: number;
  flowCreditsLimit?: number;
  expiresAt?: string;
  resetsAt?: string;
  rawResponse?: string;
}

export type RegistrationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type RegistrationStep =
  | 'idle'
  | 'initializing'
  | 'creating_email'
  | 'opening_browser'
  | 'registering'
  | 'verifying'
  | 'authenticating'
  | 'saving'
  | 'completing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface RegistrationLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug' | 'success';
  message: string;
  jobId?: string;
  details?: Record<string, unknown>;
}

export interface RegistrationProgress {
  current: number;
  total: number;
  percentage: number;
  currentStep?: string;
  estimatedTimeRemaining?: number;
}

export interface RegistrationJob {
  id: string;
  provider: ProviderName;
  status: RegistrationStatus;
  step?: RegistrationStep;
  progress?: number;
  email?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
  account?: Account;
}

export interface OpenAIAutoregConfig {
  email: string | null;
  password: string | null;
  name: string | null;
  emailStrategy: string | null;
  baseEmail: string | null;
  headless: boolean;
  proxyUrl: string | null;
  imapServer: string | null;
  imapPort: number | null;
  imapUser: string | null;
  imapPassword: string | null;
  addyioEnabled: boolean | null;
  addyioApiToken: string | null;
  addyioDomain: string | null;
  addyioAliasFormat: string | null;
  addyioAutoDelete: boolean | null;
  mailtmEnabled: boolean | null;
  thirtyThreeMailEnabled: boolean | null;
  thirtyThreeMailUsername: string | null;
  thirtyThreeMailDomain: string | null;
}

export interface OpenAIAutoregResult {
  success: boolean;
  email: string | null;
  password: string | null;
  name: string | null;
  error: string | null;
}

export interface FireworksAutoregConfig {
  email: string | null;
  password: string | null;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  emailStrategy: string | null;
  baseEmail: string | null;
  headless: boolean;
  proxyUrl: string | null;
  imapServer: string | null;
  imapPort: number | null;
  imapUser: string | null;
  imapPassword: string | null;
  addyioEnabled: boolean | null;
  addyioApiToken: string | null;
  addyioDomain: string | null;
  addyioAliasFormat: string | null;
  addyioAutoDelete: boolean | null;
  mailtmEnabled: boolean | null;
  thirtyThreeMailEnabled: boolean | null;
  thirtyThreeMailUsername: string | null;
  thirtyThreeMailDomain: string | null;
  inboxProvider: string | null;
  inboxMailbox: string | null;
  inboxMailtmAddress: string | null;
  inboxMailtmPassword: string | null;
  inboxMailtmBaseUrl: string | null;
  correlationId: string | null;
  cardsFile: string | null;
  cardsText: string | null;
  cardBin: string | null;
  captchaTimeout: number;
  captchaSoundEnabled: boolean;
  debug?: boolean;
}

export interface FireworksAutoregResult {
  success: boolean;
  email: string | null;
  password: string | null;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  apiKey?: string | null;
  api_key?: string | null;
  plan: string | null;
  error: string | null;
}

export interface BitbucketAutoregConfig {
  email: string | null;
  password: string | null;
  name: string | null;
  headless: boolean;
  proxyUrl: string | null;
  imapServer: string | null;
  imapPort: number | null;
  imapUser: string | null;
  imapPassword: string | null;
  addyioEnabled: boolean | null;
  addyioApiToken: string | null;
  addyioDomain: string | null;
  addyioAliasFormat: string | null;
  addyioAutoDelete: boolean | null;
  thirtyThreeMailEnabled: boolean | null;
  thirtyThreeMailUsername: string | null;
  thirtyThreeMailDomain: string | null;
  mailtmEnabled: boolean | null;
  inboxProvider: string | null;
  inboxMailbox: string | null;
  inboxMailtmAddress: string | null;
  inboxMailtmPassword: string | null;
  inboxMailtmBaseUrl: string | null;
  correlationId: string | null;
}

export interface BitbucketAutoregResult {
  success: boolean;
  email: string | null;
  password: string | null;
  name: string | null;
  error: string | null;
}

export interface KiroV2AutoregConfig {
  email: string | null;
  password: string | null;
  name: string | null;
  headless: boolean;
  proxyUrl: string | null;
  imapServer: string | null;
  imapPort: number | null;
  imapUser: string | null;
  imapPassword: string | null;
  addyioEnabled: boolean | null;
  addyioApiToken: string | null;
  addyioDomain: string | null;
  addyioAliasFormat: string | null;
  addyioAutoDelete: boolean | null;
  thirtyThreeMailEnabled: boolean | null;
  thirtyThreeMailUsername: string | null;
  thirtyThreeMailDomain: string | null;
  mailtmEnabled: boolean | null;
  inboxProvider: string | null;
  inboxMailbox: string | null;
  inboxMailtmAddress: string | null;
  inboxMailtmPassword: string | null;
  inboxMailtmBaseUrl: string | null;
  cardNumber: string | null;
  cardExpiry: string | null;
  cardCvc: string | null;
  cardholderName: string | null;
  billingCountry: string | null;
  billingAddress: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingZip: string | null;
  cardsText: string | null;
  cardBin: string | null;
  correlationId: string | null;
}

export interface KiroV2AutoregResult {
  success: boolean;
  email: string | null;
  password: string | null;
  name: string | null;
  billingAttached: boolean | null;
  billingError: string | null;
  error: string | null;
}

export type IDEType = 'kiro' | 'windsurf' | 'trae' | 'vscode' | 'vscodium' | 'other';

export type PatchStatusType = 'unpatched' | 'patched' | 'outdated' | 'error' | 'unknown';

export interface IDEInfo {
  id: string;
  name: string;
  type: IDEType;
  path?: string;
  version?: string;
  electronVersion?: string;
  isPortable?: boolean;
}

export interface DetectedIDE extends IDEInfo {
  isPatched: boolean;
  patchVersion?: string;
  patchedAt?: string;
  canPatch: boolean;
  error?: string;
  installed: boolean;
}

export interface PatchStatus {
  ideId: string;
  status: PatchStatusType;
  patchVersion?: string;
  patchedAt?: string;
  originalHash?: string;
  patchedHash?: string;
  error?: string;
  extensionValid?: boolean;
  extensionPath?: string;
  backupExists?: boolean;
  backupValid?: boolean;
  backupPath?: string;
  patternsApplied?: number;
  totalPatterns?: number;
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

export type { Account, DashboardStats, KiroPatchConfig, PatchResult };
