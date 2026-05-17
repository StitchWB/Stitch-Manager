import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Info,
  List,
  Settings,
  Wifi,
} from 'lucide-react';

import { cn } from '../../lib/utils';
import { parseProxyString, validateProxyString } from '../../lib/proxyUtils';
import { t } from '@/lib/i18n';
import { Button, Checkbox, Input, SegmentedControl, Toggle } from './index';
import { ProxyListManager } from '../settings/ProxyListManager';

export interface NetworkConfig {
  enabled: boolean;
  url: string;
  username?: string;
  password?: string;
  type: 'http' | 'socks5';
  list: string;
  rotationEnabled: boolean;
}

interface NetworkCardProps {
  config: NetworkConfig;
  onChange: (config: Partial<NetworkConfig>) => void;
  disabled?: boolean;
}

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

const PROXY_TYPE_OPTIONS = [
  { label: 'HTTP', value: 'http' },
  { label: 'SOCKS5', value: 'socks5' },
];

/**
 * Serialise list of proxies into a single multi-line string compatible with
 * the existing storage format used by ProxySettingsSection / settings DB:
 *  - empty list           -> ''
 *  - single proxy         -> raw
 *  - multiple proxies     -> '1|raw\n0|raw\n...' (1 = enabled, 0 = disabled)
 */
function serialiseProxyList(proxies: ProxyItem[]): string {
  if (proxies.length === 0) return '';
  if (proxies.length === 1) return proxies[0].raw;
  return proxies.map((p) => `${p.enabled ? '1' : '0'}|${p.raw}`).join('\n');
}

function deserialiseProxyList(stored: string, defaultType: 'http' | 'socks5'): ProxyItem[] {
  if (!stored) return [];

  const lines = stored.split('\n').map((l) => l.trim()).filter(Boolean);
  const items: ProxyItem[] = [];

  for (const line of lines) {
    let enabled = true;
    let raw = line;

    const parts = line.split('|');
    if (parts.length === 2 && (parts[0] === '0' || parts[0] === '1')) {
      enabled = parts[0] === '1';
      raw = parts[1];
    }

    const parsed = parseProxyString(raw, defaultType);
    if (!parsed) continue;

    items.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      raw,
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      password: parsed.password,
      type: parsed.type,
      enabled,
      status: 'untested',
    });
  }

  return items;
}

export function NetworkCard({ config, onChange, disabled }: NetworkCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const navigate = useNavigate();

  // List vs single mode is inferred from stored value (multiline => list)
  const initialIsList = useMemo(() => {
    return config.url.includes('\n') || config.rotationEnabled;
  }, [config.url, config.rotationEnabled]);

  const [useProxyList, setUseProxyList] = useState(initialIsList);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [proxyList, setProxyList] = useState<ProxyItem[]>(() =>
    initialIsList ? deserialiseProxyList(config.url, config.type) : []
  );

  // Re-sync when external config changes (e.g. parent reset)
  useEffect(() => {
    if (useProxyList) {
      const items = deserialiseProxyList(config.url, config.type);
      queueMicrotask(() => setProxyList(items));
    }
  }, [useProxyList, config.url, config.type]);

  const parsedProxy = useMemo(() => {
    if (!config.enabled || useProxyList || !config.url || config.url.includes('\n')) {
      return null;
    }
    return parseProxyString(config.url, config.type);
  }, [config.enabled, config.url, config.type, useProxyList]);

  const isReady = !config.enabled || (config.enabled && !!config.url && !validationError);

  const summary = useMemo(() => {
    if (!config.enabled) return t('network.directConnection');
    if (useProxyList) {
      const total = proxyList.length;
      const active = proxyList.filter((p) => p.enabled).length;
      if (total === 0) return t('network.proxyNotConfigured');
      return t('network.proxyListSummary', { active, total });
    }
    if (!config.url) return t('network.proxyNotConfigured');
    const trimmed = config.url.length > 32 ? `${config.url.slice(0, 32)}...` : config.url;
    return `${t('network.proxyLabel')} ${trimmed}`;
  }, [config.enabled, config.url, useProxyList, proxyList]);

  const handleSingleProxyChange = (value: string) => {
    onChange({ url: value });
    if (!value.trim()) {
      setValidationError(null);
      return;
    }
    setValidationError(validateProxyString(value));
  };

  const handleProxyListChange = (next: ProxyItem[]) => {
    setProxyList(next);
    onChange({
      url: serialiseProxyList(next),
      rotationEnabled: next.length > 1,
    });
  };

  const handleToggleListMode = (enabled: boolean) => {
    setUseProxyList(enabled);
    setValidationError(null);
    if (enabled) {
      // Promote single value to list (if any)
      const items = deserialiseProxyList(config.url, config.type);
      setProxyList(items);
      onChange({ rotationEnabled: items.length > 1 });
    } else {
      // Collapse first enabled list item to single proxy url
      const first = proxyList.find((p) => p.enabled) ?? proxyList[0];
      onChange({
        url: first?.raw ?? '',
        rotationEnabled: false,
      });
    }
  };

  return (
    <div className="card border border-white/5">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        disabled={disabled}
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
      >
        <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
          <Wifi className={cn('w-4 h-4', isReady ? 'text-emerald-400' : 'text-amber-400')} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-slate-200">{t('network.title')}</h3>
            {config.enabled && (
              <span className="text-2xs px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {t('network.proxyEnabled')}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 truncate mt-0.5">{summary}</p>
        </div>

        <ChevronRight
          className={cn(
            'w-4 h-4 text-slate-500 transition-transform',
            isExpanded && 'rotate-90'
          )}
        />
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-white/5 pt-4">
          <Checkbox
            checked={config.enabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            disabled={disabled}
            className="py-0 px-0 hover:bg-transparent"
            label={<span className="text-sm text-slate-300">{t('network.useProxy')}</span>}
          />

          {config.enabled && (
            <>
              <div className="space-y-2">
                <div className="text-xs text-slate-400">{t('network.proxyTypeLabel')}</div>
                <SegmentedControl
                  options={PROXY_TYPE_OPTIONS}
                  value={config.type}
                  onChange={(v) => onChange({ type: v as 'http' | 'socks5' })}
                  size="sm"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-800/30 rounded-lg">
                <div className="flex items-center gap-2 text-sm text-slate-300">
                  <List className="w-4 h-4 text-slate-400" />
                  <span>{t('network.useProxyListLabel')}</span>
                </div>
                <Toggle
                  label=""
                  checked={useProxyList}
                  onChange={handleToggleListMode}
                />
              </div>

              {useProxyList ? (
                <ProxyListManager
                  proxies={proxyList}
                  onProxiesChange={handleProxyListChange}
                  proxyType={config.type}
                />
              ) : (
                <div className="space-y-3">
                  <Input
                    type="text"
                    label={t('network.proxyUrlLabel')}
                    value={config.url}
                    onChange={(e) => handleSingleProxyChange(e.target.value)}
                    onBlur={(e) => {
                      const err = validateProxyString(e.target.value);
                      setValidationError(err);
                    }}
                    placeholder="138.249.63.52:63942:user:pass"
                    error={validationError ?? undefined}
                    disabled={disabled}
                  />

                  {parsedProxy && !validationError && (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{t('network.proxyRecognized')}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-slate-800/50 rounded p-2">
                          <div className="text-slate-400 mb-1">{t('network.hostLabel')}</div>
                          <div className="text-slate-200 font-mono">{parsedProxy.host}</div>
                        </div>
                        <div className="bg-slate-800/50 rounded p-2">
                          <div className="text-slate-400 mb-1">{t('network.portLabel')}</div>
                          <div className="text-slate-200 font-mono">{parsedProxy.port}</div>
                        </div>
                        {parsedProxy.username && (
                          <>
                            <div className="bg-slate-800/50 rounded p-2">
                              <div className="text-slate-400 mb-1">{t('network.loginLabel')}</div>
                              <div className="text-slate-200 font-mono">{parsedProxy.username}</div>
                            </div>
                            <div className="bg-slate-800/50 rounded p-2">
                              <div className="text-slate-400 mb-1">{t('network.passwordLabel')}</div>
                              <div className="text-slate-200 font-mono">
                                {'•'.repeat(parsedProxy.password?.length ?? 0)}
                              </div>
                            </div>
                          </>
                        )}
                        <div className="bg-slate-800/50 rounded p-2">
                          <div className="text-slate-400 mb-1">{t('network.proxyTypeLabel')}</div>
                          <div className="text-slate-200 font-mono uppercase">{parsedProxy.type}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {validationError && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                      <div className="flex items-start gap-2 text-red-400 text-sm">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <span className="whitespace-pre-line">{validationError}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex items-start gap-2 text-xs text-slate-400 bg-slate-800/30 rounded p-3">
                    <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <div className="space-y-1">
                      <p>{t('network.supportedFormats')}</p>
                      <ul className="list-disc list-inside space-y-0.5 ml-2">
                        <li>
                          <code className="text-slate-300">{'ip:port:username:password'}</code>
                          {' — '}
                          {t('network.withAuth')}
                        </li>
                        <li>
                          <code className="text-slate-300">{'ip:port'}</code>
                          {' — '}
                          {t('network.withoutAuth')}
                        </li>
                      </ul>
                      <p className="mt-2">
                        {t('network.example')}
                        {': '}
                        <code className="text-slate-300">{'138.249.63.52:63942:user:pass'}</code>
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-slate-800/30 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">{t('network.currentProxy')}</span>
                  {config.url && !validationError ? (
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <span className="text-xs text-amber-400">{t('network.notConfigured')}</span>
                  )}
                </div>
                {config.url && !config.url.includes('\n') && (
                  <div className="text-xs font-mono text-slate-300 break-all">{config.url}</div>
                )}
              </div>

              <Button
                variant="secondary"
                onClick={() => navigate('/settings')}
                className="w-full"
                leftIcon={<Settings className="w-4 h-4" />}
                rightIcon={<ExternalLink className="w-3.5 h-3.5" />}
              >
                {t('network.configureProxy')}
              </Button>

              <p className="text-xs text-slate-500 text-center">
                {t('network.proxySettingsHint')}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
