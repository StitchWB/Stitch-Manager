import { useCallback, useMemo } from 'react';
import { useMailStore } from '@/stores/mail';
import { t } from '@/lib/i18n';

export function useMailRuntime() {
  const source = useMailStore(state => state.source);
  const accountId = useMailStore(state => state.accountId);
  const mailbox = useMailStore(state => state.mailbox);
  const availableFolders = useMailStore(state => state.availableFolders);
  const selectedFolder = useMailStore(state => state.selectedFolder);
  const imapCredentials = useMailStore(state => state.imapCredentials);
  const mailTmCredentials = useMailStore(state => state.mailTmCredentials);
  const session = useMailStore(state => state.session);
  const capabilities = useMailStore(state => state.capabilities);
  const messages = useMailStore(state => state.messages);
  const selectedMessageId = useMailStore(state => state.selectedMessageId);
  const query = useMailStore(state => state.query);
  const sync = useMailStore(state => state.sync);
  const lastSyncAt = useMailStore(state => state.lastSyncAt);
  const profiles = useMailStore(state => state.profiles);
  const activeProfileId = useMailStore(state => state.activeProfileId);
  const profileSyncMap = useMailStore(state => state.profileSyncMap);
  const providerCatalog = useMailStore(state => state.providerCatalog);
  const isProfilesLoading = useMailStore(state => state.isProfilesLoading);
  const isProfileSaving = useMailStore(state => state.isProfileSaving);
  const isProfileMutating = useMailStore(state => state.isProfileMutating);

  const isConnecting = useMailStore(state => state.isConnecting);
  const isSyncing = useMailStore(state => state.isSyncing);
  const isWaiting = useMailStore(state => state.isWaiting);
  const isMutating = useMailStore(state => state.isMutating);
  const isLoadingMessage = useMailStore(state => state.isLoadingMessage);
  const error = useMailStore(state => state.error);
  const messageLoadError = useMailStore(state => state.messageLoadError);

  const setSource = useMailStore(state => state.setSource);
  const setAccountId = useMailStore(state => state.setAccountId);
  const setMailbox = useMailStore(state => state.setMailbox);
  const setImapCredentials = useMailStore(state => state.setImapCredentials);
  const setMailTmCredentials = useMailStore(state => state.setMailTmCredentials);
  const setQuery = useMailStore(state => state.setQuery);
  const setSync = useMailStore(state => state.setSync);
  const selectMessage = useMailStore(state => state.selectMessage);
  const loadFolders = useMailStore(state => state.loadFolders);
  const selectFolder = useMailStore(state => state.selectFolder);
  const applyDraft = useMailStore(state => state.applyDraft);
  const setActiveProfileId = useMailStore(state => state.setActiveProfileId);
  const loadProfiles = useMailStore(state => state.loadProfiles);
  const loadProviderCatalog = useMailStore(state => state.loadProviderCatalog);
  const loadProfileSyncState = useMailStore(state => state.loadProfileSyncState);
  const renameProfile = useMailStore(state => state.renameProfile);
  const deleteProfile = useMailStore(state => state.deleteProfile);
  const upsertProfileFromDraft = useMailStore(state => state.upsertProfileFromDraft);
  const saveCurrentSessionAsProfile = useMailStore(state => state.saveCurrentSessionAsProfile);
  const clearError = useMailStore(state => state.clearError);
  const clearMessageLoadError = useMailStore(state => state.clearMessageLoadError);
  const connect = useMailStore(state => state.connect);
  const disconnect = useMailStore(state => state.disconnect);
  const listMessages = useMailStore(state => state.listMessages);
  const waitForMessage = useMailStore(state => state.waitForMessage);
  const loadMessageById = useMailStore(state => state.loadMessageById);
  const markAsRead = useMailStore(state => state.markAsRead);
  const deleteMessage = useMailStore(state => state.deleteMessage);

  const selectedMessage = useMemo(
    () => messages.find(message => message.id === selectedMessageId) ?? null,
    [messages, selectedMessageId]
  );

  const selectAndLoadMessage = useCallback(
    async (messageId: string) => {
      selectMessage(messageId);
      await loadMessageById(messageId);
    },
    [loadMessageById, selectMessage]
  );

  const connectDisabled = useMemo(() => {
    if (isConnecting || session) {
      return true;
    }

    if (activeProfileId) {
      return false;
    }

    if (source === 'imap') {
      return !(
        imapCredentials.host.trim() &&
        imapCredentials.username.trim() &&
        imapCredentials.password.trim()
      );
    }

    return !(mailTmCredentials.address.trim() && mailTmCredentials.password.trim());
  }, [activeProfileId, imapCredentials, isConnecting, mailTmCredentials, session, source]);

  const activeProfileSyncState = activeProfileId ? (profileSyncMap[activeProfileId] ?? null) : null;

  const activeProfileSyncBadgeVariant = useMemo(() => {
    if (!activeProfileSyncState) {
      return 'outline' as const;
    }
    if (activeProfileSyncState.status === 'syncing') {
      return 'info' as const;
    }
    if (activeProfileSyncState.status === 'error') {
      return 'danger' as const;
    }
    return 'success' as const;
  }, [activeProfileSyncState]);

  const activeProfileSyncLabel = useMemo(() => {
    if (!activeProfileSyncState) {
      return t('mail.profileSyncUnknown');
    }
    if (activeProfileSyncState.status === 'syncing') {
      return t('mail.profileSyncSyncing');
    }
    if (activeProfileSyncState.status === 'error') {
      return t('mail.profileSyncError');
    }
    return t('mail.profileSyncIdle');
  }, [activeProfileSyncState]);

  return {
    source,
    accountId,
    mailbox,
    availableFolders,
    selectedFolder,
    imapCredentials,
    mailTmCredentials,
    session,
    capabilities,
    messages,
    selectedMessage,
    selectedMessageId,
    query,
    sync,
    lastSyncAt,
    profiles,
    activeProfileId,
    profileSyncMap,
    activeProfileSyncState,
    activeProfileSyncBadgeVariant,
    activeProfileSyncLabel,
    providerCatalog,
    isProfilesLoading,
    isProfileSaving,
    isProfileMutating,
    isConnecting,
    isSyncing,
    isWaiting,
    isMutating,
    isLoadingMessage,
    error,
    messageLoadError,
    clearMessageLoadError,
    connectDisabled,
    setSource,
    setAccountId,
    setMailbox,
    setImapCredentials,
    setMailTmCredentials,
    setQuery,
    setSync,
    loadFolders,
    selectFolder,
    applyDraft,
    setActiveProfileId,
    loadProfiles,
    loadProviderCatalog,
    loadProfileSyncState,
    renameProfile,
    deleteProfile,
    upsertProfileFromDraft,
    saveCurrentSessionAsProfile,
    clearError,
    connect,
    disconnect,
    listMessages,
    waitForMessage,
    markAsRead,
    deleteMessage,
    selectMessage,
    selectAndLoadMessage,
  };
}
