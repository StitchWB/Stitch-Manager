import { SegmentedControl } from '@/components/ui';
import { t } from '@/lib/i18n';
import { useUIState } from '@/hooks/useUIState';
import { ProxySettingsSectionV2 } from './ProxySettingsSectionV2';
import { ProxyLibrarySection } from './ProxyLibrarySection';

export function ProxySection() {
  const [proxyTab, setProxyTab] = useUIState<'quick' | 'library'>(
    'settings-proxy-tab',
    'quick',
    'session'
  );

  return (
    <>
      <SegmentedControl
        options={[
          { value: 'quick', label: t('settings.proxyTabs.quick') },
          { value: 'library', label: t('settings.proxyTabs.library') },
        ]}
        value={proxyTab}
        onChange={v => setProxyTab(v as 'quick' | 'library')}
        size="sm"
        className="max-w-md"
      />
      {proxyTab === 'quick' ? <ProxySettingsSectionV2 /> : <ProxyLibrarySection />}
    </>
  );
}
