import { Globe } from 'lucide-react';
import { SectionHeader } from '../ui/SectionHeader';
import { Input } from '../ui';
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
          <Input
            type="text"
            label={t('settings.proxy.proxyUrl')}
            value={proxyUrl}
            onChange={e => {
              onProxyUrlChange(e.target.value);
              onValidate(e.target.value);
            }}
            onBlur={e => onValidate(e.target.value)}
            placeholder="http://user:pass@host:port"
            error={validationError}
          />
        )}
      </div>
    </SectionHeader>
  );
}
