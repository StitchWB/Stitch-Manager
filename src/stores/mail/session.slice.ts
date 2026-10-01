import type { StateCreator } from 'zustand';
import {
  emailInboxConnect,
  emailInboxConnectProfile,
  emailInboxDisconnect,
  emailInboxGetCapabilities,
  emailInboxListFolders,
} from '@/lib/backend/modules/emailInbox';
import { buildImapConnectInput, buildMailTmConnectInput } from '@/lib/mail/runtime';
import type { MailState, SessionSlice } from './types';
import {
  clearFolderReconnectTimer,
  invalidateListAndWaitTokens,
  isSessionLostError,
  normalizeMailboxPath,
  recoverFromLostSession,
  resolveEffectiveMailbox,
  scheduleFolderReconnect,
  setDedupedError,
  toErrorMessage,
} from './helpers';

let connectRetriedFor: string | null = null;

export const createSessionSlice: StateCreator<MailState, [], [], SessionSlice> = (set, get) => ({
  availableFolders: [],
  selectedFolder: null,
  connectedMailbox: null,
  session: null,
  capabilities: null,
  isConnecting: false,

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
        recoverFromLostSession(get, set);
        return;
      }
      setDedupedError(set, toErrorMessage(error));
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
        // Preserve cached messages — setActiveProfileId already loaded them from messagesByProfile.
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
      setDedupedError(set, toErrorMessage(error));
      // ponytail: one delayed retry for backend cold-start races.
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
      setDedupedError(set, toErrorMessage(error));
    } finally {
      set({ isConnecting: false });
    }
  },
});
