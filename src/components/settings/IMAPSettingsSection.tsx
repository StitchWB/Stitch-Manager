import { Server, Eye, EyeOff } from 'lucide-react';


import { t } from '../../lib/i18n';
import { ButtonBase, Input, SectionHeader } from '@/components/ui';

interface IMAPSettingsSectionProps {
  imapServer: string;
  onImapServerChange: (server: string) => void;
  imapPort: string;
  onImapPortChange: (port: string) => void;
  imapEmail: string;
  onImapEmailChange: (email: string) => void;
  imapPassword: string;
  onImapPasswordChange: (password: string) => void;
  emailGenerationDomain?: string;
  onEmailGenerationDomainChange?: (domain: string) => void;
  showPassword: boolean;
  onShowPasswordToggle: () => void;
  validationErrors: Record<string, string>;
  onValidate: (field: string, value: string) => void;
}

export function IMAPSettingsSection({
  imapServer,
  onImapServerChange,
  imapPort,
  onImapPortChange,
  imapEmail,
  onImapEmailChange,
  imapPassword,
  onImapPasswordChange,
  emailGenerationDomain,
  onEmailGenerationDomainChange,
  showPassword,
  onShowPasswordToggle,
  validationErrors,
  onValidate,
}: IMAPSettingsSectionProps) {
  return (
    <SectionHeader
      title={t('settings.imap.title')}
      description={t('settings.imap.description')}
      icon={<Server className="w-4 h-4 text-primary" />}
      className="pt-6 border-t border-white/10"
    >
      <div className="grid grid-cols-2 gap-4">
        <Input
          type="text"
          label={t('settings.imap.server')}
          value={imapServer}
          onChange={e => {
            onImapServerChange(e.target.value);
            onValidate('imapServer', e.target.value);
          }}
          onBlur={e => onValidate('imapServer', e.target.value)}
          placeholder="imap.example.com"
          error={validationErrors.imapServer}
        />
        <Input
          type="text"
          label={t('settings.imap.port')}
          value={imapPort}
          onChange={e => {
            onImapPortChange(e.target.value);
            onValidate('imapPort', e.target.value);
          }}
          error={validationErrors.imapPort}
        />
        <Input
          type="email"
          label={t('settings.imap.emailAddress')}
          value={imapEmail}
          onChange={e => {
            onImapEmailChange(e.target.value);
            onValidate('imapEmail', e.target.value);
          }}
          error={validationErrors.imapEmail}
        />
        <Input
          type={showPassword ? 'text' : 'password'}
          label={t('settings.imap.password')}
          value={imapPassword}
          onChange={e => onImapPasswordChange(e.target.value)}
          placeholder="••••••••"
          rightElement={
            <ButtonBase
              type="button"
              onClick={onShowPasswordToggle}
              className="p-1.5 text-slate-400 hover:text-white"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </ButtonBase>
          }
        />
        <Input
          type="text"
          label={t('settings.imap.emailGenerationDomain')}
          value={emailGenerationDomain || ''}
          onChange={e => onEmailGenerationDomainChange?.(e.target.value)}
          placeholder="customdomain.com (optional)"
          containerClassName="col-span-2"
        />
      </div>
    </SectionHeader>
  );
}
