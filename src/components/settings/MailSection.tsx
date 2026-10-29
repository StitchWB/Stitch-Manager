import { SegmentedControl } from '@/components/ui';
import { t } from '@/lib/i18n';
import { useSettingsSaveStore } from './shared';
import { saveEmailGenerationDomain } from '@/stores/registration/utils/migration';
import { IMAPSettingsSection } from './IMAPSettingsSection';
import { EmailCounterSection } from './EmailCounterSection';
import { EmailServicesSection } from './EmailServicesSection';
import { ICloudEmailSection } from './ICloudEmailSection';
import { useMailSettings } from './useMailSettings';

export function MailSection() {
  const {
    mailTab,
    setMailTab,
    showPassword,
    setShowPassword,
    imapServer,
    setImapServer,
    imapPort,
    setImapPort,
    imapEmail,
    setImapEmail,
    imapPassword,
    setImapPassword,
    emailGenerationDomain,
    setEmailGenerationDomain,
    addyioEnabled,
    setAddyioEnabled,
    addyioApiToken,
    addyioApiTokenDraft,
    setAddyioApiTokenDraft,
    addyioAliasFormat,
    setAddyioAliasFormat,
    addyioDomain,
    setAddyioDomain,
    addyioAutoDelete,
    setAddyioAutoDelete,
    addyioDefaultRecipientId,
    setAddyioDefaultRecipientId,
    addyioDescriptionTemplate,
    setAddyioDescriptionTemplate,
    addyioFromName,
    setAddyioFromName,
    thirtyThreeMailEnabled,
    setThirtyThreeMailEnabled,
    thirtyThreeMailUsername,
    setThirtyThreeMailUsername,
    thirtyThreeMailDomain,
    setThirtyThreeMailDomain,
    thirtyThreeMailTemplate,
    setThirtyThreeMailTemplate,
    mailtmEnabled,
    setMailtmEnabled,
    icloudEnabled,
    setIcloudEnabled,
    icloudAppleId,
    setIcloudAppleId,
    icloudAppPassword,
    setIcloudAppPassword,
    addyioDomains,
    addyioRecipients,
    addyioAccountInfo,
    isTestingConnection,
    connectionStatus,
    setConnectionStatus,
    connectionMessage,
    emailCounter,
    isLoadingCounter,
    validationErrors,
    debouncedSave,
    validateField,
    handleTestAddyioConnection,
    handleSaveAddyioApiToken,
    handleEmailCounterChange,
    handleICloudSave,
  } = useMailSettings();

  const isSaving = useSettingsSaveStore(state => state.isSaving);

  return (
    <>
      <SegmentedControl
        options={[
          { value: 'imap', label: t('settings.mailTabs.imap') },
          { value: 'aliases', label: t('settings.mailTabs.aliases') },
          { value: 'icloud', label: t('settings.mailTabs.icloud') },
        ]}
        value={mailTab}
        onChange={v => setMailTab(v as 'imap' | 'aliases' | 'icloud')}
        size="sm"
        className="max-w-md"
      />

      {mailTab === 'imap' && (
        <div className="space-y-8">
          <IMAPSettingsSection
            imapServer={imapServer}
            onImapServerChange={server => {
              setImapServer(server);
              debouncedSave();
            }}
            imapPort={imapPort}
            onImapPortChange={port => {
              setImapPort(port);
              debouncedSave();
            }}
            imapEmail={imapEmail}
            onImapEmailChange={email => {
              setImapEmail(email);
              debouncedSave();
            }}
            imapPassword={imapPassword}
            onImapPasswordChange={password => {
              setImapPassword(password);
              debouncedSave();
            }}
            emailGenerationDomain={emailGenerationDomain}
            onEmailGenerationDomainChange={domain => {
              setEmailGenerationDomain(domain);
              saveEmailGenerationDomain(domain);
              debouncedSave();
            }}
            showPassword={showPassword}
            onShowPasswordToggle={() => setShowPassword(!showPassword)}
            validationErrors={validationErrors}
            onValidate={validateField}
          />

          <EmailCounterSection
            emailCounter={emailCounter}
            onEmailCounterChange={handleEmailCounterChange}
            isLoading={isLoadingCounter}
          />
        </div>
      )}

      {mailTab === 'aliases' && (
        <EmailServicesSection
          addyioEnabled={addyioEnabled}
          onAddyioEnabledChange={enabled => {
            setAddyioEnabled(enabled);
            if (enabled) setThirtyThreeMailEnabled(false);
            debouncedSave();
          }}
          addyioApiToken={addyioApiTokenDraft}
          onAddyioApiTokenChange={token => {
            setAddyioApiTokenDraft(token);
            setConnectionStatus('idle');
          }}
          onSaveAddyioApiToken={handleSaveAddyioApiToken}
          isAddyioApiTokenDirty={addyioApiTokenDraft !== addyioApiToken}
          isSavingAddyioApiToken={isSaving}
          addyioAliasFormat={addyioAliasFormat}
          onAddyioAliasFormatChange={format => {
            setAddyioAliasFormat(format);
            debouncedSave();
          }}
          addyioDomain={addyioDomain}
          onAddyioDomainChange={domain => {
            setAddyioDomain(domain);
            debouncedSave();
          }}
          addyioAutoDelete={addyioAutoDelete}
          onAddyioAutoDeleteChange={enabled => {
            setAddyioAutoDelete(enabled);
            debouncedSave();
          }}
          addyioDefaultRecipientId={addyioDefaultRecipientId}
          onAddyioDefaultRecipientIdChange={id => {
            setAddyioDefaultRecipientId(id);
            debouncedSave();
          }}
          addyioDescriptionTemplate={addyioDescriptionTemplate}
          onAddyioDescriptionTemplateChange={template => {
            setAddyioDescriptionTemplate(template);
            debouncedSave();
          }}
          addyioFromName={addyioFromName}
          onAddyioFromNameChange={name => {
            setAddyioFromName(name);
            debouncedSave();
          }}
          addyioDomains={addyioDomains}
          addyioRecipients={addyioRecipients}
          addyioAccountInfo={addyioAccountInfo}
          isTestingConnection={isTestingConnection}
          connectionStatus={connectionStatus}
          connectionMessage={connectionMessage}
          onTestConnection={handleTestAddyioConnection}
          showPassword={showPassword}
          onShowPasswordToggle={() => setShowPassword(!showPassword)}
          thirtyThreeMailEnabled={thirtyThreeMailEnabled}
          onThirtyThreeMailEnabledChange={enabled => {
            setThirtyThreeMailEnabled(enabled);
            if (enabled) setAddyioEnabled(false);
            debouncedSave();
          }}
          thirtyThreeMailUsername={thirtyThreeMailUsername}
          onThirtyThreeMailUsernameChange={username => {
            setThirtyThreeMailUsername(username);
            debouncedSave();
          }}
          thirtyThreeMailDomain={thirtyThreeMailDomain}
          onThirtyThreeMailDomainChange={domain => {
            setThirtyThreeMailDomain(domain);
            debouncedSave();
          }}
          thirtyThreeMailTemplate={thirtyThreeMailTemplate}
          onThirtyThreeMailTemplateChange={template => {
            setThirtyThreeMailTemplate(template);
            debouncedSave();
          }}
          mailtmEnabled={mailtmEnabled}
          onMailtmEnabledChange={enabled => {
            setMailtmEnabled(enabled);
            if (enabled) {
              setAddyioEnabled(false);
              setThirtyThreeMailEnabled(false);
            }
            debouncedSave();
          }}
        />
      )}

      {mailTab === 'icloud' && (
        <ICloudEmailSection
          enabled={icloudEnabled}
          onEnabledChange={enabled => {
            setIcloudEnabled(enabled);
            if (enabled) {
              setAddyioEnabled(false);
              setThirtyThreeMailEnabled(false);
              setMailtmEnabled(false);
            }
            debouncedSave();
          }}
          appleId={icloudAppleId}
          onAppleIdChange={id => {
            setIcloudAppleId(id);
            debouncedSave();
          }}
          appPassword={icloudAppPassword}
          onAppPasswordChange={pw => setIcloudAppPassword(pw)}
          onSave={handleICloudSave}
        />
      )}
    </>
  );
}
