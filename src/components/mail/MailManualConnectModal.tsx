import { useEffect, useMemo, useState } from 'react';
import { Link2, PlugZap } from 'lucide-react';
import { Button, Checkbox, Input, Modal, Select } from '@/components/ui';
import { t } from '@/lib/i18n';
import type { EmailProviderType } from '@/lib/tauri/modules/emailInbox';
import type { MailImapCredentials, MailTmCredentials } from '@/stores/mail';

interface MailManualConnectModalProps {
  isOpen: boolean;
  defaultSource?: EmailProviderType;
  source: EmailProviderType;
  accountId: string;
  mailbox: string;
  imapCredentials: MailImapCredentials;
  mailTmCredentials: MailTmCredentials;
  hasSession: boolean;
  isConnecting: boolean;
  connectDisabled: boolean;
  controlsDisabled: boolean;
  onSourceChange: (source: EmailProviderType) => void;
  onAccountIdChange: (value: string) => void;
  onMailboxChange: (value: string) => void;
  onImapPatch: (patch: Partial<MailImapCredentials>) => void;
  onMailTmPatch: (patch: Partial<MailTmCredentials>) => void;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onClose: () => void;
}

export function MailManualConnectModal({
  isOpen,
  defaultSource,
  source,
  accountId,
  mailbox,
  imapCredentials,
  mailTmCredentials,
  hasSession,
  isConnecting,
  connectDisabled,
  controlsDisabled,
  onSourceChange,
  onAccountIdChange,
  onMailboxChange,
  onImapPatch,
  onMailTmPatch,
  onConnect,
  onDisconnect,
  onClose,
}: MailManualConnectModalProps) {
  const [hasOpenedOnce, setHasOpenedOnce] = useState(false);

  // When the modal opens with a different default source than current, switch.
  useEffect(() => {
    if (!isOpen || !defaultSource) return;
    if (hasOpenedOnce) return;
    setHasOpenedOnce(true);
    if (defaultSource !== source) {
      onSourceChange(defaultSource);
    }
  }, [defaultSource, hasOpenedOnce, isOpen, onSourceChange, source]);

  // Reset the once-open flag when modal closes
  useEffect(() => {
    if (!isOpen) {
      setHasOpenedOnce(false);
    }
  }, [isOpen]);

  const sourceOptions = useMemo(
    () => [
      { value: 'imap', label: t('mail.sourceImap') },
      { value: 'mail_tm', label: t('mail.sourceMailTm') },
    ],
    []
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('mail.manualConnectionTitle')}
      size="lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              void onConnect();
            }}
            disabled={connectDisabled}
            leftIcon={<PlugZap size={14} />}
          >
            {isConnecting ? t('mail.connecting') : t('mail.connect')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              void onDisconnect();
            }}
            disabled={!hasSession || isConnecting}
            leftIcon={<Link2 size={14} />}
          >
            {t('mail.disconnect')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-400">{t('mail.manualConnectionDescription')}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Select
            label={t('mail.sourceLabel')}
            value={source}
            onValueChange={value => onSourceChange(value as EmailProviderType)}
            disabled={controlsDisabled}
            options={sourceOptions}
          />

          <Input
            label={t('mail.accountIdLabel')}
            value={accountId}
            onChange={event => onAccountIdChange(event.target.value)}
            disabled={controlsDisabled}
          />

          <Input
            label={t('mail.mailboxLabel')}
            value={mailbox}
            onChange={event => onMailboxChange(event.target.value)}
            disabled={controlsDisabled || source !== 'imap'}
          />
        </div>

        {source === 'imap' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label={t('mail.providerHost')}
              value={imapCredentials.host}
              onChange={event => onImapPatch({ host: event.target.value })}
              disabled={controlsDisabled}
            />
            <Input
              label={t('mail.providerPort')}
              type="number"
              value={String(imapCredentials.port)}
              onChange={event => onImapPatch({ port: Number(event.target.value) || 0 })}
              disabled={controlsDisabled}
            />
            <Input
              label={t('mail.providerUsername')}
              value={imapCredentials.username}
              onChange={event => onImapPatch({ username: event.target.value })}
              disabled={controlsDisabled}
            />
            <Input
              label={t('mail.providerPassword')}
              type="password"
              value={imapCredentials.password}
              onChange={event => onImapPatch({ password: event.target.value })}
              disabled={controlsDisabled}
            />
            <div className="md:col-span-2">
              <Checkbox
                checked={imapCredentials.useTls}
                onChange={event => onImapPatch({ useTls: event.target.checked })}
                label={t('mail.providerUseTls')}
                disabled={controlsDisabled}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label={t('mail.providerAddress')}
              value={mailTmCredentials.address}
              onChange={event => onMailTmPatch({ address: event.target.value })}
              disabled={controlsDisabled}
            />
            <Input
              label={t('mail.providerPassword')}
              type="password"
              value={mailTmCredentials.password}
              onChange={event => onMailTmPatch({ password: event.target.value })}
              disabled={controlsDisabled}
            />
            <div className="md:col-span-2">
              <Input
                label={t('mail.providerBaseUrl')}
                value={mailTmCredentials.baseUrl}
                onChange={event => onMailTmPatch({ baseUrl: event.target.value })}
                disabled={controlsDisabled}
              />
            </div>
          </div>
        )}

        <p className="text-[11px] text-slate-500">{t('mail.readOnlyHint')}</p>
      </div>
    </Modal>
  );
}
