import type { IMAPConfig } from '@/stores/registration/types';
import {
  CollapsibleGroup,
  ExpandAllToggle,
} from '@/components/ui';
import {
  useInboxTab,
  InboxProviderSection,
  InboxFiltersSection,
  InboxAdvancedSection,
  InboxMessagesSection,
} from './inbox';

interface InboxTabProps {
  imap: IMAPConfig;
  disabled?: boolean;
  onLog?: (level: 'info' | 'warn' | 'error' | 'success' | 'debug', message: string) => void;
}

export function InboxTab({ imap, disabled, onLog }: InboxTabProps) {
  const {
    provider,
    setProvider,
    mailtmAddress,
    setMailtmAddress,
    mailtmPassword,
    setMailtmPassword,
    mailtmBaseUrl,
    setMailtmBaseUrl,
    canConnect,
    session,
    messages,
    isBusy,
    queryFrom,
    setQueryFrom,
    querySubject,
    setQuerySubject,
    queryBody,
    setQueryBody,
    unreadOnly,
    setUnreadOnly,
    timeoutMs,
    setTimeoutMs,
    pollIntervalMs,
    setPollIntervalMs,
    dedupeKey,
    setDedupeKey,
    allExpanded,
    toggleAll,
    handleConnect,
    handleDisconnect,
    handleList,
    handleWait,
    handleMarkAsRead,
    handleDelete,
  } = useInboxTab({ imap, disabled, onLog });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <ExpandAllToggle allExpanded={allExpanded} onToggle={toggleAll} />
      </div>

      <CollapsibleGroup gap="sm">
        <InboxProviderSection
          provider={provider}
          onProviderChange={setProvider}
          mailtmAddress={mailtmAddress}
          onMailtmAddressChange={setMailtmAddress}
          mailtmPassword={mailtmPassword}
          onMailtmPasswordChange={setMailtmPassword}
          mailtmBaseUrl={mailtmBaseUrl}
          onMailtmBaseUrlChange={setMailtmBaseUrl}
          session={session}
          canConnect={canConnect}
          isBusy={isBusy}
          disabled={disabled}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          allExpanded={allExpanded}
        />

        <InboxFiltersSection
          queryFrom={queryFrom}
          onQueryFromChange={setQueryFrom}
          querySubject={querySubject}
          onQuerySubjectChange={setQuerySubject}
          queryBody={queryBody}
          onQueryBodyChange={setQueryBody}
          unreadOnly={unreadOnly}
          onUnreadOnlyChange={setUnreadOnly}
          session={session}
          isBusy={isBusy}
          disabled={disabled}
          onList={handleList}
          allExpanded={allExpanded}
        />

        <InboxAdvancedSection
          timeoutMs={timeoutMs}
          onTimeoutMsChange={setTimeoutMs}
          pollIntervalMs={pollIntervalMs}
          onPollIntervalMsChange={setPollIntervalMs}
          dedupeKey={dedupeKey}
          onDedupeKeyChange={setDedupeKey}
          session={session}
          isBusy={isBusy}
          disabled={disabled}
          onWait={handleWait}
          allExpanded={allExpanded}
        />

        <InboxMessagesSection
          messages={messages}
          session={session}
          isBusy={isBusy}
          disabled={disabled}
          onMarkAsRead={handleMarkAsRead}
          onDelete={handleDelete}
          allExpanded={allExpanded}
        />
      </CollapsibleGroup>
    </div>
  );
}
