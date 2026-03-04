import { Globe, Info, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { SectionHeader } from '../ui/SectionHeader';
import { useState, useEffect } from 'react';
import { Checkbox } from '../ui';
import { ProxyListManager } from './ProxyListManager';
import { useProxyConfig } from '../../hooks/useProxyConfig';
import type { ProxyItem, ProxyType } from '../../types/generated';

interface ProxyItemUI {
  id: string;
  raw: string;
  host: string;
  port: string;
  username?: string;
  password?: string;
  type: 'http' | 'socks5';
  enabled: boolean;
  status?: 'active' | 'error' | 'untested';
  location?: string;
}

export function ProxySettingsSectionV2() {
  const { config, loading, error, save } = useProxyConfig();
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyType, setProxyType] = useState<ProxyType>('http');
  const [proxyList, setProxyList] = useState<ProxyItemUI[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load config into local state (only on initial load)
  useEffect(() => {
    if (config && !isInitialized) {
      queueMicrotask(() => {
        setProxyEnabled(config.enabled);
        setProxyType(config.proxyType);
      });

      // Convert ProxyItem[] to ProxyItemUI[]
      const uiProxies: ProxyItemUI[] = config.proxies.map(p => ({
        id: `${p.host}:${p.port}`,
        raw:
          p.username && p.password
            ? `${p.host}:${p.port}:${p.username}:${p.password}`
            : `${p.host}:${p.port}`,
        host: p.host,
        port: p.port.toString(),
        username: p.username || undefined,
        password: p.password || undefined,
        type: config.proxyType,
        enabled: p.enabled,
        status: 'untested',
      }));

      queueMicrotask(() => {
        setProxyList(uiProxies);
        setIsInitialized(true);
      });
    }
  }, [config, isInitialized]);

  const handleSave = async () => {
    if (!config) return;

    setSaving(true);
    setSaveSuccess(false);

    // Convert ProxyItemUI[] back to ProxyItem[]
    const proxies: ProxyItem[] = proxyList.map(p => ({
      host: p.host,
      port: parseInt(p.port, 10),
      username: p.username || null,
      password: p.password || null,
      enabled: p.enabled,
    }));

    const newConfig = {
      enabled: proxyEnabled,
      proxyType,
      proxies,
    };

    const success = await save(newConfig);

    setSaving(false);

    if (success) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  const handleProxyListChange = (proxies: ProxyItemUI[]) => {
    setProxyList(proxies);
    // Auto-save after change
    setTimeout(() => handleSave(), 500);
  };

  if (loading) {
    return (
      <SectionHeader
        title="Прокси"
        description="Настройте прокси для сетевых запросов."
        icon={<Globe className="w-4 h-4 text-primary" />}
      >
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      </SectionHeader>
    );
  }

  if (error) {
    return (
      <SectionHeader
        title="Прокси"
        description="Настройте прокси для сетевых запросов."
        icon={<Globe className="w-4 h-4 text-primary" />}
      >
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle className="w-4 h-4" />
            <span>Ошибка загрузки: {error}</span>
          </div>
        </div>
      </SectionHeader>
    );
  }

  return (
    <SectionHeader
      title="Прокси"
      description="Настройте прокси для сетевых запросов."
      icon={<Globe className="w-4 h-4 text-primary" />}
    >
      <div className="glass-card rounded-lg p-4 border border-white/10 space-y-4">
        {/* Enable Proxy */}
        <Checkbox
          checked={proxyEnabled}
          onChange={e => {
            setProxyEnabled(e.target.checked);
            setTimeout(() => handleSave(), 500);
          }}
          className="py-0 px-0 hover:bg-transparent"
          label={<span className="text-slate-300 text-sm">Включить прокси</span>}
        />

        {proxyEnabled && (
          <>
            {/* Proxy Type Selection */}
            <div className="space-y-2">
              <div className="text-sm text-slate-400" role="presentation">
                Тип прокси
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setProxyType('http');
                    setTimeout(() => handleSave(), 500);
                  }}
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
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProxyType('socks5');
                    setTimeout(() => handleSave(), 500);
                  }}
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
                </button>
              </div>
            </div>

            {/* Proxy List Manager */}
            <ProxyListManager
              proxies={proxyList}
              onProxiesChange={handleProxyListChange}
              proxyType={proxyType}
            />

            {/* Save Status */}
            {(saving || saveSuccess) && (
              <div
                className={`
                flex items-center gap-2 text-sm p-3 rounded-lg border
                ${
                  saveSuccess
                    ? 'bg-green-500/10 border-green-500/30 text-green-400'
                    : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                }
              `}
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Сохранение...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Сохранено</span>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {/* Info */}
        <div className="flex items-start gap-2 text-xs text-slate-400 bg-slate-800/30 rounded p-3">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <p>Поддерживаемые форматы:</p>
            <ul className="list-disc list-inside space-y-0.5 ml-2">
              <li>
                <code className="text-slate-300">ip:port:username:password</code> - С авторизацией
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
      </div>
    </SectionHeader>
  );
}
