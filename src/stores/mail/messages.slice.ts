import type { StateCreator } from 'zustand';
import {
  emailInboxDelete,
  emailInboxGetById,
  emailInboxList,
  emailInboxMarkAsRead,
  emailInboxUpsertSyncState,
  emailInboxWaitForEmail,
} from '@/lib/backend/modules/emailInbox';
import {
  buildEmailQuery,
  buildWaitForEmailOptions,
  markMessageAsReadLocal,
  removeMessageLocal,
  upsertMessageById,
} from '@/lib/mail/runtime';
import { t } from '@/lib/i18n';
import type { MailState, MessagesSlice } from './types';
import {
  ensureSelectedFolderSession,
  isCurrentListToken,
  isCurrentWaitToken,
  isSessionLostError,
  nextListToken,
  nextWaitToken,
  recoverFromLostSession,
  setDedupedError,
  toErrorMessage,
  toMailProfileSyncState,
} from './helpers';

export const createMessagesSlice: StateCreator<MailState, [], [], MessagesSlice> = (set, get) => ({
  messages: [],
  messagesByProfile: {},
  selectedMessageId: null,
  lastSyncAt: null,
  isSyncing: false,
  isWaiting: false,
  isMutating: false,
  isLoadingMessage: false,
  messageLoadError: null,

  selectMessage: messageId => set({ selectedMessageId: messageId }),

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

      if (!isCurrentListToken(requestToken)) {
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
      if (!isCurrentListToken(requestToken)) {
        return;
      }

      if (isSessionLostError(error)) {
        recoverFromLostSession(get, set);
        return;
      }

      setDedupedError(set, toErrorMessage(error));

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
      if (isCurrentListToken(requestToken)) {
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

      if (!isCurrentWaitToken(requestToken)) {
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
      if (!isCurrentWaitToken(requestToken)) {
        return;
      }

      if (isSessionLostError(error)) {
        recoverFromLostSession(get, set);
        return;
      }

      setDedupedError(set, toErrorMessage(error));

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
      if (isCurrentWaitToken(requestToken)) {
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
        recoverFromLostSession(get, set);
        return;
      }
      // Single-message fetch errors (e.g. a stale/deleted UID) surface scoped to this message.
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
        recoverFromLostSession(get, set);
        return;
      }
      setDedupedError(set, toErrorMessage(error));
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
        recoverFromLostSession(get, set);
        return;
      }
      setDedupedError(set, toErrorMessage(error));
    } finally {
      set({ isMutating: false });
    }
  },

  clearMessageLoadError: () => set({ messageLoadError: null }),
});
