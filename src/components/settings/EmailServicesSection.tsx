import { Shield, Eye, EyeOff, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { SectionHeader } from '../ui/SectionHeader';
import { Button } from '../ui/Button';
import { LoadingSpinner, Input } from '../ui';
import { Select } from '../ui/Select';
import { t } from '../../lib/i18n';

interface EmailServicesSectionProps {
  // Addy.io props
  addyioEnabled: boolean;
  onAddyioEnabledChange: (enabled: boolean) => void;
  addyioApiToken: string;
  onAddyioApiTokenChange: (token: string) => void;
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
  addyioRecipients: Array<{ id: string; email: string; emailVerifiedAt: string | null }>;
  addyioAccountInfo: any;
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
}

export function EmailServicesSection({
  addyioEnabled,
  onAddyioEnabledChange,
  addyioApiToken,
  onAddyioApiTokenChange,
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
}: EmailServicesSectionProps) {
  return (
    <SectionHeader
      title={t('autoReg.emailAliases')}
      description="Configure third-party email alias services."
      icon={<Shield className="w-4 h-4 text-indigo-400" />}
      className="pt-6 border-t border-white/10"
    >
      <div className="space-y-6">
        {/* Addy.io */}
        <div
          className={`glass-card rounded-lg p-4 border border-white/10 space-y-4 transition-opacity duration-200 ${
            !addyioEnabled ? 'opacity-60 hover:opacity-100' : ''
          }`}
        >
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={addyioEnabled}
              onChange={e => {
                onAddyioEnabledChange(e.target.checked);
                if (e.target.checked) onThirtyThreeMailEnabledChange(false);
              }}
              className="w-4 h-4 rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-0 transition-colors"
            />
            <span className="text-slate-300 text-sm">{t('autoReg.configureAddyio')}</span>
          </label>
          {addyioEnabled && (
            <div className="space-y-4 pl-7 animate-in fade-in zoom-in-95 duration-200">
              <Input
                type={showPassword ? 'text' : 'password'}
                label="API Token"
                value={addyioApiToken}
                onChange={e => onAddyioApiTokenChange(e.target.value)}
                placeholder="addy_..."
                rightElement={
                  <button
                    type="button"
                    onClick={onShowPasswordToggle}
                    className="p-1.5 text-slate-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                }
              />

              {/* Test Connection Button */}
              <div className="flex flex-col gap-2">
                <Button
                  onClick={onTestConnection}
                  disabled={isTestingConnection || !addyioApiToken}
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  leftIcon={
                    isTestingConnection ? (
                      <LoadingSpinner size="xs" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )
                  }
                >
                  {isTestingConnection ? 'Testing...' : 'Test Connection'}
                </Button>

                {connectionStatus !== 'idle' && (
                  <div
                    className={`text-xs flex items-center gap-1.5 ${
                      connectionStatus === 'success' ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {connectionStatus === 'success' ? (
                      <CheckCircle className="w-3 h-3" />
                    ) : (
                      <AlertCircle className="w-3 h-3" />
                    )}
                    {connectionMessage}
                  </div>
                )}
              </div>

              {/* Account Status Card */}
              {addyioAccountInfo && (
                <div className="glass-card rounded-lg p-3 border border-indigo-500/20 bg-indigo-500/5 mt-2">
                  <h4 className="text-white font-medium text-xs mb-2 flex items-center gap-2">
                    <CheckCircle className="w-3 h-3 text-emerald-400" />
                    Account Status
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-slate-500">Subscription:</span>
                      <span className="text-white ml-2 font-medium">
                        {addyioAccountInfo.subscription}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Bandwidth:</span>
                      <span className="text-white ml-2 font-medium">
                        {(addyioAccountInfo.bandwidth / 1024 / 1024).toFixed(1)} MB
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Dynamic Fields */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Domain</label>
                  {addyioDomains.length > 0 ? (
                    <Select
                      value={addyioDomain}
                      onChange={e => onAddyioDomainChange(e.target.value)}
                      options={[
                        { value: '', label: 'Select domain...' },
                        ...addyioDomains.map(d => ({ value: d, label: d })),
                      ]}
                    />
                  ) : (
                    <Input
                      type="text"
                      value={addyioDomain}
                      onChange={e => onAddyioDomainChange(e.target.value)}
                      placeholder="anonaddy.me"
                    />
                  )}
                </div>

                <div>
                  <label className="input-label">Format</label>
                  <Select
                    value={addyioAliasFormat}
                    onChange={e => onAddyioAliasFormatChange(e.target.value)}
                    options={[
                      { value: 'uuid', label: 'UUID' },
                      { value: 'random_words', label: 'Random Words' },
                      { value: 'random_characters', label: 'Random Chars' },
                    ]}
                  />
                </div>
              </div>

              {/* Default Recipient */}
              {addyioRecipients.length > 0 && (
                <div>
                  <label className="input-label">Default Recipient</label>
                  <Select
                    value={addyioDefaultRecipientId}
                    onChange={e => onAddyioDefaultRecipientIdChange(e.target.value)}
                    options={[
                      { value: '', label: 'Use account default' },
                      ...addyioRecipients.map(r => ({
                        value: r.id,
                        label: `${r.email} ${r.emailVerifiedAt ? '✓' : '(unverified)'}`,
                      })),
                    ]}
                  />
                </div>
              )}

              {/* Advanced Options */}
              <div className="grid grid-cols-2 gap-4">
                <Input
                  type="text"
                  label="Description Template"
                  value={addyioDescriptionTemplate}
                  onChange={e => onAddyioDescriptionTemplateChange(e.target.value)}
                  placeholder="{provider} - {date}"
                />
                <Input
                  type="text"
                  label="From Name"
                  value={addyioFromName}
                  onChange={e => onAddyioFromNameChange(e.target.value)}
                  placeholder="My Alias"
                />
              </div>

              <label className="flex items-center gap-3 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={addyioAutoDelete}
                  onChange={e => onAddyioAutoDeleteChange(e.target.checked)}
                  className="w-4 h-4 rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-0 transition-colors"
                />
                <span className="text-slate-300 text-sm">Auto-delete aliases</span>
              </label>
            </div>
          )}
        </div>

        {/* 33mail */}
        <div
          className={`glass-card rounded-lg p-4 border border-white/10 space-y-4 transition-opacity duration-200 ${
            !thirtyThreeMailEnabled ? 'opacity-60 hover:opacity-100' : ''
          }`}
        >
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={thirtyThreeMailEnabled}
              onChange={e => {
                onThirtyThreeMailEnabledChange(e.target.checked);
                if (e.target.checked) onAddyioEnabledChange(false);
              }}
              className="w-4 h-4 rounded border-white/20 bg-white/5 text-purple-500 focus:ring-0 transition-colors"
            />
            <span className="text-slate-300 text-sm">{t('autoReg.configure33mail')}</span>
          </label>
          {thirtyThreeMailEnabled && (
            <div className="space-y-4 pl-7 animate-in fade-in zoom-in-95 duration-200">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  type="text"
                  label="Username"
                  value={thirtyThreeMailUsername}
                  onChange={e => onThirtyThreeMailUsernameChange(e.target.value)}
                  placeholder="user"
                />
                <Input
                  type="text"
                  label="Domain"
                  value={thirtyThreeMailDomain}
                  onChange={e => onThirtyThreeMailDomainChange(e.target.value)}
                  placeholder="33mail.com"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </SectionHeader>
  );
}
