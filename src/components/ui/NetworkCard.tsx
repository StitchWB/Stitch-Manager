import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Info,
} from 'lucide-react';

import { cn } from '../../lib/utils';
import { parseProxyString, validateProxyString } from '../../lib/proxyUtils';
import { t } from '@/lib/i18n';
import { Button, Input, SegmentedControl } from './index';
import { useUIPreferencesStore } from '../../stores/uiPreferences';

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

const CONNECTION_MODE_OPTIONS = [
  { label: 'Прямое', value: 'direct' },
  { label: 'Прокси', value: 'proxy' },
];

const PROXY_TYPE_OPTIONS = [
  { label: 'HTTP', value: 'http' },
  { label: 'SOCKS5', value: 'socks5' },
];

export function NetworkCard({ config, onChange, disabled }: NetworkCardProps) {
  const navigate = useNavigate();
  const [validationError, setValidationError] = useState<string | null>(null);

  const parsedProxy = useMemo(() => {
    if (!config.enabled || !config.url || config.url.includes('\n')) return null;
    return parseProxyString(config.url, config.type);
  }, [config.enabled, config.url, config.type]);

  const connectionMode = config.enabled ? 'proxy' : 'direct';

  const handleModeChange = (mode: string) => {
    onChange({ enabled: mode === 'proxy' });
    if (mode === 'direct') setValidationError(null);
  };

  const handleSingleProxyChange = (value: string) => {
    onChange({ url: value });
    if (!value.trim()) {
      setValidationError(null);
      return;
    }
    setValidationError(validateProxyString(value));
  };

  const openProxyLibrary = () => {
    // Programmatically select the connectivity tab in Settings before navigating
    useUIPreferencesStore.getState().setComponentPreference('settings-active-category', 'connectivity');
    navigate('/settings');
  };

  // Summary of the current proxy list (stored as multiline string)
  const listSummary = useMemo(() => {
    if (!config.url) return null;
    const lines = config.url.split('\n').filter(l => l.trim());
    if (lines.length <= 1) return null;
    const enabled = lines.filter(l => !l.startsWith('0|')).length;
    return `Список: ${enabled} из ${lines.length} включено`;
  }, [config.url]);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Connection mode ── */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Подключение
        </span>
        <SegmentedControl
          options={CONNECTION_MODE_OPTIONS}
          value={connectionMode}
          onChange={handleModeChange}
          disabled={disabled}
        />
      </div>

      {/* ── Proxy settings (only when proxy mode) ── */}
      {config.enabled && (
        <>
          {/* Proxy type */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {t('network.proxyTypeLabel')}
            </span>
            <SegmentedControl
              options={PROXY_TYPE_OPTIONS}
              value={config.type}
              onChange={(v) => onChange({ type: v as 'http' | 'socks5' })}
              size="sm"
              disabled={disabled}
            />
          </div>

          {/* Proxy input — always single proxy here; library is in Settings */}
          <div className="flex flex-col gap-2">
            <Input
              type="text"
              label={listSummary ? `Прокси (из библиотеки: ${listSummary})` : t('network.proxyUrlLabel')}
              value={config.rotationEnabled ? '' : config.url}
              onChange={(e) => handleSingleProxyChange(e.target.value)}
              onBlur={(e) => setValidationError(validateProxyString(e.target.value) ?? null)}
              placeholder="138.249.63.52:63942:user:pass"
              error={validationError ?? undefined}
              disabled={disabled || config.rotationEnabled}
            />

            {config.rotationEnabled && listSummary && (
              <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-800/30 rounded px-2.5 py-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>{listSummary} — управляйте в библиотеке</span>
              </div>
            )}

            {parsedProxy && !validationError && !config.rotationEnabled && (
              <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-2.5 py-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span className="font-mono">{parsedProxy.host}:{parsedProxy.port}</span>
                {parsedProxy.username && (
                  <span className="text-emerald-500/70">· {parsedProxy.username}</span>
                )}
                <span className="ml-auto uppercase text-emerald-500/60">{parsedProxy.type}</span>
              </div>
            )}

            {validationError && (
              <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2.5 py-1.5">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{validationError}</span>
              </div>
            )}
          </div>

          {/* Format hint */}
          <div className={cn(
            'flex items-start gap-2 text-xs text-slate-500 bg-slate-800/20 rounded-lg px-3 py-2',
            validationError && 'hidden'
          )}>
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-600" />
            <span>
              {t('network.supportedFormats')}:{' '}
              <code className="text-slate-400">ip:port:user:pass</code>
              {' или '}
              <code className="text-slate-400">ip:port</code>
            </span>
          </div>

          {/* Library link */}
          <Button
            variant="ghost"
            size="sm"
            onClick={openProxyLibrary}
            disabled={disabled}
            rightIcon={<ExternalLink className="w-3.5 h-3.5" />}
            className="w-full justify-between text-slate-400 hover:text-slate-200 border border-white/[0.06] hover:border-white/[0.12] rounded-lg px-3 py-2 text-xs"
          >
            Библиотека прокси (ротация, тестирование)
          </Button>
        </>
      )}

      {/* Direct connection hint */}
      {!config.enabled && (
        <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-800/20 rounded-lg px-3 py-2">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-600" />
          <span>Трафик идёт напрямую без промежуточного сервера</span>
        </div>
      )}
    </div>
  );
}
