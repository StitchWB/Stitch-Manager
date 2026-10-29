import type {
  EmailFolder,
  EmailInboxProfile,
  EmailInboxSyncStatus,
  EmailMailboxSession,
  EmailMessage,
  EmailProviderCatalogItem,
  EmailProviderType,
  ProviderCapabilities,
} from '@/lib/backend/modules/emailInbox';
import type { MailboxProfileDraft } from '@/lib/mail/sources/types';

export interface MailQueryFilters {
  from: string;
  to: string;
  subjectContains: string;
  bodyContains: string;
  search: string;
  unreadOnly: boolean;
  since: string;
  limit: number;
}

export interface MailSyncControls {
  timeoutMs: number;
  pollIntervalMs: number;
  dedupeKey: string;
}

export interface MailImapCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
  useTls: boolean;
}

export interface MailTmCredentials {
  address: string;
  password: string;
  baseUrl: string;
}

export interface MailProfileSyncState {
  profileId: string;
  status: EmailInboxSyncStatus;
  lastSyncAt?: string | null;
  lastError?: string | null;
  cursor?: string | null;
  updatedAt: string;
}

export const DEFAULT_QUERY: MailQueryFilters = {
  from: '',
  to: '',
  subjectContains: '',
  bodyContains: '',
  search: '',
  unreadOnly: false,
  since: '',
  limit: 50,
};

export const DEFAULT_SYNC: MailSyncControls = {
  timeoutMs: 120000,
  pollIntervalMs: 3000,
  dedupeKey: 'mail-page',
};

export const DEFAULT_IMAP: MailImapCredentials = {
  host: '',
  port: 993,
  username: '',
  password: '',
  useTls: true,
};

export const DEFAULT_MAIL_TM: MailTmCredentials = {
  address: '',
  password: '',
  baseUrl: '',
};

export interface ConnectionSlice {
  source: EmailProviderType;
  accountId: string;
  mailbox: string;
  imapCredentials: MailImapCredentials;
  mailTmCredentials: MailTmCredentials;
  query: MailQueryFilters;
  sync: MailSyncControls;
  error: string | null;

  setSource: (source: EmailProviderType) => void;
  setAccountId: (accountId: string) => void;
  setMailbox: (mailbox: string) => void;
  setImapCredentials: (patch: Partial<MailImapCredentials>) => void;
  setMailTmCredentials: (patch: Partial<MailTmCredentials>) => void;
  setQuery: (patch: Partial<MailQueryFilters>) => void;
  setSync: (patch: Partial<MailSyncControls>) => void;
  applyDraft: (draft: MailboxProfileDraft) => void;
  clearError: () => void;
}

export interface SessionSlice {
  availableFolders: EmailFolder[];
  selectedFolder: EmailFolder | null;
  connectedMailbox: string | null;
  session: EmailMailboxSession | null;
  capabilities: ProviderCapabilities | null;
  isConnecting: boolean;

  loadFolders: () => Promise<void>;
  selectFolder: (folder: EmailFolder | null) => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export interface MessagesSlice {
  messages: EmailMessage[];
  /** Per-profile message cache so switching back restores messages instantly. */
  messagesByProfile: Record<string, EmailMessage[]>;
  selectedMessageId: string | null;
  lastSyncAt: number | null;
  isSyncing: boolean;
  isWaiting: boolean;
  isMutating: boolean;
  isLoadingMessage: boolean;
  /** Scoped error for a single message fetch (e.g. a stale/deleted UID), shown next to that message only. */
  messageLoadError: string | null;

  selectMessage: (messageId: string | null) => void;
  listMessages: () => Promise<void>;
  waitForMessage: () => Promise<void>;
  loadMessageById: (messageId: string) => Promise<void>;
  markAsRead: (messageId: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  clearMessageLoadError: () => void;
}

export interface ProfilesSlice {
  profiles: EmailInboxProfile[];
  activeProfileId: string | null;
  profileSyncMap: Record<string, MailProfileSyncState>;
  providerCatalog: EmailProviderCatalogItem[];
  isProfilesLoading: boolean;
  isProfileSaving: boolean;
  isProfileMutating: boolean;

  setActiveProfileId: (profileId: string | null) => void;
  /** Create a random Mail.tm account, persist it as a profile, and select it. */
  registerMailTmMailbox: () => Promise<EmailInboxProfile | null>;
  loadProfiles: () => Promise<void>;
  loadProviderCatalog: () => Promise<void>;
  loadProfileSyncState: (profileId: string) => Promise<void>;
  renameProfile: (profileId: string, nextLabel: string) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
  upsertProfileFromDraft: (draft: MailboxProfileDraft) => Promise<void>;
  saveCurrentSessionAsProfile: (label?: string) => Promise<void>;
}

export interface MailState extends ConnectionSlice, SessionSlice, MessagesSlice, ProfilesSlice {}
