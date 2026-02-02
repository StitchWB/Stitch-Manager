import { Globe, AlertCircle } from 'lucide-react';
import { SectionHeader } from '../ui/SectionHeader';
import { t } from '../../lib/i18n';

interface ProxySettingsSectionProps {
  proxyEnabled: boolean;
  onProxyEnabledChange: (enabled: boolean) => void;
  proxyUrl: string;
  onProxyUrlChange: (url: string) => void;
  validationError?: string;
  onValidate: (value: string) => void;
}

export function ProxySettingsSection({
  proxyEnabled,
  onProxyEnabledChange,
  proxyUrl,
  onProxyUrlChange,
  validationError,
  onValidate,
}: ProxySettingsSectionProps) {
  return (
    <SectionHeader
      title={t('settings.proxy.title')}
      description={t('settings.proxy.description')}
      icon={<Globe className="w-4 h-4 text-primary" />}
    >
      <div className="glass-card rounded-lg p-4 border border-white/10 space-y-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={proxyEnabled}
            onChange={e => onProxyEnabledChange(e.target.checked)}
            className="w-4 h-4 rounded border-white/20 bg-white/5 text-primary focus:ring-0 focus:ring-offset-0 transition-colors"
          />
          <span className="text-slate-300 text-sm">{t('settings.proxy.enableProxy')}</span>
        </label>
        {proxyEnabled && (
          <div>
            <label className="input-label">{t('settings.proxy.proxyUrl')}</label>
            <input
              type="text"
              value={proxyUrl}
              onChange={e => {
                onProxyUrlChange(e.target.value);
                onValidate(e.target.value);
              }}
              onBlur={e => onValidate(e.target.value)}
              placeholder="http://user:pass@host:port"
              className={`input-ds text-sm transition-all duration-200 ${
                validationError
                  ? 'border-red-500 focus:border-red-500'
                  : 'focus:border-primary'
              }`}
            />
            {validationError && (
              <div className="flex items-center gap-1.5 mt-1.5 text-red-400 text-xs">
                <AlertCircle className="w-3 h-3" />
                {validationError}
              </div>
            )}
          </div>
        )}
      </div>
    </SectionHeader>
  );
}
