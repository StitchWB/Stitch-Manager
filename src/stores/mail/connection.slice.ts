import type { StateCreator } from 'zustand';
import {
  DEFAULT_IMAP,
  DEFAULT_MAIL_TM,
  DEFAULT_QUERY,
  DEFAULT_SYNC,
  type ConnectionSlice,
  type MailState,
} from './types';
import { deriveStateFromConnectInput, normalizeMailboxPath } from './helpers';

export const createConnectionSlice: StateCreator<MailState, [], [], ConnectionSlice> = set => ({
  source: 'imap',
  accountId: '',
  mailbox: 'INBOX',
  imapCredentials: DEFAULT_IMAP,
  mailTmCredentials: DEFAULT_MAIL_TM,
  query: DEFAULT_QUERY,
  sync: DEFAULT_SYNC,
  error: null,

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
  applyDraft: draft => {
    set({
      ...deriveStateFromConnectInput(draft.connectInput, draft.mailbox || 'INBOX'),
      availableFolders: [],
      selectedFolder: null,
      connectedMailbox: null,
      error: null,
    });
  },
  clearError: () => set({ error: null }),
});
