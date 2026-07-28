import { t } from '@/lib/i18n';
import { Tooltip } from '@/components/Tooltip';
import { Input, Select, Button } from '@/components/ui';
import { Mail, Info } from 'lucide-react';
import {
  CollapsibleSection,
} from '@/components/ui';
import type { EmailProviderType } from '@/lib/backend/modules/emailInbox';

export interface InboxProviderSectionProps {
  provider: EmailProviderType;
  onProviderChange: (value: EmailProviderType) => void;
  mailtmAddress: string;
  onMailtmAddressChange: (value: string) => void;
  mailtmPassword: string;
  onMailtmPasswordChange: (value: string) => void;
  mailtmBaseUrl: string;
  onMailtmBaseUrlChange: (value: string) => void;
  session: { sessionId: string; provider: EmailProviderType } | null;
  canConnect: boolean;
  isBusy: boolean;
  disabled?: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  allExpanded: boolean;
}

export function InboxProviderSection({
  provider,
  onProviderChange,
  mailtmAddress,
  onMailtmAddressChange,
  mailtmPassword,
  onMailtmPasswordChange,
  mailtmBaseUrl,
  onMailtmBaseUrlChange,
  session,
  canConnect,
  isBusy,
  disabled,
  onConnect,
  onDisconnect,
  allExpanded,
}: InboxProviderSectionProps) {
  return (
    <CollapsibleSection
      title="Провайдер почты"
      description="Настройки подключения к email"
      icon={<Mail className="w-5 h-5 text-slate-400" />}
      defaultExpanded={allExpanded || true}
      disabled={disabled}
      className="p-3"
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Select
            label="Провайдер"
            value={provider}
            onValueChange={value => onProviderChange(value as EmailProviderType)}
            options={[
              { value: 'imap', label: 'IMAP' },
              { value: 'mail_tm', label: 'Mail.tm' },
            ]}
            disabled={disabled || isBusy || Boolean(session)}
          />
          <Tooltip content="IMAP — подключение к своему ящику, Mail.tm — временная почта">
            <Info className="w-4 h-4 text-slate-500 mt-6" />
          </Tooltip>
        </div>

        {provider === 'mail_tm' && (
          <div className="grid grid-cols-1 gap-2">
            <Tooltip content="Адрес временной почты Mail.tm">
              <Input
                label="Mail.tm адрес"
                value={mailtmAddress}
                onChange={e => onMailtmAddressChange(e.target.value)}
                placeholder="name@domain"
                disabled={disabled || isBusy || Boolean(session)}
              />
            </Tooltip>
            <Tooltip content="Пароль от временной почты Mail.tm">
              <Input
                label="Mail.tm пароль"
                type="password"
                value={mailtmPassword}
                onChange={e => onMailtmPasswordChange(e.target.value)}
                placeholder="пароль"
                disabled={disabled || isBusy || Boolean(session)}
              />
            </Tooltip>
            <Tooltip content="Адрес сервера Mail.tm (оставьте пустым для стандартного)">
              <Input
                label="Mail.tm базовый URL (опционально)"
                value={mailtmBaseUrl}
                onChange={e => onMailtmBaseUrlChange(e.target.value)}
                placeholder="https://api.mail.tm"
                disabled={disabled || isBusy || Boolean(session)}
              />
            </Tooltip>
          </div>
        )}

        <div className="flex gap-2">
          <Tooltip content="Подключиться к почтовому сервису">
            <Button
              variant="primary"
              size="sm"
              onClick={onConnect}
              disabled={!canConnect || disabled || isBusy || Boolean(session)}
            >
              {t('autoReg.inboxProviderSection.connectButton')}
            </Button>
          </Tooltip>
          <Tooltip content="Отключиться от почтового сервиса">
            <Button
              variant="secondary"
              size="sm"
              onClick={onDisconnect}
              disabled={!session || isBusy || disabled}
            >
              {t('autoReg.inboxProviderSection.disconnectButton')}
            </Button>
          </Tooltip>
        </div>

        {session && (
          <div className="text-xs text-slate-400">
            {t('autoReg.inboxProviderSection.sessionLabel')}{': '}<span className="text-slate-200">{session.sessionId}</span>
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
