/**
 * Google Sheets Module
 *
 * Provides commands for ingesting Accounts graph dataset from a spreadsheet
 * using a Google service account JSON (JWT flow).
 */

import { safeInvoke } from '../core';
import type { AccountsGraphDataset, GoogleSheetsConnectionStatus } from '../../../types/generated';

export interface GoogleSheetsParams {
  spreadsheetId: string;
  /** Raw JSON string of Google service account key */
  serviceAccountJson: string;
}

const GOOGLE_SHEETS_ID_REGEX = /\/spreadsheets\/(?:u\/\d+\/)?d\/(?:e\/)?([a-zA-Z0-9-_]+)/i;
const GOOGLE_SHEETS_QUERY_ID_REGEX = /[?&#](?:id|key)=([a-zA-Z0-9-_]+)/i;

function extractSpreadsheetIdFromUrlLike(value: string): string | null {
  const hasProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value);
  const maybeUrl = hasProtocol ? value : `https://${value}`;

  try {
    const parsed = new URL(maybeUrl);
    const pathMatch = parsed.pathname.match(GOOGLE_SHEETS_ID_REGEX);
    if (pathMatch?.[1]) {
      return pathMatch[1];
    }

    const idParam = parsed.searchParams.get('id') ?? parsed.searchParams.get('key');
    if (idParam?.trim()) {
      return idParam.trim();
    }
  } catch {
    // ignore URL parsing errors and fallback to regex-only extraction
  }

  return null;
}

export function normalizeSpreadsheetId(input: string): string {
  const value = input.trim();
  if (!value) return '';

  const extractedFromUrl = extractSpreadsheetIdFromUrlLike(value);
  if (extractedFromUrl) {
    return extractedFromUrl;
  }

  const pathMatch = value.match(GOOGLE_SHEETS_ID_REGEX);
  if (pathMatch?.[1]) {
    return pathMatch[1];
  }

  const queryMatch = value.match(GOOGLE_SHEETS_QUERY_ID_REGEX);
  if (queryMatch?.[1]) {
    return queryMatch[1];
  }

  return value;
}

function withNormalizedSpreadsheetId<T extends { spreadsheetId: string }>(params: T): T {
  return {
    ...params,
    spreadsheetId: normalizeSpreadsheetId(params.spreadsheetId),
  };
}

/**
 * Lightweight metadata/status check (title + discovered sheets + warnings)
 */
export async function testGoogleSheetsConnection(
  params: GoogleSheetsParams
): Promise<GoogleSheetsConnectionStatus> {
  const normalized = withNormalizedSpreadsheetId(params);
  return safeInvoke<GoogleSheetsConnectionStatus>('test_google_sheets_connection', {
    spreadsheetId: normalized.spreadsheetId,
    serviceAccountJson: normalized.serviceAccountJson,
  });
}

/**
 * Fetch and normalize Accounts graph dataset:
 * - IDENTITIES
 * - LINKS
 * - ACCOUNT_LINKS
 * - PROFILE_LINKS
 * - AUTH_METHODS
 * - ACCOUNT_AUTH_LINKS
 * - any SVC_* sheets
 */
export async function fetchGoogleSheetsDataset(
  params: GoogleSheetsParams
): Promise<AccountsGraphDataset> {
  const normalized = withNormalizedSpreadsheetId(params);
  return safeInvoke<AccountsGraphDataset>('fetch_google_sheets_dataset', {
    spreadsheetId: normalized.spreadsheetId,
    serviceAccountJson: normalized.serviceAccountJson,
  });
}

/**
 * Initialize/repair required schema sheets and headers.
 */
export async function initGoogleSheetsSchema(
  params: GoogleSheetsParams
): Promise<GoogleSheetsConnectionStatus> {
  const normalized = withNormalizedSpreadsheetId(params);
  return safeInvoke<GoogleSheetsConnectionStatus>('init_google_sheets_schema', {
    spreadsheetId: normalized.spreadsheetId,
    serviceAccountJson: normalized.serviceAccountJson,
  });
}

/**
 * Upsert a LINK row in LINKS sheet.
 * Accepts normalized key/value pairs for the row.
 */
export async function upsertGoogleSheetsLink(params: {
  spreadsheetId: string;
  serviceAccountJson: string;
  link: Array<{ key: string; value: string }>;
}): Promise<Array<{ key: string; value: string }>> {
  const normalized = withNormalizedSpreadsheetId(params);
  return safeInvoke('upsert_google_sheets_link', normalized);
}

/** Soft-delete a link by link_id. */
export async function deleteGoogleSheetsLink(params: {
  spreadsheetId: string;
  serviceAccountJson: string;
  linkId: string;
}): Promise<boolean> {
  const normalized = withNormalizedSpreadsheetId(params);
  return safeInvoke<boolean>('delete_google_sheets_link', normalized);
}

/** Upsert relation row in ACCOUNT_LINKS sheet. */
export async function upsertGoogleSheetsAccountLink(params: {
  spreadsheetId: string;
  serviceAccountJson: string;
  link: Array<{ key: string; value: string }>;
}): Promise<Array<{ key: string; value: string }>> {
  const normalized = withNormalizedSpreadsheetId(params);
  return safeInvoke('upsert_google_sheets_account_link', normalized);
}

/** Soft-delete account link by account_link_id. */
export async function deleteGoogleSheetsAccountLink(params: {
  spreadsheetId: string;
  serviceAccountJson: string;
  accountLinkId: string;
}): Promise<boolean> {
  const normalized = withNormalizedSpreadsheetId(params);
  return safeInvoke<boolean>('delete_google_sheets_account_link', normalized);
}

/** Upsert relation row in PROFILE_LINKS sheet. */
export async function upsertGoogleSheetsProfileLink(params: {
  spreadsheetId: string;
  serviceAccountJson: string;
  link: Array<{ key: string; value: string }>;
}): Promise<Array<{ key: string; value: string }>> {
  const normalized = withNormalizedSpreadsheetId(params);
  return safeInvoke('upsert_google_sheets_profile_link', normalized);
}

/** Soft-delete profile link by profile_link_id. */
export async function deleteGoogleSheetsProfileLink(params: {
  spreadsheetId: string;
  serviceAccountJson: string;
  profileLinkId: string;
}): Promise<boolean> {
  const normalized = withNormalizedSpreadsheetId(params);
  return safeInvoke<boolean>('delete_google_sheets_profile_link', normalized);
}

/** Upsert auth method row in AUTH_METHODS sheet. */
export async function upsertGoogleSheetsAuthMethod(params: {
  spreadsheetId: string;
  serviceAccountJson: string;
  method: Array<{ key: string; value: string }>;
}): Promise<Array<{ key: string; value: string }>> {
  const normalized = withNormalizedSpreadsheetId(params);
  return safeInvoke('upsert_google_sheets_auth_method', normalized);
}

/** Soft-delete auth method by auth_method_id. */
export async function deleteGoogleSheetsAuthMethod(params: {
  spreadsheetId: string;
  serviceAccountJson: string;
  authMethodId: string;
}): Promise<boolean> {
  const normalized = withNormalizedSpreadsheetId(params);
  return safeInvoke<boolean>('delete_google_sheets_auth_method', normalized);
}

/** Upsert account-auth relation in ACCOUNT_AUTH_LINKS sheet. */
export async function upsertGoogleSheetsAccountAuthLink(params: {
  spreadsheetId: string;
  serviceAccountJson: string;
  link: Array<{ key: string; value: string }>;
}): Promise<Array<{ key: string; value: string }>> {
  const normalized = withNormalizedSpreadsheetId(params);
  return safeInvoke('upsert_google_sheets_account_auth_link', normalized);
}

/** Soft-delete account auth link by account_auth_link_id. */
export async function deleteGoogleSheetsAccountAuthLink(params: {
  spreadsheetId: string;
  serviceAccountJson: string;
  accountAuthLinkId: string;
}): Promise<boolean> {
  const normalized = withNormalizedSpreadsheetId(params);
  return safeInvoke<boolean>('delete_google_sheets_account_auth_link', normalized);
}

// ============================================
// Google OAuth (user-account flow)
// ============================================

export interface GoogleOAuthStartResponse {
  authUrl: string;
  state: string;
  port?: number;
}

export interface GoogleOAuthStatus {
  connected: boolean;
  email: string | null;
}

export interface GoogleOAuthCallbackResult {
  received: boolean;
  success: boolean;
  email: string | null;
}

/**
 * Start Google OAuth flow. Returns auth_url to open in a popup and state
 * for CSRF validation (handled by the backend callback).
 */
export async function startGoogleOAuth(): Promise<GoogleOAuthStartResponse> {
  return safeInvoke<GoogleOAuthStartResponse>('start_google_oauth', {});
}

/**
 * Remove stored Google OAuth tokens. Returns success flag.
 */
export async function disconnectGoogleOAuth(): Promise<{ success: boolean }> {
  return safeInvoke<{ success: boolean }>('disconnect_google_oauth', {});
}

/**
 * Check current Google OAuth status. Used for initial mount load and
 * for polling during the OAuth popup flow.
 */
export async function getGoogleOAuthStatus(): Promise<GoogleOAuthStatus> {
  return safeInvoke<GoogleOAuthStatus>('get_google_oauth_status', {});
}

/**
 * Check if loopback server received OAuth callback.
 * Used for polling during the OAuth popup flow.
 */
export async function checkGoogleOAuthCallback(state: string): Promise<GoogleOAuthCallbackResult> {
  return safeInvoke<GoogleOAuthCallbackResult>('check_google_oauth_callback', { state });
}
