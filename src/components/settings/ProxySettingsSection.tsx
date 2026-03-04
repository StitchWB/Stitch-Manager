import { Globe, Info, CheckCircle2, AlertCircle, List } from 'lucide-react';
import { SectionHeader } from '../ui/SectionHeader';
import { Checkbox, Input, Toggle, ButtonBase } from '../ui';
import { t } from '../../lib/i18n';
import { validateProxyString, parseProxyString } from '../../lib/proxyUtils';
import { useState, useEffect } from 'react';
import { ProxyListManager } from './ProxyListManager';

interface ProxyItem {
  id: string;
  raw: string;
  host: string;
  port: string;
  username?: string;
  password?: string;
  type: 'http' | 'socks5';
  enabled: boolean;
  status?: 'active' | 'error' | 'untested';
}

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
  const [parsedProxy, setParsedProxy] = useState<ReturnType<typeof parseProxyString>>(null);
  const [useProxyList, setUseProxyList] = useState(false);
  const [proxyList, setProxyList] = useState<ProxyItem[]>([]);
  const [proxyType, setProxyType] = useState<'http' | 'socks5'>('http');

  useEffect(() => {
    if (proxyUrl && proxyEnabled && !useProxyList) {
      const parsed = parseProxyString(proxyUrl, proxyType);
      queueMicrotask(() => setParsedProxy(parsed));
    } else {
      queueMicrotask(() => setParsedProxy(null));
    }
  }, [proxyUrl, proxyEnabled, useProxyList, proxyType]);

  const handleProxyChange = (value: string) => {
    onProxyUrlChange(value);

    const error = validateProxyString(value);
    if (error) {
      onValidate(value);
    }
  };

  const handleProxyListChange = (proxies: ProxyItem[]) => {
    setProxyList(proxies);

    // Save proxies based on count
    if (proxies.length === 0) {
      // Empty list - clear proxy
      onProxyUrlChange('');
    } else if (proxies.length === 1) {
      // Single proxy - save raw string without format prefix
      onProxyUrlChange(proxies[0].raw);
    } else {
      // Multiple proxies - save as multiline with enabled flag
      // Format: enabled|raw_proxy (one per line)
      const proxyLines = proxies.map(p => `${p.enabled ? '1' : '0'}|${p.raw}`).join('\n');

      onProxyUrlChange(proxyLines);
    }
  };

  // Load proxy list from proxyUrl on mount and when switching to list mode
  useEffect(() => {
    if (useProxyList && proxyUrl) {
      const lines = proxyUrl.split('\n').filter(line => line.trim());
      const loadedProxies: ProxyItem[] = [];

      for (const line of lines) {
        // Check if line has format prefix (enabled|proxy)
        const parts = line.split('|');
        let enabledStr = '1';
        let raw = line;

        if (parts.length === 2 && (parts[0] === '1' || parts[0] === '0')) {
          enabledStr = parts[0];
          raw = parts[1];
        }

        const parsed = parseProxyString(raw, proxyType);
        if (!parsed) continue;

        loadedProxies.push({
          id: `${Date.now()}-${Math.random()}`,
          raw,
          host: parsed.host,
          port: parsed.port,
          username: parsed.username,
          password: parsed.password,
          type: parsed.type,
          enabled: enabledStr === '1',
          status: 'untested',
        });
      }

      if (loadedProxies.length > 0) {
        queueMicrotask(() => setProxyList(loadedProxies));
      }
    } else if (!useProxyList) {
      // Clear list when switching to single mode
      queueMicrotask(() => setProxyList([]));
    }
  }, [useProxyList, proxyUrl, proxyType]);

  return (
    <SectionHeader
      title={t('settings.proxy.title')}
      description={t('settings.proxy.description')}
      icon={<Globe className="w-4 h-4 text-primary" />}
    >
      <div className="glass-card rounded-lg p-4 border border-white/10 space-y-4">
        <Checkbox
          checked={proxyEnabled}
          onChange={e => onProxyEnabledChange(e.target.checked)}
          className="py-0 px-0 hover:bg-transparent"
          label={<span className="text-slate-300 text-sm">{t('settings.proxy.enableProxy')}</span>}
        />

        {proxyEnabled && (
          <>
            {/* Proxy Type Selection */}
            <div className="space-y-2">
              <div className="text-sm text-slate-400" role="presentation">
                Тип прокси
              </div>
              <div className="flex gap-2">
                <ButtonBase
                  type="button"
                  onClick={() => setProxyType('http')}
                  className={`
                    flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all
                    ${
                      proxyType === 'http'
                        ? 'bg-primary text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }
                  `}
                >
                  HTTP
                </ButtonBase>
                <ButtonBase
                  type="button"
                  onClick={() => setProxyType('socks5')}
                  className={`
                    flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all
                    ${
                      proxyType === 'socks5'
                        ? 'bg-primary text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }
                  `}
                >
                  SOCKS5
                </ButtonBase>
              </div>
            </div>

            {/* Mode Toggle */}
            <div className="flex items-center justify-between p-3 bg-slate-800/30 rounded-lg">
              <div className="flex items-center gap-2">
                <List className="w-4 h-4 text-slate-400" />
                <span className="text-sm text-slate-300">Использовать список прокси</span>
              </div>
              <Toggle
                label=""
                checked={useProxyList}
                onChange={checked => setUseProxyList(checked)}
              />
            </div>

            {useProxyList ? (
              /* Proxy List Mode */
              <ProxyListManager
                proxies={proxyList}
                onProxiesChange={handleProxyListChange}
                proxyType={proxyType}
              />
            ) : (
              /* Single Proxy Mode */
              <>
                <Input
                  type="text"
                  label="URL прокси"
                  value={proxyUrl}
                  onChange={e => handleProxyChange(e.target.value)}
                  onBlur={e => onValidate(e.target.value)}
                  placeholder="138.249.63.52:63942:username:password"
                  error={validationError}
                />

                {/* Proxy Status Indicator */}
                {parsedProxy && !validationError && (
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Прокси распознан успешно</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-slate-800/50 rounded p-2">
                        <div className="text-slate-400 mb-1">Хост</div>
                        <div className="text-slate-200 font-mono">{parsedProxy.host}</div>
                      </div>
                      <div className="bg-slate-800/50 rounded p-2">
                        <div className="text-slate-400 mb-1">Порт</div>
                        <div className="text-slate-200 font-mono">{parsedProxy.port}</div>
                      </div>
                      {parsedProxy.username && (
                        <>
                          <div className="bg-slate-800/50 rounded p-2">
                            <div className="text-slate-400 mb-1">Логин</div>
                            <div className="text-slate-200 font-mono">{parsedProxy.username}</div>
                          </div>
                          <div className="bg-slate-800/50 rounded p-2">
                            <div className="text-slate-400 mb-1">Пароль</div>
                            <div className="text-slate-200 font-mono">
                              {'•'.repeat(parsedProxy.password?.length || 0)}
                            </div>
                          </div>
                        </>
                      )}
                      <div className="bg-slate-800/50 rounded p-2">
                        <div className="text-slate-400 mb-1">Тип</div>
                        <div className="text-slate-200 font-mono uppercase">{parsedProxy.type}</div>
                      </div>
                      <div className="bg-slate-800/50 rounded p-2">
                        <div className="text-slate-400 mb-1">Статус</div>
                        <div className="text-green-400 font-medium">✓ Готов</div>
                      </div>
                    </div>
                  </div>
                )}

                {validationError && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-red-400 text-sm">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span>{validationError}</span>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-2 text-xs text-slate-400 bg-slate-800/30 rounded p-3">
                  <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div className="space-y-1">
                    <p>Поддерживаемые форматы:</p>
                    <ul className="list-disc list-inside space-y-0.5 ml-2">
                      <li>
                        <code className="text-slate-300">ip:port:username:password</code> - С
                        авторизацией
                      </li>
                      <li>
                        <code className="text-slate-300">ip:port</code> - Без авторизации
                      </li>
                    </ul>
                    <p className="mt-2">
                      Пример: <code className="text-slate-300">138.249.63.52:63942:user:pass</code>
                    </p>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </SectionHeader>
  );
}
