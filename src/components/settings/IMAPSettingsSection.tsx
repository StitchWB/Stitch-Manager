import { Server, Eye, EyeOff } from 'lucide-react';
import { SectionHeader } from '../ui/SectionHeader';
import { t } from '../../lib/i18n';

interface IMAPSettingsSectionProps {
  imapServer: string;
  onImapServerChange: (server: string) => void;
  imapPort: string;
  onImapPortChange: (port: string) => void;
  imapEmail: string;
  onImapEmailChange: (email: string) => void;
  imapPassword: string;
  onImapPasswordChange: (password: string) => void;
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
        <div>
          <label className="input-label">{t('settings.imap.server')}</label>
          <input
            type="text"
            value={imapServer}
            onChange={e => {
              onImapServerChange(e.target.value);
              onValidate('imapServer', e.target.value);
            }}
            onBlur={e => onValidate('imapServer', e.target.value)}
            placeholder="imap.example.com"
            className={`input-ds text-sm transition-all duration-200 ${
              validationErrors.imapServer ? 'border-red-500' : 'focus:border-primary'
            }`}
          />
        </div>
        <div>
          <label className="input-label">{t('settings.imap.port')}</label>
          <input
            type="text"
            value={imapPort}
            onChange={e => {
              onImapPortChange(e.target.value);
              onValidate('imapPort', e.target.value);
            }}
            className="input-ds text-sm transition-all duration-200"
          />
        </div>
        <div>
          <label className="input-label">{t('settings.imap.emailAddress')}</label>
          <input
            type="email"
            value={imapEmail}
            onChange={e => {
              onImapEmailChange(e.target.value);
              onValidate('imapEmail', e.target.value);
            }}
            className="input-ds text-sm transition-all duration-200"
          />
        </div>
        <div>
          <label className="input-label">{t('settings.imap.password')}</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={imapPassword}
              onChange={e => onImapPasswordChange(e.target.value)}
              placeholder="••••••••"
              className="input-ds text-sm pr-10 transition-all duration-200"
            />
            <button
              type="button"
              onClick={onShowPasswordToggle}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-white"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </SectionHeader>
  );
}
