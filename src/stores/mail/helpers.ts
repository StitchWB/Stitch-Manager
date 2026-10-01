import type {
  EmailConnectInput,
  EmailFolder,
  EmailInboxSyncState,
} from '@/lib/backend/modules/emailInbox';
import { DEFAULT_IMAP, DEFAULT_MAIL_TM, type MailProfileSyncState, type MailState } from './types';

const FOLDER_RECONNECT_DEBOUNCE_MS = 220;

let folderReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let listRequestToken = 0;
let waitRequestToken = 0;

export function clearFolderReconnectTimer(): void {
  if (folderReconnectTimer) {
    clearTimeout(folderReconnectTimer);
    folderReconnectTimer = null;
  }
}

export function scheduleFolderReconnect(task: () => Promise<void>): void {
  clearFolderReconnectTimer();
  folderReconnectTimer = setTimeout(() => {
    folderReconnectTimer = null;
    void task();
  }, FOLDER_RECONNECT_DEBOUNCE_MS);
}

export function invalidateListAndWaitTokens(): void {
  listRequestToken += 1;
  waitRequestToken += 1;
}

export function nextListToken(): number {
  listRequestToken += 1;
  return listRequestToken;
}

export function nextWaitToken(): number {
  waitRequestToken += 1;
  return waitRequestToken;
}

export function isCurrentListToken(token: number): boolean {
  return token === listRequestToken;
}

export function isCurrentWaitToken(token: number): boolean {
  return token === waitRequestToken;
}

export function normalizeMailboxPath(value: string): string {
  return value.trim();
}

export function resolveEffectiveMailbox(state: {
  mailbox: string;
  selectedFolder: EmailFolder | null;
}): string {
  return normalizeMailboxPath(state.selectedFolder?.path ?? state.mailbox);
}

export async function ensureSelectedFolderSession(get: () => MailState): Promise<void> {
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

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const ERROR_DEDUPE_MS = 30_000;
let lastErrorMessage: string | null = null;
let lastErrorAt = 0;

/** Dedupes identical errors within ERROR_DEDUPE_MS. */
export function setDedupedError(
  set: (partial: Partial<MailState>) => void,
  message: string,
): void {
  const now = Date.now();
  if (lastErrorMessage === message && now - lastErrorAt < ERROR_DEDUPE_MS) {
    return;
  }
  lastErrorMessage = message;
  lastErrorAt = now;
  set({ error: message });
}

/** Test-only: reset the error dedupe tracker. */
export function _resetErrorDedupeForTests(): void {
  lastErrorMessage = null;
  lastErrorAt = 0;
}

/** Backend keeps sessions in memory — a restart invalidates every session id. */
export function isSessionLostError(error: unknown): boolean {
  return toErrorMessage(error).includes('Session not found');
}

/** Silent recovery from a dead session: reconnect via the active profile. */
export function recoverFromLostSession(
  get: () => MailState,
  set: (partial: Partial<MailState>) => void,
): void {
  const { activeProfileId, isConnecting } = get();
  set({ session: null, capabilities: null, connectedMailbox: null });
  if (activeProfileId && !isConnecting) {
    void get().connect();
  }
}

export function normalizeProfileLabel(label: string): string {
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : 'Mailbox profile';
}

export function toMailProfileSyncState(syncState: EmailInboxSyncState): MailProfileSyncState {
  return {
    profileId: syncState.profileId,
    status: syncState.status,
    lastSyncAt: syncState.lastSyncAt ?? null,
    lastError: syncState.lastError ?? null,
    cursor: syncState.cursor ?? null,
    updatedAt: syncState.updatedAt,
  };
}

export function deriveStateFromConnectInput(
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
