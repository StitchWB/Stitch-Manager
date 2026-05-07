import { Globe } from 'lucide-react';
import { Button, Select, Toggle } from '@/components/ui';
import { t } from '@/lib/i18n';
import { type ProfileSettingsProxy } from '@/lib/tauri/modules/profiles';
import { type ProxyLibraryEntry } from '@/lib/tauri/modules/proxyLibrary';

interface ProfileProxyTabProps {
  proxyEnabled: boolean;
  proxyMode: 'none' | 'library';
  proxyLibraryId: string;
  proxyLibrary: ProxyLibraryEntry[];
  proxyLibraryLoading: boolean;
  selectedLibraryProxy: ProxyLibraryEntry | null;
  selectedProxyTesting: boolean;
  selectedProxyTestResult: string | null;
  selectedProxyTestError: string | null;
  saving: boolean;
  onPatchProxy: (patch: Partial<ProfileSettingsProxy>) => void;
  onTestSelectedProxy: () => Promise<void>;
  onOpenAddProxyModal: () => void;
}

export function ProfileProxyTab({
  proxyEnabled,
  proxyMode,
  proxyLibraryId,
  proxyLibrary,
  proxyLibraryLoading,
  selectedLibraryProxy,
  selectedProxyTesting,
  selectedProxyTestResult,
  selectedProxyTestError,
  saving,
  onPatchProxy,
  onTestSelectedProxy,
  onOpenAddProxyModal,
}: ProfileProxyTabProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-slate-200 text-sm font-semibold">
          <Globe size={14} /> {t('autoReg.proxy') || 'Proxy'}
        </div>
        <Toggle
          label={t('profileProxy.enabledToggle')}
          checked={proxyEnabled}
          onChange={checked => {
            if (checked) {
              onPatchProxy({ enabled: true });
            } else {
              onPatchProxy({
                enabled: false,
                proxyLibraryId: null,
              });
            }
          }}
        />
      </div>

      {proxyEnabled ? (
        <div className="space-y-3">
          <Select
            label={t('profileProxy.source')}
            value={proxyMode}
            onValueChange={value => {
              if (value === 'none') {
                onPatchProxy({
                  enabled: false,
                  proxyLibraryId: null,
                });
                return;
              }

              if (value === 'library') {
                const first = proxyLibrary[0];
                onPatchProxy({
                  enabled: true,
                  proxyLibraryId: first?.id ?? null,
                });
                return;
              }
            }}
          >
            <option value="none">{t('profileProxy.sourceDisabled')}</option>
            <option value="library">{t('profileProxy.sourceLibrary')}</option>
          </Select>

          {proxyMode === 'library' ? (
            <>
              <Select
                label={t('profileProxy.libraryProxy')}
                value={proxyLibraryId}
                onValueChange={value => onPatchProxy({ proxyLibraryId: value || null })}
                disabled={proxyLibraryLoading || proxyLibrary.length === 0}
              >
                <option value="">
                  {proxyLibraryLoading
                    ? t('profileProxy.loading')
                    : proxyLibrary.length
                      ? t('profileProxy.selectProxy')
                      : t('profileProxy.noEnabledProxies')}
                </option>
                {proxyLibrary.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.label} ({item.proxyType}://{item.host}:{item.port})
                  </option>
                ))}
              </Select>

              <div className="flex items-center justify-between gap-3">
                {selectedLibraryProxy ? (
                  <div className="text-xs text-slate-400 rounded border border-white/10 bg-white/[0.02] p-2">
                    {t('profileProxy.using')}: {selectedLibraryProxy.proxyType}://
                    {selectedLibraryProxy.host}:{selectedLibraryProxy.port}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">
                    {t('profileProxy.noEnabledProxies')}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => void onTestSelectedProxy()}
                    disabled={!selectedLibraryProxy || selectedProxyTesting || saving}
                  >
                    {selectedProxyTesting
                      ? t('profileProxy.addProxyTesting')
                      : t('profileProxy.addProxyTest')}
                  </Button>
                  <Button size="xs" variant="secondary" onClick={onOpenAddProxyModal}>
                    {t('profileProxy.addProxyButton')}
                  </Button>
                </div>
              </div>
              {selectedProxyTestError ? (
                <div className="text-xs text-red-300">{selectedProxyTestError}</div>
              ) : null}
              {selectedProxyTestResult ? (
                <div className="text-xs text-slate-300">{selectedProxyTestResult}</div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : (
        <div className="text-xs text-slate-500">{t('profileProxy.disabledHint')}</div>
      )}
    </section>
  );
}
