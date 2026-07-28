/**
 * Account Management Module
 *
 * Handles all account-related operations including:
 * - CRUD operations (list, get, add, delete)
 * - Bulk operations (delete, refresh, export)
 * - Token management (update, refresh)
 * - Quota management
 * - Account validation and status checks
 * - Active account management
 * - Browser session management
 */

import type { Account, BulkOperationResult } from '../../../types/generated';
import type { ProviderName, AccountStatusInfo } from '../../../types/ui';
import { safeInvoke } from '../core';

// ============================================
// Types
// ============================================

export interface ListAccountsParams {
  provider?: ProviderName;
}

export interface GetAccountsParams {
  providerType?: string;
  providerSubtype?: string;
  showArchived?: boolean;
}

export interface AddAccountParams {
  provider: ProviderName;
  email: string;
  password: string;
  token?: string;
  refreshToken?: string;
  quotaLimit?: number;
  metadata?: Record<string, unknown>;
}

export interface DeleteAccountParams {
  accountId: string | number;
}

export interface RefreshAccountParams {
  accountId: string | number;
}

export interface GetQuotaParams {
  accountId: string | number;
}

export interface SetActiveAccountParams {
  provider: string;
  accountId: number | null;
}

export interface TokenWriteResult {
  success: boolean;
  message: string;
  tokenPath: string | null;
  clientPath: string | null;
}

// ============================================
// Account CRUD Operations
// ============================================

/**
 * List all accounts, optionally filtered by provider
 */
export async function listAccounts(params?: ListAccountsParams): Promise<Account[]> {
  return safeInvoke<Account[]>('list_accounts', { provider: params?.provider });
}

/**
 * Get accounts with optional filtering by provider_type and provider_subtype
 * Supports unified accounts UI with provider filtering
 */
export async function getAccounts(params?: GetAccountsParams): Promise<Account[]> {
  return safeInvoke<Account[]>('get_accounts', {
    providerType: params?.providerType,
    providerSubtype: params?.providerSubtype,
    showArchived: params?.showArchived,
  });
}

/**
 * Add a new account
 */
export async function addAccount(params: AddAccountParams): Promise<Account> {
  // Convert metadata object to JSON string for Rust
  const metadata = params.metadata ? JSON.stringify(params.metadata) : undefined;

  return safeInvoke<Account>('add_account', {
    account: {
      provider: params.provider,
      email: params.email,
      password: params.password,
      token: params.token,
      refreshToken: params.refreshToken,
      quotaLimit: params.quotaLimit,
      metadata,
    },
  });
}

/**
 * Delete an account by ID
 */
export async function deleteAccount(params: DeleteAccountParams): Promise<void> {
  return safeInvoke<void>('delete_account', { id: Number(params.accountId) });
}

/**
 * Archive or unarchive an account by ID
 */
export async function archiveAccount(params: { accountId: number; archived: boolean }): Promise<Account> {
  return safeInvoke<Account>('archive_account', { id: Number(params.accountId), archived: params.archived });
}

// ============================================
// Bulk Operations
// ============================================

/**
 * Bulk delete accounts
 */
export async function bulkDeleteAccounts(params: {
  accountIds: number[];
}): Promise<BulkOperationResult> {
  return safeInvoke<BulkOperationResult>('bulk_delete_accounts', {
    accountIds: params.accountIds,
  });
}

/**
 * Bulk export accounts to JSON or CSV
 */
export async function bulkExportAccounts(params: {
  accountIds: number[];
  format: 'json' | 'csv';
}): Promise<string> {
  return safeInvoke<string>('bulk_export_accounts', {
    accountIds: params.accountIds,
    format: params.format,
  });
}

/**
 * Import accounts from JSON payload
 */
export async function importAccountsPayload(accountsJson: string): Promise<BulkOperationResult> {
  return safeInvoke<BulkOperationResult>('import_accounts_payload', {
    accountsJson,
  });
}

// ============================================
// Token Management
// ============================================

/**
 * Manually refresh an account's OAuth token using its refresh_token
 */
export async function refreshAccountToken(params: {
  accountId: number;
}): Promise<import('../../../types/generated').TokenRefreshResult> {
  return safeInvoke<import('../../../types/generated').TokenRefreshResult>(
    'refresh_account_token',
    {
      accountId: params.accountId,
    }
  );
}

// ============================================
// Quota Management
// ============================================

/**
 * Refresh account quota information
 */
export async function refreshAccountQuota(params: RefreshAccountParams): Promise<Account> {
  return safeInvoke<Account>('refresh_account', { id: Number(params.accountId) });
}

// ============================================
// Account Validation & Status
// ============================================

/**
 * Validate account credentials
 */
export async function validateAccount(params: { accountId: string | number }): Promise<boolean> {
  return safeInvoke<boolean>('validate_account', { account_id: Number(params.accountId) });
}

/**
 * Check account status for any provider (auto-detects provider)
 */
export async function checkAccountStatus(params: {
  accountId: string | number;
}): Promise<AccountStatusInfo> {
  return safeInvoke<AccountStatusInfo>('check_account_status', {
    accountId: Number(params.accountId),
  });
}

/**
 * Check Fireworks API key status (validity, balance, suspension)
 */
export async function checkFireworksApiKey(params: { apiKey: string }): Promise<import('../../../types/generated').FireworksKeyStatus> {
  return safeInvoke<import('../../../types/generated').FireworksKeyStatus>(
    'check_fireworks_api_key_rust',
    { apiKey: params.apiKey }
  );
}

// ============================================
// Notes & Tags
// ============================================

/**
 * Update account notes and tags
 */
export async function updateAccountNotesTags(params: {
  accountId: number;
  notes?: string;
  tags?: string;
}): Promise<Account> {
  return safeInvoke<Account>('update_account_notes_tags', {
    account_id: params.accountId,
    notes: params.notes,
    tags: params.tags,
  });
}

// ============================================
// Active Account Management
// ============================================

/**
 * Set the active account for a provider
 * This will update the IDE config with the selected account's token
 * and write the token to Kiro's SSO cache (~/.aws/sso/cache/kiro-auth-token.json)
 */
export async function setActiveAccount(params: SetActiveAccountParams): Promise<TokenWriteResult> {
  return safeInvoke<TokenWriteResult>('set_active_account', {
    provider: params.provider,
    accountId: params.accountId,
  });
}

/**
 * Get all active accounts (provider -> accountId mapping)
 */
export async function getActiveAccounts(): Promise<Record<string, number | null>> {
  return safeInvoke<Record<string, number | null>>('get_active_accounts');
}

// ============================================
// Metadata Update
// ============================================

export interface UpdateAccountMetadataParams {
  accountId: number;
  metadata: string | null;
}

export async function updateAccountMetadata(params: UpdateAccountMetadataParams): Promise<Account> {
  return safeInvoke<Account>('update_account_metadata', {
    accountId: params.accountId,
    metadata: params.metadata,
  });
}

// ============================================
// Browser Session Management
// ============================================

// ============================================
// Proxy Binding
// ============================================

/**
 * Set or clear the proxy binding for an account.
 * @param accountId - Account ID
 * @param proxyId - ProxyLibraryEntry UUID or null to unbind
 */
export async function setAccountProxy(params: { accountId: number; proxyId: string | null }): Promise<Account> {
  return safeInvoke<Account>('set_account_proxy', {
    account_id: params.accountId,
    proxy_id: params.proxyId,
  });
}

/**
 * Open a browser with the specific account's persistent profile
 */
export async function openAccountBrowser(params: { accountId: number }): Promise<void> {
  return safeInvoke<void>('open_account_browser', { id: params.accountId });
}

/**
 * Open a profile session for an account (manual login workflow)
 */
export async function openAccountProfileSession(params: { accountId: number }): Promise<void> {
  return safeInvoke<void>('open_account_profile_session', { account_id: params.accountId });
}

/**
 * Confirm manual login completion for a profile session
 */
export async function confirmAccountProfileSession(params: { accountId: number }): Promise<void> {
  return safeInvoke<void>('confirm_account_profile_session', { account_id: params.accountId });
}

/**
 * Clear profile session for an account (cookies/session/profile path + profile:* tags)
 */
export async function clearAccountProfileSession(params: { accountId: number }): Promise<void> {
  return safeInvoke<void>('clear_account_profile_session', { account_id: params.accountId });
}

/**
 * (duplicate declarations removed)
 */
