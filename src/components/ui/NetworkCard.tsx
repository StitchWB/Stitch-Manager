import { useState } from 'react';
import { Wifi, ChevronRight, Settings, CheckCircle, ExternalLink } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useNavigate } from 'react-router-dom';
import { Button } from './Button';

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

export function NetworkCard({ 
  config, 
  onChange, 
  disabled,
}: NetworkCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const navigate = useNavigate();

  const isReady = !config.enabled || (config.enabled && !!config.url);
  const summary = config.enabled
    ? config.url
      ? `Прокси: ${config.url.slice(0, 30)}${config.url.length > 30 ? '...' : ''}`
      : 'Прокси не настроен'
    : 'Прямое подключение';

  return (
    <div className="card border border-white/5">
      {/* Compact Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        disabled={disabled}
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
      >
        <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
          <Wifi className={cn('w-4 h-4', isReady ? 'text-emerald-400' : 'text-amber-400')} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-slate-200">Сеть</h3>
            {config.enabled && (
              <span className="text-2xs px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Прокси включен
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

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-white/5 pt-4">
          {/* Enable Proxy Toggle */}
          <label className="flex items-center justify-between">
            <span className="text-sm text-slate-300">Использовать прокси</span>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
              disabled={disabled}
              className="w-4 h-4 rounded border-white/20 bg-white/5 text-primary focus:ring-0"
            />
          </label>

          {config.enabled && (
            <>
              {/* Current Proxy Status */}
              <div className="bg-slate-800/30 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Текущий прокси:</span>
                  {config.url ? (
                    <CheckCircle className="w-4 h-4 text-green-400" />
                  ) : (
                    <span className="text-xs text-amber-400">Не настроен</span>
                  )}
                </div>
                {config.url && (
                  <div className="text-xs font-mono text-slate-300 break-all">
                    {config.url}
                  </div>
                )}
              </div>

              {/* Configure Proxy Button */}
              <Button
                variant="secondary"
                onClick={() => navigate('/settings')}
                className="w-full"
                leftIcon={<Settings className="w-4 h-4" />}
                rightIcon={<ExternalLink className="w-3.5 h-3.5" />}
              >
                Настроить прокси
              </Button>

              <p className="text-xs text-slate-500 text-center">
                Прокси настраивается в разделе Настройки → Связь → Прокси
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
