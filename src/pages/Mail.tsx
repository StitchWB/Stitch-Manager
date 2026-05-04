import { useEffect, useMemo } from 'react';
import { AlertTriangle, Database, Mail as MailIcon, Server } from 'lucide-react';
import Header from '@/components/layout/Header';
import {
  GoogleSheetsRawMailboxImport,
  MailboxNavigation,
  MailMessageList,
  MailMessageToolbar,
  MailMessageViewer,
  MailProfilesRail,
  MailProfileManager,
  MailSyncControls,
} from '@/components/mail';
import { Badge, Button, ButtonBase, Modal, Select } from '@/components/ui';
import { useMailRuntime } from '@/hooks/useMailRuntime';
import { useRegistrationStore } from '@/stores/registration';
import { t } from '@/lib/i18n';
import { useUIState } from '@/hooks/useUIState';
import {
  buildImapAccountIdFromRegistration,
  deriveImapFieldsFromRegistration,
} from '@/lib/mail/runtime';

type ProviderFilter = 'all' | 'imap' | 'mail_tm';

export default function Mail() {
  const runtime = useMailRuntime();
  const registrationImap = useRegistrationStore(state => state.config.imap);

  const [rawModalOpen, setRawModalOpen] = useUIState('mail-raw-modal', false, 'session');
  const [providerFilter, setProviderFilter] = useUIState<ProviderFilter>(
    'mail-provider-filter',
    'all',
    'persist'
  );

  const {
    accountId,
    setImapCredentials,
    setAccountId,
    loadProfiles,
    loadProviderCatalog,
    upsertProfileFromDraft,
    setActiveProfileId,
    session,
    loadFolders,
  } = runtime;

  const hasAnyMailboxContext = useMemo(
    () => Boolean(runtime.activeProfileId || runtime.accountId.trim()),
    [runtime.accountId, runtime.activeProfileId]
  );

  const filteredProfiles = useMemo(() => {
    if (providerFilter === 'all') {
      return runtime.profiles;
    }
    return runtime.profiles.filter(profile => profile.provider === providerFilter);
  }, [providerFilter, runtime.profiles]);

  const profileOptions = useMemo(
    () => [
      { value: '', label: t('mail.manualProfileMode') },
      ...filteredProfiles.map(profile => ({
        value: profile.id,
        label: `${profile.label} · ${profile.accountId}`,
      })),
    ],
    [filteredProfiles]
  );

  useEffect(() => {
    const derivedImap = deriveImapFieldsFromRegistration(registrationImap);

    setImapCredentials(derivedImap);

    if (!accountId) {
      const candidate = buildImapAccountIdFromRegistration(registrationImap).replace(/^imap:/, '');
      if (candidate) {
        setAccountId(`imap:${candidate}`);
      }
    }
  }, [accountId, registrationImap, setAccountId, setImapCredentials]);

  useEffect(() => {
    void loadProfiles();
    void loadProviderCatalog();
  }, [loadProfiles, loadProviderCatalog]);

  useEffect(() => {
    if (session) {
      void loadFolders();
    }
  }, [loadFolders, session]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#050508]">
      <Header title={t('mail.title')} subtitle={t('mail.subtitle')} icon={<MailIcon size={18} />} />

      <div className="flex-1 min-h-0 overflow-hidden px-4 pb-4 md:px-6 md:pb-6">
        <div className="max-w-[1720px] mx-auto h-full pt-4 flex flex-col gap-3">
          {runtime.error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 flex items-center justify-between gap-3">
              <p className="text-xs text-red-200">{runtime.error}</p>
              <ButtonBase type="button" onClick={runtime.clearError} className="text-[11px]">
                {t('common.dismiss')}
              </ButtonBase>
            </div>
          ) : null}

          {!runtime.activeProfileId ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-amber-300 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs text-amber-100 font-medium">
                    {t('mail.mailboxNotSelectedTitle')}
                  </p>
                  <p className="text-[11px] text-amber-200/90">
                    {t('mail.mailboxNotSelectedHint')}
                  </p>
                </div>
              </div>
              <Button
                size="xs"
                variant="secondary"
                onClick={() => setRawModalOpen(true)}
                leftIcon={<Database size={12} />}
              >
                {t('mail.openRawSourceAction')}
              </Button>
            </div>
          ) : null}

          <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[320px_minmax(420px,1fr)_minmax(420px,1fr)] 2xl:grid-cols-[320px_minmax(420px,0.95fr)_minmax(420px,1fr)_220px] gap-3">
            <aside className="min-h-0 space-y-3 overflow-auto pr-1">
              <section className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-3 space-y-2">
                <div className="grid grid-cols-1 gap-2">
                  <Select
                    label={t('mail.sourceLabel')}
                    value={providerFilter}
                    options={[
                      { value: 'all', label: t('common.all') },
                      { value: 'imap', label: t('mail.sourceImap') },
                      { value: 'mail_tm', label: t('mail.sourceMailTm') },
                    ]}
                    onValueChange={value => setProviderFilter(value as ProviderFilter)}
                  />

                  <Select
                    label={t('mail.activeProfileLabel')}
                    value={runtime.activeProfileId ?? ''}
                    options={profileOptions}
                    onValueChange={value => setActiveProfileId(value || null)}
                  />
                </div>
              </section>

              <MailboxNavigation
                source={runtime.source}
                accountId={runtime.accountId}
                mailbox={runtime.mailbox}
                availableFolders={runtime.availableFolders}
                selectedFolder={runtime.selectedFolder}
                imapCredentials={runtime.imapCredentials}
                mailTmCredentials={runtime.mailTmCredentials}
                session={runtime.session}
                isConnecting={runtime.isConnecting}
                connectDisabled={runtime.connectDisabled}
                hasActiveProfile={Boolean(runtime.activeProfileId)}
                onSourceChange={runtime.setSource}
                onAccountIdChange={runtime.setAccountId}
                onMailboxChange={runtime.setMailbox}
                onRefreshFolders={runtime.loadFolders}
                onSelectFolder={runtime.selectFolder}
                onImapPatch={runtime.setImapCredentials}
                onMailTmPatch={runtime.setMailTmCredentials}
                onConnect={runtime.connect}
                onDisconnect={runtime.disconnect}
              />

              <MailProfileManager
                profiles={runtime.profiles}
                activeProfileId={runtime.activeProfileId}
                profileSyncMap={runtime.profileSyncMap}
                isProfilesLoading={runtime.isProfilesLoading}
                isProfileMutating={runtime.isProfileMutating}
                onRefreshProfiles={loadProfiles}
                onSelectProfile={setActiveProfileId}
                onRenameProfile={runtime.renameProfile}
                onDeleteProfile={runtime.deleteProfile}
                onOpenRawSource={() => setRawModalOpen(true)}
              />

              <section className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2 text-white">
                  <Server size={16} />
                  <h2 className="text-xs font-semibold uppercase tracking-wide">
                    {t('mail.capabilitiesTitle')}
                  </h2>
                </div>
                {runtime.activeProfileId ? (
                  <div className="flex items-center gap-2">
                    <Badge variant={runtime.activeProfileSyncBadgeVariant} size="sm" withDot>
                      {runtime.activeProfileSyncLabel}
                    </Badge>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-1.5">
                  <Badge
                    variant={runtime.capabilities?.canMarkAsRead ? 'success' : 'outline'}
                    size="sm"
                  >
                    {t('mail.capabilityMarkAsRead')}
                  </Badge>
                  <Badge
                    variant={runtime.capabilities?.canDelete ? 'success' : 'outline'}
                    size="sm"
                  >
                    {t('mail.capabilityDelete')}
                  </Badge>
                  <Badge
                    variant={runtime.capabilities?.canSearchBody ? 'success' : 'outline'}
                    size="sm"
                  >
                    {t('mail.capabilitySearchBody')}
                  </Badge>
                  <Badge
                    variant={runtime.capabilities?.canDownloadAttachments ? 'success' : 'outline'}
                    size="sm"
                  >
                    {t('mail.capabilityAttachments')}
                  </Badge>
                </div>
              </section>
            </aside>

            <section className="min-h-0 flex flex-col gap-3">
              <MailMessageToolbar
                query={runtime.query}
                hasSession={Boolean(runtime.session)}
                isSyncing={runtime.isSyncing}
                isWaiting={runtime.isWaiting}
                onQueryPatch={runtime.setQuery}
                onList={runtime.listMessages}
                onWait={runtime.waitForMessage}
              />

              <MailSyncControls
                query={runtime.query}
                sync={runtime.sync}
                hasSession={Boolean(runtime.session)}
                isSyncing={runtime.isSyncing}
                isWaiting={runtime.isWaiting}
                lastSyncAt={runtime.lastSyncAt}
                onQueryPatch={runtime.setQuery}
                onSyncPatch={runtime.setSync}
                onList={runtime.listMessages}
                onWait={runtime.waitForMessage}
              />

              <div className="min-h-0 flex-1">
                {hasAnyMailboxContext ? (
                  <MailMessageList
                    messages={runtime.messages}
                    selectedMessageId={runtime.selectedMessageId}
                    capabilities={runtime.capabilities}
                    busy={runtime.isMutating || runtime.isLoadingMessage}
                    onSelectMessage={runtime.selectAndLoadMessage}
                    onMarkRead={runtime.markAsRead}
                    onDelete={runtime.deleteMessage}
                  />
                ) : (
                  <section className="bg-white/[0.03] border border-white/[0.08] rounded-xl p-6 h-full min-h-[420px] flex items-center">
                    <div className="space-y-2">
                      <p className="text-sm text-white font-semibold">
                        {t('mail.mailboxNotSelectedTitle')}
                      </p>
                      <p className="text-xs text-slate-400">{t('mail.mailboxNotSelectedHint')}</p>
                    </div>
                  </section>
                )}
              </div>
            </section>

            <section className="min-h-0">
              <div className="h-full">
                <MailMessageViewer message={runtime.selectedMessage} />
              </div>
            </section>

            <section className="min-h-0 hidden 2xl:block">
              <MailProfilesRail
                profiles={runtime.profiles}
                providerCatalog={runtime.providerCatalog}
                sessionAccountId={runtime.session?.accountId ?? null}
                activeProfileId={runtime.activeProfileId}
                isProfileSaving={runtime.isProfileSaving}
                onSelectProfile={setActiveProfileId}
                onSaveCurrentSessionAsProfile={async () => {
                  await runtime.saveCurrentSessionAsProfile();
                }}
              />
            </section>
          </div>
        </div>
      </div>

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
