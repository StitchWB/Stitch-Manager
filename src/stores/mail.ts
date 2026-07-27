import { create } from 'zustand';
import {
  type EmailConnectInput,
  emailInboxConnect,
  emailInboxConnectProfile,
  emailInboxCreateMailTmAccount,
  emailInboxDeleteProfile,
  emailInboxDelete,
  emailInboxDisconnect,
  emailInboxGetById,
  emailInboxGetCapabilities,
  emailInboxGetProviderCatalog,
  emailInboxListFolders,
  emailInboxGetSyncState,
  emailInboxListProfiles,
  emailInboxList,
  emailInboxMarkAsRead,
  emailInboxUpsertProfile,
  emailInboxUpsertSyncState,
  emailInboxWaitForEmail,
  type EmailFolder,
  type EmailInboxProfile,
  type EmailInboxSyncState,
  type EmailInboxSyncStatus,
  type EmailMailboxSession,
  type EmailMessage,
  type EmailProviderCatalogItem,
  type EmailProviderType,
  type ProviderCapabilities,
} from '@/lib/tauri/modules/emailInbox';
import type { MailboxProfileDraft } from '@/lib/mail/sources/types';
import {
  buildEmailQuery,
  buildImapConnectInput,
  buildMailTmConnectInput,
  buildWaitForEmailOptions,
  markMessageAsReadLocal,
  removeMessageLocal,
  upsertMessageById,
} from '@/lib/mail/runtime';
import { t } from '@/lib/i18n';

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

interface MailState {
  source: EmailProviderType;
  accountId: string;
  mailbox: string;
  imapCredentials: MailImapCredentials;
  mailTmCredentials: MailTmCredentials;

  availableFolders: EmailFolder[];
  selectedFolder: EmailFolder | null;
  connectedMailbox: string | null;

  session: EmailMailboxSession | null;
  capabilities: ProviderCapabilities | null;
  messages: EmailMessage[];
  /** Per-profile message cache so switching back restores messages instantly. */
  messagesByProfile: Record<string, EmailMessage[]>;
  selectedMessageId: string | null;
  query: MailQueryFilters;
  sync: MailSyncControls;
  lastSyncAt: number | null;

  isConnecting: boolean;
  isSyncing: boolean;
  isWaiting: boolean;
  isMutating: boolean;
  isLoadingMessage: boolean;
  error: string | null;
  /**
   * Scoped error for a single message fetch (e.g. a stale/deleted UID).
   * Surfaced next to the message instead of a page-wide banner.
   */
  messageLoadError: string | null;

  profiles: EmailInboxProfile[];
  activeProfileId: string | null;
  profileSyncMap: Record<string, MailProfileSyncState>;
  providerCatalog: EmailProviderCatalogItem[];
  isProfilesLoading: boolean;
  isProfileSaving: boolean;
  isProfileMutating: boolean;

  setSource: (source: EmailProviderType) => void;
  setAccountId: (accountId: string) => void;
  setMailbox: (mailbox: string) => void;
  setImapCredentials: (patch: Partial<MailImapCredentials>) => void;
  setMailTmCredentials: (patch: Partial<MailTmCredentials>) => void;
  setQuery: (patch: Partial<MailQueryFilters>) => void;
  setSync: (patch: Partial<MailSyncControls>) => void;
  selectMessage: (messageId: string | null) => void;
  loadFolders: () => Promise<void>;
  selectFolder: (folder: EmailFolder | null) => Promise<void>;
  applyDraft: (draft: MailboxProfileDraft) => void;
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
  clearError: () => void;
  clearMessageLoadError: () => void;

  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  listMessages: () => Promise<void>;
  waitForMessage: () => Promise<void>;
  loadMessageById: (messageId: string) => Promise<void>;
  markAsRead: (messageId: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
}

const DEFAULT_QUERY: MailQueryFilters = {
  from: '',
  to: '',
  subjectContains: '',
  bodyContains: '',
  search: '',
  unreadOnly: false,
  since: '',
  limit: 50,
};

const DEFAULT_SYNC: MailSyncControls = {
  timeoutMs: 120000,
  pollIntervalMs: 3000,
  dedupeKey: 'mail-page',
};

const DEFAULT_IMAP: MailImapCredentials = {
  host: '',
  port: 993,
  username: '',
  password: '',
  useTls: true,
};

const DEFAULT_MAIL_TM: MailTmCredentials = {
  address: '',
  password: '',
  baseUrl: '',
};

const FOLDER_RECONNECT_DEBOUNCE_MS = 220;

let folderReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let listRequestToken = 0;
let waitRequestToken = 0;
let connectRetriedFor: string | null = null;

function clearFolderReconnectTimer(): void {
  if (folderReconnectTimer) {
    clearTimeout(folderReconnectTimer);
    folderReconnectTimer = null;
  }
}

function scheduleFolderReconnect(task: () => Promise<void>): void {
  clearFolderReconnectTimer();
  folderReconnectTimer = setTimeout(() => {
    folderReconnectTimer = null;
    void task();
  }, FOLDER_RECONNECT_DEBOUNCE_MS);
}

function invalidateListAndWaitTokens(): void {
  listRequestToken += 1;
  waitRequestToken += 1;
}

function nextListToken(): number {
  listRequestToken += 1;
  return listRequestToken;
}

function nextWaitToken(): number {
  waitRequestToken += 1;
  return waitRequestToken;
}

function normalizeMailboxPath(value: string): string {
  return value.trim();
}

function resolveEffectiveMailbox(state: {
  mailbox: string;
  selectedFolder: EmailFolder | null;
}): string {
  return normalizeMailboxPath(state.selectedFolder?.path ?? state.mailbox);
}

async function ensureSelectedFolderSession(get: () => MailState): Promise<void> {
  const state = get();
  if (!state.session) return;
  if (state.source !== 'imap') return;

  const desiredMailbox = resolveEffectiveMailbox(state);
  const connectedMailboxRaw = state.connectedMailbox;

  if (connectedMailboxRaw == null) {
    if (!state.selectedFolder) {
      return;
    }

    await state.connect();
    return;
  }

  const connectedMailbox = normalizeMailboxPath(connectedMailboxRaw);

  if (connectedMailbox.toLowerCase() === desiredMailbox.toLowerCase()) {
    return;
  }

  await state.connect();
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Backend keeps sessions in memory — a restart invalidates every session id. */
function isSessionLostError(error: unknown): boolean {
  return toErrorMessage(error).includes('Session not found');
}

/**
 * Drop the dead session and reconnect via the active profile.
 * Silent recovery: no error banner, auto-list refires on the new session.
 */
function recoverFromLostSession(): void {
  const { activeProfileId, isConnecting } = useMailStore.getState();
  useMailStore.setState({ session: null, capabilities: null, connectedMailbox: null });
  if (activeProfileId && !isConnecting) {
    void useMailStore.getState().connect();
  }
}

function normalizeProfileLabel(label: string): string {
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : 'Mailbox profile';
}

function toMailProfileSyncState(syncState: EmailInboxSyncState): MailProfileSyncState {
  return {
    profileId: syncState.profileId,
    status: syncState.status,
    lastSyncAt: syncState.lastSyncAt ?? null,
    lastError: syncState.lastError ?? null,
    cursor: syncState.cursor ?? null,
    updatedAt: syncState.updatedAt,
  };
}

function deriveStateFromConnectInput(
  connectInput: EmailConnectInput,
  mailboxFallback = 'INBOX'
): Pick<MailState, 'source' | 'accountId' | 'mailbox' | 'imapCredentials' | 'mailTmCredentials'> {
  if (connectInput.provider === 'imap' && connectInput.credentials.type === 'imap') {
    return {
      source: 'imap',
      accountId: connectInput.accountId,
      mailbox: connectInput.options?.mailbox || mailboxFallback,
      imapCredentials: {
        host: connectInput.credentials.value.host,
        port: connectInput.credentials.value.port,
        username: connectInput.credentials.value.username,
        password: connectInput.credentials.value.password,
        useTls: connectInput.credentials.value.useTls ?? true,
      },
      mailTmCredentials: DEFAULT_MAIL_TM,
    };
  }

  if (connectInput.provider === 'mail_tm' && connectInput.credentials.type === 'mail_tm') {
    return {
      source: 'mail_tm',
      accountId: connectInput.accountId,
      mailbox: 'INBOX',
      imapCredentials: DEFAULT_IMAP,
      mailTmCredentials: {
        address: connectInput.credentials.value.address,
        password: connectInput.credentials.value.password,
        baseUrl: connectInput.credentials.value.baseUrl ?? '',
      },
    };
  }

  return {
    source: 'imap',
    accountId: connectInput.accountId,
    mailbox: mailboxFallback,
    imapCredentials: DEFAULT_IMAP,
    mailTmCredentials: DEFAULT_MAIL_TM,
  };
}

export const useMailStore = create<MailState>((set, get) => ({
  source: 'imap',
  accountId: '',
  mailbox: 'INBOX',
  imapCredentials: DEFAULT_IMAP,
  mailTmCredentials: DEFAULT_MAIL_TM,

  availableFolders: [],
  selectedFolder: null,
  connectedMailbox: null,

  session: null,
  capabilities: null,
  messages: [],
  messagesByProfile: {},
  selectedMessageId: null,
  query: DEFAULT_QUERY,
  sync: DEFAULT_SYNC,
  lastSyncAt: null,

  isConnecting: false,
  isSyncing: false,
  isWaiting: false,
  isMutating: false,
  isLoadingMessage: false,
  error: null,
  messageLoadError: null,

  profiles: [],
  activeProfileId: null,
  profileSyncMap: {},
  providerCatalog: [],
  isProfilesLoading: false,
  isProfileSaving: false,
  isProfileMutating: false,

  setSource: source => set({ source }),
  setAccountId: accountId => set({ accountId }),
  setMailbox: mailbox =>
    set(state => {
      const normalized = normalizeMailboxPath(mailbox);
      const matched = state.availableFolders.find(
        folder => folder.path.trim().toLowerCase() === normalized.toLowerCase()
      );

      return {
        mailbox: normalized,
        selectedFolder: matched ?? null,
      };
    }),
  setImapCredentials: patch =>
    set(state => ({
      imapCredentials: {
        ...state.imapCredentials,
        ...patch,
      },
    })),
  setMailTmCredentials: patch =>
    set(state => ({
      mailTmCredentials: {
        ...state.mailTmCredentials,
        ...patch,
      },
    })),
  setQuery: patch =>
    set(state => ({
      query: {
        ...state.query,
        ...patch,
      },
    })),
  setSync: patch =>
    set(state => ({
      sync: {
        ...state.sync,
        ...patch,
      },
    })),
  selectMessage: messageId => set({ selectedMessageId: messageId }),
  loadFolders: async () => {
    const { session, capabilities, source } = get();
    if (!session) {
      set({ availableFolders: [], selectedFolder: null });
      return;
    }

    if (!capabilities?.canListFolders || source !== 'imap') {
      set({ availableFolders: [], selectedFolder: null });
      return;
    }

    try {
      const folders = await emailInboxListFolders(session.sessionId);

      set(state => {
        const effectiveMailbox = resolveEffectiveMailbox(state);
        const nextSelectedByExisting = state.selectedFolder
          ? (folders.find(folder => folder.id === state.selectedFolder?.id) ??
            folders.find(
              folder =>
                folder.path.trim().toLowerCase() === state.selectedFolder?.path.trim().toLowerCase()
            ))
          : null;

        const nextSelectedByMailbox = effectiveMailbox
          ? folders.find(
            folder => folder.path.trim().toLowerCase() === effectiveMailbox.toLowerCase()
          )
          : null;

        const inboxFolder =
          folders.find(folder => folder.kind === 'inbox') ??
          folders.find(folder => folder.path.trim().toLowerCase() === 'inbox') ??
          null;

        return {
          availableFolders: folders,
          selectedFolder:
            nextSelectedByExisting ?? nextSelectedByMailbox ?? inboxFolder ?? folders[0] ?? null,
        };
      });
    } catch (error) {
      if (isSessionLostError(error)) {
        recoverFromLostSession();
        return;
      }
      set({ error: toErrorMessage(error) });
    }
  },
  selectFolder: async folder => {
    const current = get();
    const targetMailbox = folder ? normalizeMailboxPath(folder.path) : null;

    clearFolderReconnectTimer();
    invalidateListAndWaitTokens();

    set({
      selectedFolder: folder,
      mailbox:
        folder && !current.activeProfileId && targetMailbox ? targetMailbox : current.mailbox,
      isSyncing: false,
      isWaiting: false,
      error: null,
    });

    const next = get();
    if (!next.session || next.isConnecting || next.source !== 'imap' || !folder) {
      return;
    }

    const connectedMailbox = normalizeMailboxPath(next.connectedMailbox ?? '');
    if (
      targetMailbox &&
      connectedMailbox &&
      connectedMailbox.toLowerCase() === targetMailbox.toLowerCase()
    ) {
      return;
    }

    scheduleFolderReconnect(async () => {
      const latest = get();
      if (!latest.session || latest.isConnecting || latest.source !== 'imap') {
        return;
      }

      const latestSelected = latest.selectedFolder;
      if (!latestSelected) {
        return;
      }

      const latestTarget = normalizeMailboxPath(latestSelected.path);
      const latestConnected = normalizeMailboxPath(latest.connectedMailbox ?? '');

      if (latestConnected && latestConnected.toLowerCase() === latestTarget.toLowerCase()) {
        return;
      }

      await latest.connect();
    });
  },
  setActiveProfileId: profileId => {
    clearFolderReconnectTimer();
    invalidateListAndWaitTokens();

    set(state => {
      if (!profileId) {
        return {
          activeProfileId: null,
          availableFolders: [],
          selectedFolder: null,
          connectedMailbox: null,
          messages: [],
          selectedMessageId: null,
          isSyncing: false,
          isWaiting: false,
        };
      }

      const profile = state.profiles.find(item => item.id === profileId);
      if (!profile) {
        return {
          activeProfileId: profileId,
          messages: [],
          selectedMessageId: null,
          isSyncing: false,
          isWaiting: false,
        };
      }

      return {
        activeProfileId: profileId,
        availableFolders: [],
        selectedFolder: null,
        connectedMailbox: null,
        messages: state.messagesByProfile[profileId] ?? [],
        selectedMessageId: null,
        isSyncing: false,
        isWaiting: false,
        ...deriveStateFromConnectInput(profile.connectInput),
      };
    });
  },
  applyDraft: draft => {
    set({
      ...deriveStateFromConnectInput(draft.connectInput, draft.mailbox || 'INBOX'),
      availableFolders: [],
      selectedFolder: null,
      connectedMailbox: null,
      error: null,
    });
  },
  registerMailTmMailbox: async () => {
    set({ isProfileSaving: true, error: null });

    try {
      const account = await emailInboxCreateMailTmAccount();
      const connectInput = buildMailTmConnectInput({
        accountId: `mailtm:${account.address}`,
        readOnly: true,
        credentials: {
          address: account.address,
          password: account.password,
          baseUrl: account.baseUrl,
        },
      });

      const profile = await emailInboxUpsertProfile({
        id: null,
        label: `Mail.tm · ${account.address}`,
        connectInput,
      });

      set(state => ({
        profiles: [profile, ...state.profiles],
        activeProfileId: profile.id,
        ...deriveStateFromConnectInput(profile.connectInput),
        availableFolders: [],
        selectedFolder: null,
        connectedMailbox: null,
      }));

      return profile;
    } catch (error) {
      set({ error: toErrorMessage(error) });
      return null;
    } finally {
      set({ isProfileSaving: false });
    }
  },
  loadProfiles: async () => {
    set({ isProfilesLoading: true, error: null });

    try {
      const profiles = await emailInboxListProfiles();

      const existingSyncMap = get().profileSyncMap;
      const profileSyncMap: Record<string, MailProfileSyncState> = {};
      profiles.forEach(profile => {
        const existing = existingSyncMap[profile.id];
        if (existing) {
          profileSyncMap[profile.id] = existing;
        }
      });

      set(state => ({
        ...(state.activeProfileId
          ? (() => {
            const active = profiles.find(profile => profile.id === state.activeProfileId);
            return active ? deriveStateFromConnectInput(active.connectInput) : {};
          })()
          : {}),
        profiles,
        profileSyncMap,
        activeProfileId:
          state.activeProfileId && profiles.some(profile => profile.id === state.activeProfileId)
            ? state.activeProfileId
            : (profiles[0]?.id ?? null),
      }));

      const profileIdsAtFetchStart = profiles.map(profile => profile.id);

      void (async () => {
        const syncResults = await Promise.allSettled(
          profileIdsAtFetchStart.map(async profileId => {
            const syncState = await emailInboxGetSyncState(profileId);
            return syncState ? ([profileId, toMailProfileSyncState(syncState)] as const) : null;
          })
        );

        set(state => {
          const currentProfileIds = new Set(state.profiles.map(profile => profile.id));
          const nextSyncMap: Record<string, MailProfileSyncState> = {};

          Object.entries(state.profileSyncMap).forEach(([profileId, syncState]) => {
            if (currentProfileIds.has(profileId)) {
              nextSyncMap[profileId] = syncState;
            }
          });

          syncResults.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
              const [profileId, syncState] = result.value;
              if (currentProfileIds.has(profileId)) {
                nextSyncMap[profileId] = syncState;
              }
            }
          });

          return { profileSyncMap: nextSyncMap };
        });
      })();

      void get().loadFolders();
    } catch (error) {
      set({ error: toErrorMessage(error) });
    } finally {
      set({ isProfilesLoading: false });
    }
  },
  loadProviderCatalog: async () => {
    try {
      const providerCatalog = await emailInboxGetProviderCatalog();
      set({ providerCatalog });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },
  upsertProfileFromDraft: async draft => {
    set({ isProfileSaving: true, error: null });

    try {
      const profile = await emailInboxUpsertProfile({
        id: null,
        label: draft.label,
        connectInput: draft.connectInput,
      });

      set(state => {
        const existing = state.profiles.find(item => item.id === profile.id);
        const profiles = existing
          ? state.profiles.map(item => (item.id === profile.id ? profile : item))
          : [profile, ...state.profiles];

        return {
          ...deriveStateFromConnectInput(profile.connectInput),
          availableFolders: [],
          selectedFolder: null,
          connectedMailbox: null,
          profiles,
          activeProfileId: profile.id,
        };
      });

      await get().loadProfileSyncState(profile.id);
    } catch (error) {
      set({ error: toErrorMessage(error) });
    } finally {
      set({ isProfileSaving: false });
    }
  },
  saveCurrentSessionAsProfile: async label => {
    const {
      source,
      accountId,
      mailbox,
      selectedFolder,
      imapCredentials,
      mailTmCredentials,
      profiles,
    } = get();

    const connectInput =
      source === 'imap'
        ? buildImapConnectInput({
          accountId,
          mailbox: resolveEffectiveMailbox({ mailbox, selectedFolder }),
          readOnly: true,
          credentials: imapCredentials,
        })
        : buildMailTmConnectInput({
          accountId,
          readOnly: true,
          credentials: mailTmCredentials,
        });

    const normalizedLabel = normalizeProfileLabel(
      label || `${source === 'imap' ? 'IMAP' : 'Mail.tm'} · ${accountId || 'session'}`
    );

    set({ isProfileSaving: true, error: null });

    try {
      const profile = await emailInboxUpsertProfile({
        id: null,
        label: normalizedLabel,
        connectInput,
      });

      set(state => {
        const existing = profiles.find(item => item.id === profile.id);
        const nextProfiles = existing
          ? state.profiles.map(item => (item.id === profile.id ? profile : item))
          : [profile, ...state.profiles];

        return {
          profiles: nextProfiles,
          activeProfileId: profile.id,
        };
      });

      await get().loadProfileSyncState(profile.id);
    } catch (error) {
      set({ error: toErrorMessage(error) });
    } finally {
      set({ isProfileSaving: false });
    }
  },
  loadProfileSyncState: async profileId => {
    if (!profileId) {
      return;
    }

    try {
      const syncState = await emailInboxGetSyncState(profileId);
      set(state => {
        if (!syncState) {
          const next = { ...state.profileSyncMap };
          delete next[profileId];
          return { profileSyncMap: next };
        }

        return {
          profileSyncMap: {
            ...state.profileSyncMap,
            [profileId]: toMailProfileSyncState(syncState),
          },
        };
      });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },
  renameProfile: async (profileId, nextLabel) => {
    const { profiles } = get();
    const profile = profiles.find(item => item.id === profileId);
    if (!profile) {
      return;
    }

    set({ isProfileMutating: true, error: null });

    try {
      const updated = await emailInboxUpsertProfile({
        id: profile.id,
        label: normalizeProfileLabel(nextLabel),
        connectInput: profile.connectInput,
      });

      set(state => ({
        profiles: state.profiles.map(item => (item.id === updated.id ? updated : item)),
      }));
    } catch (error) {
      set({ error: toErrorMessage(error) });
    } finally {
      set({ isProfileMutating: false });
    }
  },
  deleteProfile: async profileId => {
    set({ isProfileMutating: true, error: null });

    try {
      const deleted = await emailInboxDeleteProfile(profileId);
      if (!deleted) {
        return;
      }

      const current = get();
      if (current.session && current.activeProfileId === profileId) {
        await emailInboxDisconnect(current.session.sessionId);
      }

      set(state => {
        const profiles = state.profiles.filter(item => item.id !== profileId);
        const profileSyncMap = { ...state.profileSyncMap };
        delete profileSyncMap[profileId];

        const messagesByProfile = { ...state.messagesByProfile };
        delete messagesByProfile[profileId];

        const nextActiveProfileId =
          state.activeProfileId === profileId ? (profiles[0]?.id ?? null) : state.activeProfileId;

        return {
          profiles,
          profileSyncMap,
          messagesByProfile,
          activeProfileId: nextActiveProfileId,
          session: state.activeProfileId === profileId ? null : state.session,
          capabilities: state.activeProfileId === profileId ? null : state.capabilities,
          messages: state.activeProfileId === profileId ? [] : state.messages,
          selectedMessageId: state.activeProfileId === profileId ? null : state.selectedMessageId,
          availableFolders: state.activeProfileId === profileId ? [] : state.availableFolders,
          selectedFolder: state.activeProfileId === profileId ? null : state.selectedFolder,
          connectedMailbox: state.activeProfileId === profileId ? null : state.connectedMailbox,
        };
      });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    } finally {
      set({ isProfileMutating: false });
    }
  },
  clearError: () => set({ error: null }),
  clearMessageLoadError: () => set({ messageLoadError: null }),

  connect: async () => {
    const {
      source,
      accountId,
      mailbox,
      imapCredentials,
      mailTmCredentials,
      session,
      activeProfileId,
      selectedFolder,
    } = get();

    set({ isConnecting: true, isSyncing: false, isWaiting: false, error: null });

    try {
      clearFolderReconnectTimer();
      invalidateListAndWaitTokens();

      if (session) {
        try {
          await emailInboxDisconnect(session.sessionId);
        } catch (error) {
          // ponytail: old session already dead backend-side — proceed to fresh connect
          if (!isSessionLostError(error)) {
            throw error;
          }
        }
      }

      const nextMailbox =
        source === 'imap' ? resolveEffectiveMailbox({ mailbox, selectedFolder }) : '';

      const profileMailbox = normalizeMailboxPath(mailbox);
      const isImapProfile = Boolean(activeProfileId) && source === 'imap';
      const selectedMailbox = selectedFolder ? normalizeMailboxPath(selectedFolder.path) : '';
      const hasFolderOverride =
        isImapProfile &&
        Boolean(selectedFolder) &&
        selectedMailbox.toLowerCase() !== profileMailbox.toLowerCase();

      const nextSession = activeProfileId
        ? source === 'imap'
          ? hasFolderOverride
            ? await emailInboxConnect(
              buildImapConnectInput({
                accountId,
                mailbox: nextMailbox,
                readOnly: true,
                credentials: imapCredentials,
              })
            )
            : await emailInboxConnectProfile(activeProfileId)
          : await emailInboxConnectProfile(activeProfileId)
        : await emailInboxConnect(
          source === 'imap'
            ? buildImapConnectInput({
              accountId,
              mailbox: nextMailbox,
              readOnly: true,
              credentials: imapCredentials,
            })
            : buildMailTmConnectInput({
              accountId,
              readOnly: true,
              credentials: mailTmCredentials,
            })
        );

      const capabilities = await emailInboxGetCapabilities(nextSession.sessionId);

      connectRetriedFor = null;

      set({
        session: nextSession,
        capabilities,
        selectedMessageId: null,
        connectedMailbox: source === 'imap' ? nextMailbox : null,
        // Preserve cached messages instead of clearing — setActiveProfileId already
        // loaded them from messagesByProfile. The auto-list effect will refresh.
        messages: activeProfileId ? (get().messagesByProfile[activeProfileId] ?? []) : [],
      });

      void get().loadFolders();

      // Auto-save session as profile if no active profile exists
      if (!activeProfileId) {
        await get().saveCurrentSessionAsProfile();
        const afterSave = get();
        if (afterSave.error) {
          console.warn('Auto-save session as profile failed:', afterSave.error);
        }
      }
    } catch (error) {
      set({ error: toErrorMessage(error) });
      // ponytail: one delayed retry for backend cold-start races — the frontend
      // is interactive seconds before uvicorn accepts connections, and the
      // auto-connect memo in Mail.tsx would otherwise block any retry.
      const transient = /offline|refused|failed to fetch|networkerror|timed out/i.test(
        toErrorMessage(error)
      );
      const retryKey = `${activeProfileId ?? 'manual'}`;
      if (transient && connectRetriedFor !== retryKey) {
        connectRetriedFor = retryKey;
        setTimeout(() => {
          const s = get();
          if (!s.session && !s.isConnecting && s.activeProfileId === activeProfileId) {
            void s.connect();
          }
        }, 3000);
      }
    } finally {
      set({ isConnecting: false });
    }
  },

  disconnect: async () => {
    const { session } = get();
    if (!session) {
      return;
    }

    set({ isConnecting: true, isSyncing: false, isWaiting: false, error: null });

    try {
      clearFolderReconnectTimer();
      invalidateListAndWaitTokens();

      const { activeProfileId } = get();
      try {
        await emailInboxDisconnect(session.sessionId);
      } catch (error) {
        // ponytail: a dead session (backend restart) is already gone — treat as disconnected
        if (!isSessionLostError(error)) {
          throw error;
        }
      }
      set(state => ({
        session: null,
        capabilities: null,
        messages: [],
        selectedMessageId: null,
        availableFolders: [],
        selectedFolder: state.selectedFolder,
        connectedMailbox: null,
        messagesByProfile: activeProfileId
          ? { ...state.messagesByProfile, [activeProfileId]: [] }
          : state.messagesByProfile,
      }));
    } catch (error) {
      set({ error: toErrorMessage(error) });
    } finally {
      set({ isConnecting: false });
    }
  },

  listMessages: async () => {
    const initial = get();
    if (!initial.session) {
      return;
    }

    await ensureSelectedFolderSession(get);

    const { query, activeProfileId } = get();

    const requestToken = nextListToken();

    set({ isSyncing: true, error: null });

    try {
      const sessionId = get().session?.sessionId ?? initial.session.sessionId;
      const messages = await emailInboxList(sessionId, {
        ...buildEmailQuery(query),
      });

      if (requestToken !== listRequestToken) {
        return;
      }

      set(state => ({
        messages,
        lastSyncAt: Date.now(),
        messagesByProfile: activeProfileId
          ? { ...state.messagesByProfile, [activeProfileId]: messages }
          : state.messagesByProfile,
      }));

      if (activeProfileId) {
        const now = new Date().toISOString();
        const syncState = await emailInboxUpsertSyncState({
          profileId: activeProfileId,
          status: 'idle',
          lastSyncAt: now,
          lastError: null,
          cursor: null,
        });

        set(state => ({
          profileSyncMap: {
            ...state.profileSyncMap,
            [activeProfileId]: toMailProfileSyncState(syncState),
          },
        }));
      }
    } catch (error) {
      if (requestToken !== listRequestToken) {
        return;
      }

      if (isSessionLostError(error)) {
        recoverFromLostSession();
        return;
      }

      set({ error: toErrorMessage(error) });

      if (activeProfileId) {
        try {
          const syncState = await emailInboxUpsertSyncState({
            profileId: activeProfileId,
            status: 'error',
            lastError: toErrorMessage(error),
            lastSyncAt: null,
            cursor: null,
          });

          set(state => ({
            profileSyncMap: {
              ...state.profileSyncMap,
              [activeProfileId]: toMailProfileSyncState(syncState),
            },
          }));
        } catch {
          // Ignore sync-state persistence errors to keep primary flow stable.
        }
      }
    } finally {
      if (requestToken === listRequestToken) {
        set({ isSyncing: false });
      }
    }
  },

  waitForMessage: async () => {
    const initial = get();
    if (!initial.session) {
      return;
    }

    await ensureSelectedFolderSession(get);

    const { query, sync, activeProfileId } = get();

    const requestToken = nextWaitToken();

    set({ isWaiting: true, error: null });

    try {
      const sessionId = get().session?.sessionId ?? initial.session.sessionId;
      const message = await emailInboxWaitForEmail(
        sessionId,
        buildEmailQuery(query),
        buildWaitForEmailOptions(sync)
      );

      if (requestToken !== waitRequestToken) {
        return;
      }

      set(state => ({
        messages: upsertMessageById(state.messages, message),
        selectedMessageId: message.id,
        lastSyncAt: Date.now(),
      }));

      if (activeProfileId) {
        const now = new Date().toISOString();
        try {
          const syncState = await emailInboxUpsertSyncState({
            profileId: activeProfileId,
            status: 'idle',
            lastSyncAt: now,
            lastError: null,
            cursor: message.providerMessageId,
          });

          set(state => ({
            profileSyncMap: {
              ...state.profileSyncMap,
              [activeProfileId]: toMailProfileSyncState(syncState),
            },
          }));
        } catch {
          // Ignore sync-state persistence errors to keep primary flow stable.
        }
      }
    } catch (error) {
      if (requestToken !== waitRequestToken) {
        return;
      }

      if (isSessionLostError(error)) {
        recoverFromLostSession();
        return;
      }

      set({ error: toErrorMessage(error) });

      if (activeProfileId) {
        try {
          const syncState = await emailInboxUpsertSyncState({
            profileId: activeProfileId,
            status: 'error',
            lastError: toErrorMessage(error),
            lastSyncAt: null,
            cursor: null,
          });

          set(state => ({
            profileSyncMap: {
              ...state.profileSyncMap,
              [activeProfileId]: toMailProfileSyncState(syncState),
            },
          }));
        } catch {
          // Ignore sync-state persistence errors to keep primary flow stable.
        }
      }
    } finally {
      if (requestToken === waitRequestToken) {
        set({ isWaiting: false });
      }
    }
  },

  loadMessageById: async messageId => {
    const { session } = get();
    if (!session) {
      set({ messageLoadError: t('mail.errorNoActiveSession') });
      return;
    }

    set({ isLoadingMessage: true, messageLoadError: null, selectedMessageId: messageId });

    try {
      const loaded = await emailInboxGetById(session.sessionId, messageId);
      if (!loaded) {
        set({ messageLoadError: t('mail.errorMessageNotFound') });
        return;
      }

      set(state => ({
        messages: state.messages.map(item => (item.id === loaded.id ? loaded : item)),
      }));
    } catch (error) {
      if (isSessionLostError(error)) {
        recoverFromLostSession();
        return;
      }
      // Single-message fetch errors (e.g. a stale/deleted UID) should not
      // block the whole mail workspace with a page-wide banner - surface
      // them scoped to this message instead.
      set({ messageLoadError: toErrorMessage(error) });
    } finally {
      set({ isLoadingMessage: false });
    }
  },

  markAsRead: async messageId => {
    const { session, capabilities } = get();
    if (!session || !capabilities?.canMarkAsRead) {
      return;
    }

    set({ isMutating: true, error: null });

    try {
      await emailInboxMarkAsRead(session.sessionId, messageId);
      set(state => ({
        messages: markMessageAsReadLocal(state.messages, messageId),
      }));
    } catch (error) {
      if (isSessionLostError(error)) {
        recoverFromLostSession();
        return;
      }
      set({ error: toErrorMessage(error) });
    } finally {
      set({ isMutating: false });
    }
  },

  deleteMessage: async messageId => {
    const { session, capabilities } = get();
    if (!session || !capabilities?.canDelete) {
      return;
    }

    set({ isMutating: true, error: null });

    try {
      await emailInboxDelete(session.sessionId, messageId);
      set(state => ({
        messages: removeMessageLocal(state.messages, messageId),
        selectedMessageId: state.selectedMessageId === messageId ? null : state.selectedMessageId,
      }));
    } catch (error) {
      if (isSessionLostError(error)) {
        recoverFromLostSession();
        return;
      }
      set({ error: toErrorMessage(error) });
    } finally {
      set({ isMutating: false });
    }
  },
}));
