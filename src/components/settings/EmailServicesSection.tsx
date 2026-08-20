import { Shield, Eye, EyeOff, RefreshCw, CheckCircle, AlertCircle, Save } from 'lucide-react';




import { t } from '@/lib/i18n';
import type { AddyIoAccountDetails } from '@/types/generated';
import { Button, ButtonBase, Checkbox, Input, LoadingSpinner, SectionHeader, Select } from '@/components/ui';

interface EmailServicesSectionProps {
  // Addy.io props
  addyioEnabled: boolean;
  onAddyioEnabledChange: (enabled: boolean) => void;
  addyioApiToken: string;
  onAddyioApiTokenChange: (token: string) => void;
  /** Explicit save for secret token field (no auto-save while typing). */
  onSaveAddyioApiToken: () => void | Promise<void>;
  /** Whether the token input differs from the saved token. */
  isAddyioApiTokenDirty: boolean;
  /** Loading state for token save button. */
  isSavingAddyioApiToken?: boolean;
  addyioAliasFormat: string;
  onAddyioAliasFormatChange: (format: string) => void;
  addyioDomain: string;
  onAddyioDomainChange: (domain: string) => void;
  addyioAutoDelete: boolean;
  onAddyioAutoDeleteChange: (enabled: boolean) => void;
  addyioDefaultRecipientId: string;
  onAddyioDefaultRecipientIdChange: (id: string) => void;
  addyioDescriptionTemplate: string;
  onAddyioDescriptionTemplateChange: (template: string) => void;
  addyioFromName: string;
  onAddyioFromNameChange: (name: string) => void;
  addyioDomains: string[];
  addyioRecipients: Array<{id: string;email: string;emailVerifiedAt: string | null;}>;
  addyioAccountInfo: AddyIoAccountDetails | null;
  isTestingConnection: boolean;
  connectionStatus: 'idle' | 'success' | 'error';
  connectionMessage: string;
  onTestConnection: () => void;
  showPassword: boolean;
  onShowPasswordToggle: () => void;

  // 33mail props
  thirtyThreeMailEnabled: boolean;
  onThirtyThreeMailEnabledChange: (enabled: boolean) => void;
  thirtyThreeMailUsername: string;
  onThirtyThreeMailUsernameChange: (username: string) => void;
  thirtyThreeMailDomain: string;
  onThirtyThreeMailDomainChange: (domain: string) => void;
  thirtyThreeMailTemplate: string;
  onThirtyThreeMailTemplateChange: (template: string) => void;

  // Mail.tm props
  mailtmEnabled: boolean;
  onMailtmEnabledChange: (enabled: boolean) => void;
}

export function EmailServicesSection({
  addyioEnabled,
  onAddyioEnabledChange,
  addyioApiToken,
  onAddyioApiTokenChange,
  onSaveAddyioApiToken,
  isAddyioApiTokenDirty,
  isSavingAddyioApiToken = false,
  addyioAliasFormat,
  onAddyioAliasFormatChange,
  addyioDomain,
  onAddyioDomainChange,
  addyioAutoDelete,
  onAddyioAutoDeleteChange,
  addyioDefaultRecipientId,
  onAddyioDefaultRecipientIdChange,
  addyioDescriptionTemplate,
  onAddyioDescriptionTemplateChange,
  addyioFromName,
  onAddyioFromNameChange,
  addyioDomains,
  addyioRecipients,
  addyioAccountInfo,
  isTestingConnection,
  connectionStatus,
  connectionMessage,
  onTestConnection,
  showPassword,
  onShowPasswordToggle,
  thirtyThreeMailEnabled,
  onThirtyThreeMailEnabledChange,
  thirtyThreeMailUsername,
  onThirtyThreeMailUsernameChange,
  thirtyThreeMailDomain,
  onThirtyThreeMailDomainChange,
  thirtyThreeMailTemplate,
  onThirtyThreeMailTemplateChange,
  mailtmEnabled,
  onMailtmEnabledChange
}: EmailServicesSectionProps) {
  return (
    <SectionHeader
      title={t('autoReg.emailAliases')}
      description={t('settings.email_services_section.description')}
      icon={<Shield className="w-4 h-4 text-indigo-400" />}
      className="pt-6 border-t border-white/10">
      
      <div className="space-y-6">
        {/* Addy.io */}
        <div
          className={`glass-card rounded-lg p-4 border border-white/10 space-y-4 transition-opacity duration-200 ${
          !addyioEnabled ? 'opacity-60 hover:opacity-100' : ''}`
          }>
          
          <Checkbox
            checked={addyioEnabled}
            onChange={(e) => {
              onAddyioEnabledChange(e.target.checked);
              if (e.target.checked) onThirtyThreeMailEnabledChange(false);
            }}
            className="py-0 px-0 hover:bg-transparent"
            label={<span className="text-slate-300 text-sm">{t('autoReg.configureAddyio')}</span>} />
          
          {addyioEnabled &&
          <div className="space-y-4 pl-7 animate-in fade-in zoom-in-95 duration-200">
              <Input
              type={showPassword ? 'text' : 'password'}
              label={t('autoReg.addyio.apiToken')}
              value={addyioApiToken}
              onChange={(e) => onAddyioApiTokenChange(e.target.value)}
              placeholder="addy_..."
              rightElement={
              <ButtonBase
                type="button"
                onClick={onShowPasswordToggle}
                className="p-1.5 text-slate-400 hover:text-white">
                
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </ButtonBase>
              } />
            

              <div className="-mt-2 text-[10px] text-slate-500">{t("settings.email_services_section.token_is_sensitive_and_is_not_saved_until_you_clic")}
              {' '}
                <span className="text-slate-300">{t("settings.email_services_section.save_token")}</span>.
              </div>

              {isAddyioApiTokenDirty &&
            <div className="text-[10px] text-amber-300">{t("settings.email_services_section.not_saved_yet")}</div>
            }

              {/* Test Connection Button */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                  onClick={onSaveAddyioApiToken}
                  disabled={isSavingAddyioApiToken || !addyioApiToken || !isAddyioApiTokenDirty}
                  variant="primary"
                  size="sm"
                  leftIcon={
                  isSavingAddyioApiToken ?
                  <LoadingSpinner size="xs" /> :

                  <Save className="w-3 h-3" />

                  }>
                  
                    {isSavingAddyioApiToken ? t('settings.email_services_section.saving') : t('settings.email_services_section.save_token')}
                  </Button>
                  <Button
                  onClick={onTestConnection}
                  disabled={isTestingConnection || !addyioApiToken}
                  variant="secondary"
                  size="sm"
                  leftIcon={
                  isTestingConnection ?
                  <LoadingSpinner size="xs" /> :

                  <RefreshCw className="w-3 h-3" />

                  }>
                  
                    {isTestingConnection ? t('settings.email_services_section.testing') : t('settings.email_services_section.test_connection')}
                  </Button>
                </div>

                {connectionStatus !== 'idle' &&
              <div
                className={`text-xs flex items-center gap-1.5 ${
                connectionStatus === 'success' ? 'text-emerald-400' : 'text-red-400'}`
                }>
                
                    {connectionStatus === 'success' ?
                <CheckCircle className="w-3 h-3" /> :

                <AlertCircle className="w-3 h-3" />
                }
                    {connectionMessage}
                  </div>
              }
              </div>

              {/* Account Status Card */}
              {addyioAccountInfo &&
            <div className="glass-card rounded-lg p-3 border border-indigo-500/20 bg-indigo-500/5 mt-2">
                  <h4 className="text-white font-medium text-xs mb-2 flex items-center gap-2">
                    <CheckCircle className="w-3 h-3 text-emerald-400" />{t("settings.email_services_section.account_status")}

              </h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-slate-500">{t("settings.email_services_section.subscription")}</span>
                      <span className="text-white ml-2 font-medium">
                        {addyioAccountInfo.subscription}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">{t("settings.email_services_section.bandwidth")}</span>
                      <span className="text-white ml-2 font-medium">
                        {(addyioAccountInfo.bandwidth / 1024 / 1024).toFixed(1)}{t("settings.email_services_section.mb")}
                  </span>
                    </div>
                  </div>
                </div>
            }

              {/* Dynamic Fields */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="addyio-domain" className="input-label">{t("settings.email_services_section.domain")}

                </label>
                  {addyioDomains.length > 0 ?
                <Select
                  id="addyio-domain"
                  value={addyioDomain}
                  onChange={(e) => onAddyioDomainChange(e.target.value)}
                  options={[
                  { value: '', label: t('settings.email_services_section.select_domain') },
                  ...addyioDomains.map((d) => ({ value: d, label: d }))]
                  } /> :


                <Input
                  id="addyio-domain"
                  type="text"
                  value={addyioDomain}
                  onChange={(e) => onAddyioDomainChange(e.target.value)}
                  placeholder="anonaddy.me" />

                }
                </div>

                <div>
                  <label htmlFor="addyio-format" className="input-label">{t("settings.email_services_section.format")}

                </label>
                  <Select
                  id="addyio-format"
                  value={addyioAliasFormat}
                  onChange={(e) => onAddyioAliasFormatChange(e.target.value)}
                  options={[
                  { value: 'uuid', label: 'UUID' },
                  { value: 'random_words', label: 'Random Words' },
                  { value: 'random_characters', label: 'Random Chars' }]
                  } />
                
                </div>
              </div>

              {/* Default Recipient */}
              {addyioRecipients.length > 0 &&
            <div>
                  <label htmlFor="addyio-recipient" className="input-label">{t("settings.email_services_section.default_recipient")}

              </label>
                  <Select
                id="addyio-recipient"
                value={addyioDefaultRecipientId}
                onChange={(e) => onAddyioDefaultRecipientIdChange(e.target.value)}
                options={[
                { value: '', label: t('settings.email_services_section.use_account_default') },
                ...addyioRecipients.map((r) => ({
                  value: r.id,
                  label: `${r.email} ${r.emailVerifiedAt ? '✓' : '(unverified)'}`
                }))]
                } />
              
                </div>
            }

              {/* Advanced Options */}
              <div className="grid grid-cols-2 gap-4">
                <Input
                type="text"
                label={t('settings.email_services_section.descriptionTemplate')}
                value={addyioDescriptionTemplate}
                onChange={(e) => onAddyioDescriptionTemplateChange(e.target.value)}
                placeholder="{provider} - {date}" />
              
                <Input
                type="text"
                label={t('settings.email_services_section.fromName')}
                value={addyioFromName}
                onChange={(e) => onAddyioFromNameChange(e.target.value)}
                placeholder="My Alias" />
              
              </div>

              <Checkbox
              checked={addyioAutoDelete}
              onChange={(e) => onAddyioAutoDeleteChange(e.target.checked)}
              className="mt-2 py-0 px-0 hover:bg-transparent"
              label={<span className="text-slate-300 text-sm">{t("settings.email_services_section.autodelete_aliases")}</span>} />
            
            </div>
          }
        </div>

        {/* 33mail */}
        <div
          className={`glass-card rounded-lg p-4 border border-white/10 space-y-4 transition-opacity duration-200 ${
          !thirtyThreeMailEnabled ? 'opacity-60 hover:opacity-100' : ''}`
          }>
          
          <Checkbox
            checked={thirtyThreeMailEnabled}
            onChange={(e) => {
              onThirtyThreeMailEnabledChange(e.target.checked);
              if (e.target.checked) {
                onAddyioEnabledChange(false);
                onMailtmEnabledChange(false);
              }
            }}
            className="py-0 px-0 hover:bg-transparent"
            label={<span className="text-slate-300 text-sm">{t('autoReg.configure33mail')}</span>} />
          
          {thirtyThreeMailEnabled &&
          <div className="space-y-4 pl-7 animate-in fade-in zoom-in-95 duration-200">
              <div className="grid grid-cols-2 gap-4">
                <Input
                type="text"
                label={t('settings.email_services_section.username')}
                value={thirtyThreeMailUsername}
                onChange={(e) => onThirtyThreeMailUsernameChange(e.target.value)}
                placeholder="user" />
              
                <Input
                type="text"
                label={t('settings.email_services_section.domain')}
                value={thirtyThreeMailDomain}
                onChange={(e) => onThirtyThreeMailDomainChange(e.target.value)}
                placeholder="33mail.com" />
              
              </div>
              <Input
              type="text"
              label={t('settings.email_services_section.emailTemplate')}
              value={thirtyThreeMailTemplate}
              onChange={(e) => onThirtyThreeMailTemplateChange(e.target.value)}
              placeholder="{rnd12}" />
            
              <p className="text-xs text-slate-400">{t("settings.email_services_section.placeholders")}
              {'{rndN}'}{t("settings.email_services_section.n_random_chars")}{'{counter}'}, {'{time}'}, {'{name}'}, {'{uuid4}'}, {'{uuid4_8}'}
              </p>
            </div>
          }
        </div>

        {/* Mail.tm */}
        <div
          className={`glass-card rounded-lg p-4 border border-white/10 space-y-4 transition-opacity duration-200 ${
          !mailtmEnabled ? 'opacity-60 hover:opacity-100' : ''}`
          }>
          
          <Checkbox
            checked={mailtmEnabled}
            onChange={(e) => {
              onMailtmEnabledChange(e.target.checked);
              if (e.target.checked) {
                onAddyioEnabledChange(false);
                onThirtyThreeMailEnabledChange(false);
              }
            }}
            className="py-0 px-0 hover:bg-transparent"
            label={<span className="text-slate-300 text-sm">{t("settings.email_services_section.enable_mailtm_temporary_email")}</span>} />
          
          {mailtmEnabled &&
          <div className="pl-7 animate-in fade-in zoom-in-95 duration-200">
              <p className="text-xs text-slate-400">{t("settings.email_services_section.mailtm_provides_free_temporary_email_addresses_no_")}


            </p>
            </div>
          }
        </div>
      </div>
    </SectionHeader>);

}