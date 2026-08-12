import { useEffect, useMemo, useState } from 'react';
import { Link2, PlugZap } from 'lucide-react';
import { Button, Checkbox, Input, Modal, Select } from '@/components/ui';
import { t } from '@/lib/i18n';
import type { EmailProviderType } from '@/lib/backend/modules/emailInbox';
import type { MailImapCredentials, MailTmCredentials } from '@/stores/mail';
import { getPresetForKind, type MailboxProviderKind } from '@/lib/mail/providerPresets';

interface MailManualConnectModalProps {
  isOpen: boolean;
  defaultSource?: EmailProviderType;
  /**
   * When set to 'icloud' or 'gmail', the host/port/TLS fields are pre-filled
   * with the known preset and locked, so the user only has to enter their
   * address and app-specific password.
   */
  presetKind?: MailboxProviderKind;
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

const PRESET_TITLE_KEY: Record<'icloud' | 'gmail', string> = {
  icloud: 'mail.presetICloudTitle',
  gmail: 'mail.presetGmailTitle',
};

const PRESET_HINT_KEY: Record<'icloud' | 'gmail', string> = {
  icloud: 'mail.presetICloudHint',
  gmail: 'mail.presetGmailHint',
};

export function MailManualConnectModal({
  isOpen,
  defaultSource,
  presetKind,
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

  const isKnownPreset = presetKind === 'icloud' || presetKind === 'gmail';

  // When the modal opens with a different default source than current, switch,
  // and pre-fill the well-known host/port/TLS for iCloud/Gmail presets.
  useEffect(() => {
    if (!isOpen) return;
    if (hasOpenedOnce) return;
      queueMicrotask(() => {
    setHasOpenedOnce(true);
      });

    if (defaultSource && defaultSource !== source) {
      onSourceChange(defaultSource);
    }

    if (isKnownPreset) {
      const preset = getPresetForKind(presetKind!);
      if (preset) {
        onImapPatch({ host: preset.host, port: preset.port, useTls: preset.useTls });
      }
    }
  }, [
    defaultSource,
    hasOpenedOnce,
    isKnownPreset,
    isOpen,
    onImapPatch,
    onSourceChange,
    presetKind,
    source,
  ]);

  // Reset the once-open flag when modal closes
  useEffect(() => {
    queueMicrotask(() => {
    if (!isOpen) {
      setHasOpenedOnce(false);
    }
    });
  }, [isOpen]);

  const sourceOptions = useMemo(
    () => [
      { value: 'imap', label: t('mail.sourceImap') },
      { value: 'mail_tm', label: t('mail.sourceMailTm') },
    ],
    []
  );

  const modalTitle = isKnownPreset ? t(PRESET_TITLE_KEY[presetKind!]) : t('mail.manualConnectionTitle');
  const usernameLabel = presetKind === 'icloud' ? t('mail.presetAppleId') : t('mail.providerUsername');
  const passwordHint =
    presetKind === 'icloud' || presetKind === 'gmail' ? t('mail.presetAppPasswordHint') : undefined;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
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
        {isKnownPreset ? (
          <p className="text-xs text-slate-400">{t(PRESET_HINT_KEY[presetKind!])}</p>
        ) : (
          <p className="text-xs text-slate-400">{t('mail.manualConnectionDescription')}</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {!isKnownPreset ? (
            <Select
              label={t('mail.sourceLabel')}
              value={source}
              onValueChange={value => onSourceChange(value as EmailProviderType)}
              disabled={controlsDisabled}
              options={sourceOptions}
            />
          ) : null}

          <Input
            label={t('mail.accountIdLabel')}
            value={accountId}
            onChange={event => onAccountIdChange(event.target.value)}
            disabled={controlsDisabled}
          />

          {!isKnownPreset ? (
            <Input
              label={t('mail.mailboxLabel')}
              value={mailbox}
              onChange={event => onMailboxChange(event.target.value)}
              disabled={controlsDisabled || source !== 'imap'}
            />
          ) : null}
        </div>

        {source === 'imap' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label={t('mail.providerHost')}
              value={imapCredentials.host}
              onChange={event => onImapPatch({ host: event.target.value })}
              disabled={controlsDisabled || isKnownPreset}
            />
            <Input
              label={t('mail.providerPort')}
              type="number"
              value={String(imapCredentials.port)}
              onChange={event => onImapPatch({ port: Number(event.target.value) || 0 })}
              disabled={controlsDisabled || isKnownPreset}
            />
            <Input
              label={usernameLabel}
              value={imapCredentials.username}
              onChange={event => onImapPatch({ username: event.target.value })}
              disabled={controlsDisabled}
            />
            <Input
              label={t('mail.providerPassword')}
              type="password"
              hint={passwordHint}
              value={imapCredentials.password}
              onChange={event => onImapPatch({ password: event.target.value })}
              disabled={controlsDisabled}
            />
            <div className="md:col-span-2">
              <Checkbox
                checked={imapCredentials.useTls}
                onChange={event => onImapPatch({ useTls: event.target.checked })}
                label={t('mail.providerUseTls')}
                disabled={controlsDisabled || isKnownPreset}
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
