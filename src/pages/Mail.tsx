import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mail as MailIcon, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import Header from '@/components/layout/Header';
import {
  GoogleSheetsRawMailboxImport,
  MailManualConnectModal,
  MailMessageList,
  MailMessageViewer,
  MailSidebar,
  MailToolbar,
} from '@/components/mail';
import type { AddMailboxAction } from '@/components/mail/MailSidebar';
import type { MailboxProviderKind } from '@/lib/mail/providerPresets';
import { Button, Modal } from '@/components/ui';
import { useMailRuntime } from '@/hooks/useMailRuntime';
import { useMailStore } from '@/stores/mail';
import { useRegistrationStore } from '@/stores/registration';
import { t } from '@/lib/i18n';
import { useUIState } from '@/hooks/useUIState';
import {
  ACCOUNT_QUERY_PARAM,
  AUTO_REG_MAILBOX_PROFILE_ID,
  buildAccountScopeContext,
  deriveAutoRegProfile,
  upsertAutoRegMailboxProfile,
  type AccountScopeContext,
} from '@/lib/mail/runtime';
import { toast } from 'sonner';

type ManualModalSource = 'imap' | 'mail_tm';

export default function Mail() {
  const runtime = useMailRuntime();
  const registrationImap = useRegistrationStore(state => state.config.imap);
  const setQuery = useMailStore(state => state.setQuery);

  const [searchParams, setSearchParams] = useSearchParams();
  const [accountScope, setAccountScope] = useState<AccountScopeContext | null>(null);

  const [rawModalOpen, setRawModalOpen] = useUIState('mail-raw-modal', false, 'session');
  const [manualModalOpen, setManualModalOpen] = useUIState('mail-manual-modal', false, 'session');
  const [manualModalSource, setManualModalSource] = useUIState<ManualModalSource>(
    'mail-manual-modal-source',
    'imap',
    'session'
  );
  const [manualModalPresetKind, setManualModalPresetKind] = useUIState<MailboxProviderKind | undefined>(
    'mail-manual-modal-preset',
    undefined,
    'session'
  );

  const {
    loadProfiles,
    loadProviderCatalog,
    upsertProfileFromDraft,
    setActiveProfileId,
    selectFolder,
    session,
    loadFolders,
    activeProfileId,
    profiles,
    isProfilesLoading,
    isConnecting,
    connect,
    listMessages,
  } = runtime;
  const connectedMailbox = useMailStore(state => state.connectedMailbox);

  // Load profiles + provider catalog on mount
  useEffect(() => {
    void loadProfiles();
    void loadProviderCatalog();
  }, [loadProfiles, loadProviderCatalog]);

  // Reload folders whenever session is established
  useEffect(() => {
    if (session) {
      void loadFolders();
    }
  }, [loadFolders, session]);

  // Auto-connect when an active profile is selected but no session exists yet.
  // Tracks the last-attempted profile id+credentials hash so we do not spam
  // reconnects on errors but DO retry once credentials change.
  const autoConnectAttemptedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!activeProfileId) {
      autoConnectAttemptedFor.current = null;
      return;
    }
    if (session || isConnecting) return;

    const profile = profiles.find(item => item.id === activeProfileId);
    if (!profile) return;

    // Build a key that changes when credentials change so retries can occur
    // after the user updates Auto-Reg settings.
    const creds = profile.connectInput.credentials;
    const credsKey =
      creds.type === 'imap'
        ? `imap:${creds.value.host}:${creds.value.port}:${creds.value.username}:${creds.value.useTls ? 1 : 0}`
        : `mailtm:${creds.value.address}:${creds.value.baseUrl ?? ''}`;
    const attemptKey = `${activeProfileId}|${profile.updatedAt}|${credsKey}`;

    if (autoConnectAttemptedFor.current === attemptKey) return;

    autoConnectAttemptedFor.current = attemptKey;
    void connect();
  }, [activeProfileId, connect, isConnecting, profiles, session]);

  // Auto-list inbox whenever the (session, mailbox) pair changes. This covers
  // the initial connect and any folder switch that triggers a reconnect.
  const autoListedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!session) return;
    const key = `${session.sessionId}|${connectedMailbox ?? ''}`;
    if (autoListedFor.current === key) return;

    autoListedFor.current = key;
    // Small delay to let account-scope filter effect apply first
    const timer = setTimeout(() => {
      void listMessages();
    }, 50);
    return () => clearTimeout(timer);
  }, [connectedMailbox, listMessages, session]);

  // Account-scoped deep link: /mail?account=<id> resolves the appropriate
  // mailbox profile for that account, switches to it, and applies a `to`
  // filter so the user only sees mail addressed to this specific account.
  // The query param is consumed once (to avoid re-applying on every render)
  // and then removed from the URL.
  const accountParamConsumedFor = useRef<string | null>(null);
  useEffect(() => {
    if (isProfilesLoading) return;

    const accountIdParam = searchParams.get(ACCOUNT_QUERY_PARAM);
    if (!accountIdParam) {
      // Param cleared (e.g. user clicked another sidebar entry) → drop scope.
      if (accountScope) {
        setAccountScope(null);
      }
      accountParamConsumedFor.current = null;
      return;
    }

    if (accountParamConsumedFor.current === accountIdParam) return;
    accountParamConsumedFor.current = accountIdParam;

    void (async () => {
      const context = await buildAccountScopeContext(accountIdParam, profiles).catch(error => {
        console.warn('[Mail] failed to build account scope:', error);
        return null;
      });

      if (!context) {
        toast.error(t('mail.accountScopeNotFound'));
        const next = new URLSearchParams(searchParams);
        next.delete(ACCOUNT_QUERY_PARAM);
        setSearchParams(next, { replace: true });
        return;
      }

      setAccountScope(context);

      if (context.resolution.profile) {
        setActiveProfileId(context.resolution.profile.id);
      } else {
        toast.warning(
          t('mail.accountScopeNoMailbox', { email: context.account.email })
        );
      }

      // Apply `to: account.email` filter unless the resolution was mail.tm
      // (the mailbox itself already scopes to the account).
      setQuery({
        to: context.filter.to ?? '',
        search: context.filter.search ?? '',
      });
    })();
  }, [
    accountScope,
    isProfilesLoading,
    profiles,
    searchParams,
    setActiveProfileId,
    setQuery,
    setSearchParams,
  ]);

  // Auto-sync the global Auto-Reg IMAP/Gmail config into a mailbox profile so
  // that mailboxes configured in Auto-Reg appear automatically in the sidebar.
  // Re-runs whenever the credentials change. We track the last synced fingerprint
  // to avoid pointless writes when nothing changed.
  const autoRegSyncFingerprint = useRef<string | null>(null);
  useEffect(() => {
    if (isProfilesLoading) return;

    const derived = deriveAutoRegProfile(registrationImap);
    if (!derived) {
      autoRegSyncFingerprint.current = null;
      return;
    }

    // Fingerprint of meaningful fields. Password is excluded - sentinel "********"
    // means "use stored value", and identical creds shouldn't re-trigger upsert.
    const fingerprint = [
      derived.host,
      derived.port,
      derived.username,
      derived.useTls ? '1' : '0',
      derived.password === '********' || derived.password.length === 0 ? 'stored' : 'inline',
    ].join('|');

    if (autoRegSyncFingerprint.current === fingerprint) return;

    const existing = profiles.find(profile => profile.id === AUTO_REG_MAILBOX_PROFILE_ID);
    if (
      existing &&
      existing.connectInput.provider === 'imap' &&
      existing.connectInput.credentials.type === 'imap' &&
      existing.connectInput.credentials.value.host === derived.host &&
      existing.connectInput.credentials.value.port === derived.port &&
      existing.connectInput.credentials.value.username === derived.username &&
      Boolean(existing.connectInput.credentials.value.useTls) === derived.useTls
    ) {
      // Already in sync at the meaningful-field level
      autoRegSyncFingerprint.current = fingerprint;
      return;
    }

    autoRegSyncFingerprint.current = fingerprint;

    void (async () => {
      try {
        await upsertAutoRegMailboxProfile(registrationImap);
        await loadProfiles();
      } catch (error) {
        console.warn('[Mail] auto-reg profile sync failed:', error);
        // Reset fingerprint so the next render attempts again.
        autoRegSyncFingerprint.current = null;
      }
    })();
  }, [isProfilesLoading, loadProfiles, profiles, registrationImap]);

  const controlsDisabled = useMemo(
    () => runtime.isConnecting || Boolean(runtime.session) || Boolean(runtime.activeProfileId),
    [runtime.activeProfileId, runtime.isConnecting, runtime.session]
  );

  const handleAddMailbox = useCallback(
    async (action: AddMailboxAction) => {
      switch (action) {
        case 'fromAutoReg': {
          try {
            const profile = await upsertAutoRegMailboxProfile(registrationImap);
            if (!profile) {
              toast.error(t('mail.mailboxNotSelectedHint'));
              return;
            }

            await loadProfiles();
            setActiveProfileId(profile.id);
            toast.success(profile.label);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(message);
          }
          break;
        }

        case 'imapManual': {
          setManualModalPresetKind(undefined);
          setManualModalSource('imap');
          setManualModalOpen(true);
          break;
        }

        case 'icloud': {
          setManualModalPresetKind('icloud');
          setManualModalSource('imap');
          setManualModalOpen(true);
          break;
        }

        case 'gmail': {
          setManualModalPresetKind('gmail');
          setManualModalSource('imap');
          setManualModalOpen(true);
          break;
        }

        case 'mailTmManual': {
          setManualModalPresetKind(undefined);
          setManualModalSource('mail_tm');
          setManualModalOpen(true);
          break;
        }

        case 'fromSheets': {
          setRawModalOpen(true);
          break;
        }
      }
    },
    [
      loadProfiles,
      registrationImap,
      setActiveProfileId,
      setManualModalOpen,
      setManualModalPresetKind,
      setManualModalSource,
      setRawModalOpen,
    ]
  );

  const activeProfile = useMemo(
    () => profiles.find(profile => profile.id === activeProfileId) ?? null,
    [activeProfileId, profiles]
  );

  const handleClearAccountScope = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete(ACCOUNT_QUERY_PARAM);
    setSearchParams(next, { replace: true });
    setAccountScope(null);
    setQuery({ to: '', search: '' });
    accountParamConsumedFor.current = null;
  }, [searchParams, setQuery, setSearchParams]);

  const headerSubtitle = accountScope
    ? `${t('mail.headerScopedToAccount')}: ${accountScope.account.email}`
    : activeProfile
      ? `${t('mail.headerActiveMailbox')}: ${activeProfile.label}`
      : t('mail.headerNoActiveMailbox');

  return (
    <div className="flex flex-col h-full overflow-hidden bg-vsc-bg">
      <Header title={t('mail.title')} subtitle={headerSubtitle} icon={<MailIcon size={18} />} />

      <div className="flex-1 min-h-0 overflow-hidden px-4 pb-4 md:px-6 md:pb-6">
        <div className="max-w-[1720px] mx-auto h-full pt-4 flex flex-col gap-3">
          {runtime.error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 flex items-center justify-between gap-3">
              <p className="text-xs text-red-200">{runtime.error}</p>
              <Button
                size="xs"
                variant="ghost"
                onClick={runtime.clearError}
                leftIcon={<X size={12} />}
              >
                {t('common.dismiss')}
              </Button>
            </div>
          ) : null}

          {accountScope ? (
            <div className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <MailIcon size={14} className="text-indigo-300 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs text-indigo-100 font-medium truncate">
                    {t('mail.accountScopeBannerTitle', {
                      email: accountScope.account.email,
                    })}
                  </p>
                  {accountScope.resolution.profile ? (
                    <p className="text-[11px] text-indigo-200/80 truncate">
                      {t('mail.accountScopeViaMailbox', {
                        label: accountScope.resolution.profile.label,
                      })}
                    </p>
                  ) : (
                    <p className="text-[11px] text-amber-200 truncate">
                      {t('mail.accountScopeMissingMailbox')}
                    </p>
                  )}
                </div>
              </div>
              <Button
                size="xs"
                variant="ghost"
                onClick={handleClearAccountScope}
                leftIcon={<X size={12} />}
              >
                {t('mail.accountScopeClear')}
              </Button>
            </div>
          ) : null}

          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[240px_minmax(300px,1fr)_minmax(360px,1.2fr)] gap-3">
            {/* Left: sidebar with accounts/mailboxes */}
            <MailSidebar
              profiles={profiles}
              activeProfileId={runtime.activeProfileId}
              profileSyncMap={runtime.profileSyncMap}
              availableFolders={runtime.availableFolders}
              selectedFolder={runtime.selectedFolder}
              hasSession={Boolean(runtime.session)}
              isConnecting={runtime.isConnecting}
              isProfilesLoading={runtime.isProfilesLoading}
              onSelectProfile={setActiveProfileId}
              onSelectFolder={selectFolder}
              onAddMailbox={action => {
                void handleAddMailbox(action);
              }}
              onRenameProfile={runtime.renameProfile}
              onDeleteProfile={runtime.deleteProfile}
            />

            {/* Center: toolbar + message list */}
            <section className="min-h-0 flex flex-col gap-3">
              <MailToolbar
                query={runtime.query}
                hasSession={Boolean(runtime.session)}
                hasActiveProfile={Boolean(runtime.activeProfileId)}
                isConnecting={runtime.isConnecting}
                isSyncing={runtime.isSyncing}
                isWaiting={runtime.isWaiting}
                lastSyncAt={runtime.lastSyncAt}
                onQueryPatch={runtime.setQuery}
                onList={runtime.listMessages}
                onWait={runtime.waitForMessage}
                onConnect={runtime.connect}
                onDisconnect={runtime.disconnect}
              />

              <div className="min-h-0 flex-1">
                <MailMessageList
                  messages={runtime.messages}
                  selectedMessageId={runtime.selectedMessageId}
                  capabilities={runtime.capabilities}
                  busy={runtime.isMutating || runtime.isLoadingMessage}
                  onSelectMessage={runtime.selectAndLoadMessage}
                  onMarkRead={runtime.markAsRead}
                  onDelete={runtime.deleteMessage}
                />
              </div>
            </section>

            {/* Right: message viewer */}
            <section className="min-h-0">
              <MailMessageViewer
                message={runtime.selectedMessage}
                capabilities={runtime.capabilities}
                busy={runtime.isMutating || runtime.isLoadingMessage}
                loadError={runtime.messageLoadError}
                onClearLoadError={runtime.clearMessageLoadError}
                onMarkRead={runtime.markAsRead}
                onDelete={runtime.deleteMessage}
              />
            </section>
          </div>
        </div>
      </div>

      {/* Manual IMAP/Mail.tm setup modal */}
      <MailManualConnectModal
        isOpen={manualModalOpen}
        defaultSource={manualModalSource}
        presetKind={manualModalPresetKind}
        source={runtime.source}
        accountId={runtime.accountId}
        mailbox={runtime.mailbox}
        imapCredentials={runtime.imapCredentials}
        mailTmCredentials={runtime.mailTmCredentials}
        hasSession={Boolean(runtime.session)}
        isConnecting={runtime.isConnecting}
        connectDisabled={runtime.connectDisabled}
        controlsDisabled={controlsDisabled}
        onSourceChange={runtime.setSource}
        onAccountIdChange={runtime.setAccountId}
        onMailboxChange={runtime.setMailbox}
        onImapPatch={runtime.setImapCredentials}
        onMailTmPatch={runtime.setMailTmCredentials}
        onConnect={async () => {
          await runtime.connect();
          // Close modal on successful connect
          if (!runtime.error) {
            setManualModalOpen(false);
          }
        }}
        onDisconnect={runtime.disconnect}
        onClose={() => setManualModalOpen(false)}
      />

      {/* Google Sheets RAW import modal */}
      <Modal
        isOpen={rawModalOpen}
        onClose={() => setRawModalOpen(false)}
        title={t('mail.rawSourceTitle')}
        size="xl"
        footer={
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => setRawModalOpen(false)}>
              {t('common.close')}
            </Button>
          </div>
        }
      >
        <GoogleSheetsRawMailboxImport
          onSaveDraft={upsertProfileFromDraft}
          isSaving={runtime.isProfileSaving}
        />
      </Modal>
    </div>
  );
}
