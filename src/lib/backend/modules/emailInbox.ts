import { safeInvoke } from '../core/invoke';

export type EmailProviderType = 'imap' | 'mail_tm';

export interface ImapConnectCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
  useTls?: boolean;
}

export interface MailTmConnectCredentials {
  address: string;
  password: string;
  baseUrl?: string | null;
}

export type EmailConnectCredentials =
  | { type: 'imap'; value: ImapConnectCredentials }
  | { type: 'mail_tm'; value: MailTmConnectCredentials };

export interface EmailConnectOptions {
  mailbox?: string | null;
  readOnly?: boolean;
}

export interface EmailConnectInput {
  provider: EmailProviderType;
  accountId: string;
  credentials: EmailConnectCredentials;
  options?: EmailConnectOptions | null;
}

export interface ProviderCapabilities {
  canDelete: boolean;
  canMarkAsRead: boolean;
  canSearchBody: boolean;
  canDownloadAttachments: boolean;
  canListFolders: boolean;
}

export type EmailFolderKind =
  | 'inbox'
  | 'sent'
  | 'drafts'
  | 'trash'
  | 'spam'
  | 'archive'
  | 'all'
  | 'folder';

export interface EmailFolder {
  id: string;
  path: string;
  name: string;
  kind: EmailFolderKind;
  delimiter?: string | null;
}

export interface EmailMailboxSession {
  sessionId: string;
  provider: EmailProviderType;
  accountId: string;
  capabilities: ProviderCapabilities;
  connectedAt: string;
}

export interface EmailAddress {
  name?: string | null;
  email: string;
}

export interface EmailAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface EmailMessage {
  id: string;
  providerMessageId: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  subject: string;
  text?: string | null;
  html?: string | null;
  headers: Record<string, string>;
  attachments: EmailAttachment[];
  isRead: boolean;
  receivedAt: string;
}

export interface EmailQuery {
  from?: string | null;
  to?: string | null;
  subjectContains?: string | null;
  bodyContains?: string | null;
  search?: string | null;
  unreadOnly?: boolean | null;
  since?: string | null;
  limit?: number | null;
}

export interface WaitForEmailOptions {
  timeoutMs?: number | null;
  pollIntervalMs?: number | null;
  dedupeKey?: string | null;
}

export interface EmailServiceError {
  code:
    | 'AUTH_FAILED'
    | 'PROVIDER_UNAVAILABLE'
    | 'RATE_LIMITED'
    | 'EMAIL_NOT_FOUND_TIMEOUT'
    | 'UNSUPPORTED_CAPABILITY'
    | 'INVALID_QUERY'
    | 'SESSION_NOT_FOUND'
    | 'PROFILE_NOT_FOUND'
    | 'INTERNAL_ERROR';
  message: string;
  retryable: boolean;
}

export interface EmailProviderCatalogItem {
  provider: EmailProviderType;
  displayName: string;
  available: boolean;
  capabilities: ProviderCapabilities;
  supportsProfileConnect: boolean;
}

export interface EmailInboxProfile {
  id: string;
  label: string;
  provider: EmailProviderType;
  accountId: string;
  connectInput: EmailConnectInput;
  createdAt: string;
  updatedAt: string;
  /** Per-user ownership flags (absent for guests / legacy shared rows). */
  mine?: boolean;
  shared?: boolean;
}

export interface EmailInboxProfileUpsertInput {
  id?: string | null;
  label?: string | null;
  connectInput: EmailConnectInput;
}

export type EmailInboxSyncStatus = 'idle' | 'syncing' | 'error';

export interface EmailInboxSyncState {
  profileId: string;
  status: EmailInboxSyncStatus;
  lastSyncAt?: string | null;
  lastError?: string | null;
  cursor?: string | null;
  updatedAt: string;
}

export interface EmailInboxSyncStateUpsertInput {
  profileId: string;
  status: EmailInboxSyncStatus;
  lastSyncAt?: string | null;
  lastError?: string | null;
  cursor?: string | null;
}

export async function emailInboxConnect(input: EmailConnectInput): Promise<EmailMailboxSession> {
  return safeInvoke<EmailMailboxSession>('email_inbox_connect', { input });
}

export async function emailInboxDisconnect(sessionId: string): Promise<void> {
  return safeInvoke<void>('email_inbox_disconnect', { sessionId });
}

export async function emailInboxList(
  sessionId: string,
  query?: EmailQuery
): Promise<EmailMessage[]> {
  return safeInvoke<EmailMessage[]>('email_inbox_list', { sessionId, query });
}

export async function emailInboxListFolders(sessionId: string): Promise<EmailFolder[]> {
  return safeInvoke<EmailFolder[]>('email_inbox_list_folders', { sessionId });
}

export async function emailInboxGetById(
  sessionId: string,
  messageId: string
): Promise<EmailMessage | null> {
  return safeInvoke<EmailMessage | null>('email_inbox_get_by_id', { sessionId, messageId });
}

export async function emailInboxWaitForEmail(
  sessionId: string,
  query: EmailQuery,
  options?: WaitForEmailOptions
): Promise<EmailMessage> {
  return safeInvoke<EmailMessage>('email_inbox_wait_for_email', { sessionId, query, options });
}

export async function emailInboxMarkAsRead(sessionId: string, messageId: string): Promise<void> {
  return safeInvoke<void>('email_inbox_mark_as_read', { sessionId, messageId });
}

export async function emailInboxDelete(sessionId: string, messageId: string): Promise<void> {
  return safeInvoke<void>('email_inbox_delete', { sessionId, messageId });
}

export async function emailInboxGetCapabilities(sessionId: string): Promise<ProviderCapabilities> {
  return safeInvoke<ProviderCapabilities>('email_inbox_get_capabilities', { sessionId });
}

export async function emailInboxGetProviderCatalog(): Promise<EmailProviderCatalogItem[]> {
  return safeInvoke<EmailProviderCatalogItem[]>('email_inbox_get_provider_catalog');
}

export async function emailInboxListProfiles(): Promise<EmailInboxProfile[]> {
  return safeInvoke<EmailInboxProfile[]>('email_inbox_list_profiles');
}

export async function emailInboxUpsertProfile(
  input: EmailInboxProfileUpsertInput
): Promise<EmailInboxProfile> {
  return safeInvoke<EmailInboxProfile>('email_inbox_upsert_profile', { input });
}

export async function emailInboxDeleteProfile(profileId: string): Promise<boolean> {
  return safeInvoke<boolean>('email_inbox_delete_profile', { profileId });
}

export async function emailInboxConnectProfile(profileId: string): Promise<EmailMailboxSession> {
  return safeInvoke<EmailMailboxSession>('email_inbox_connect_profile', { profileId });
}

export interface MailTmAccountCredentials {
  address: string;
  password: string;
  baseUrl: string;
}

export async function emailInboxCreateMailTmAccount(
  baseUrl?: string
): Promise<MailTmAccountCredentials> {
  return safeInvoke<MailTmAccountCredentials>('email_inbox_create_mailtm_account', { baseUrl });
}

export async function emailInboxGetSyncState(
  profileId: string
): Promise<EmailInboxSyncState | null> {
  return safeInvoke<EmailInboxSyncState | null>('email_inbox_get_sync_state', { profileId });
}

export async function emailInboxUpsertSyncState(
  input: EmailInboxSyncStateUpsertInput
): Promise<EmailInboxSyncState> {
  return safeInvoke<EmailInboxSyncState>('email_inbox_upsert_sync_state', { input });
}

export async function claimEmailInboxProfile(id: string): Promise<{ success: boolean }> {
  return safeInvoke<{ success: boolean }>('claim_email_inbox_profile', { id });
}
