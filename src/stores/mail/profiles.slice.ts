import type { StateCreator } from 'zustand';
import {
  emailInboxCreateMailTmAccount,
  emailInboxDeleteProfile,
  emailInboxDisconnect,
  emailInboxGetProviderCatalog,
  emailInboxGetSyncState,
  emailInboxListProfiles,
  emailInboxUpsertProfile,
} from '@/lib/backend/modules/emailInbox';
import type { EmailInboxProfile } from '@/lib/backend/modules/emailInbox';
import { buildImapConnectInput, buildMailTmConnectInput } from '@/lib/mail/runtime';
import type { MailProfileSyncState, MailState, ProfilesSlice } from './types';
import {
  clearFolderReconnectTimer,
  deriveStateFromConnectInput,
  invalidateListAndWaitTokens,
  isEmailInboxProfile,
  normalizeProfileLabel,
  resolveEffectiveMailbox,
  setDedupedError,
  toErrorMessage,
  toMailProfileSyncState,
} from './helpers';

export const createProfilesSlice: StateCreator<MailState, [], [], ProfilesSlice> = (set, get) => ({
  profiles: [],
  activeProfileId: null,
  profileSyncMap: {},
  providerCatalog: [],
  isProfilesLoading: false,
  isProfileSaving: false,
  isProfileMutating: false,

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
      setDedupedError(set, toErrorMessage(error));
      return null;
    } finally {
      set({ isProfileSaving: false });
    }
  },
  loadProfiles: async () => {
    set({ isProfilesLoading: true, error: null });

    try {
      const rawProfiles: unknown = await emailInboxListProfiles();

      const profiles: EmailInboxProfile[] = [];
      const rejected: unknown[] = [];
      const rows: unknown[] = Array.isArray(rawProfiles) ? rawProfiles : [rawProfiles];
      for (const row of rows) {
        if (isEmailInboxProfile(row)) {
          profiles.push(row);
        } else {
          rejected.push(row);
        }
      }

      if (rejected.length > 0) {
        console.error('Malformed mail profiles rejected:', rejected);
        setDedupedError(
          set,
          `${rejected.length} mail profile(s) rejected: malformed response from backend`,
        );
      }

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
      setDedupedError(set, toErrorMessage(error));
    } finally {
      set({ isProfilesLoading: false });
    }
  },
  loadProviderCatalog: async () => {
    try {
      const providerCatalog = await emailInboxGetProviderCatalog();
      set({ providerCatalog });
    } catch (error) {
      setDedupedError(set, toErrorMessage(error));
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
      setDedupedError(set, toErrorMessage(error));
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
      setDedupedError(set, toErrorMessage(error));
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
      setDedupedError(set, toErrorMessage(error));
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
      setDedupedError(set, toErrorMessage(error));
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
      setDedupedError(set, toErrorMessage(error));
    } finally {
      set({ isProfileMutating: false });
    }
  },
});
