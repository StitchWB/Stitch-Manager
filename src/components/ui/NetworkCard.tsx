import { useState } from 'react';
import { Wifi, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface NetworkConfig {
  enabled: boolean;
  url: string;
  username?: string;
  password?: string;
}

interface NetworkCardProps {
  config: NetworkConfig;
  onChange: (config: Partial<NetworkConfig>) => void;
  disabled?: boolean;
}

export function NetworkCard({ config, onChange, disabled }: NetworkCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const isReady = !config.enabled || (config.enabled && !!config.url);
  const summary = config.enabled
    ? config.url
      ? `Proxy: ${config.url.slice(0, 30)}${config.url.length > 30 ? '...' : ''}`
      : 'Proxy URL required'
    : 'Direct Connection';

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
          <div className="text-sm font-medium text-slate-200">Network</div>
          {!isExpanded && (
            <div className={cn('text-2xs font-mono truncate', isReady ? 'text-emerald-400' : 'text-amber-400')}>
              {summary}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isReady && !isExpanded && (
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/50" />
          )}
          <ChevronRight
            className={cn(
              'w-4 h-4 text-slate-600 transition-transform duration-200',
              isExpanded && 'rotate-90'
            )}
          />
        </div>
      </button>

      {/* Expandable Content */}
      <div
        className={cn(
          'overflow-hidden transition-all duration-200',
          isExpanded ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="px-4 pb-4 space-y-3 border-t border-white/5">
          {/* Proxy Toggle */}
          <label className="flex items-center justify-between pt-3">
            <span className="text-xs text-slate-400">Use Proxy</span>
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
              disabled={disabled}
              className="w-4 h-4 accent-indigo-500 rounded"
            />
          </label>

          {config.enabled && (
            <>
              {/* Proxy URL */}
              <div>
                <label className="input-label">Proxy URL</label>
                <input
                  type="text"
                  placeholder="http://user:pass@proxy:8080"
                  value={config.url}
                  onChange={(e) => onChange({ url: e.target.value })}
                  disabled={disabled}
                  className="input-ds"
                />
              </div>

              {/* Optional Credentials */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="input-label">Username</label>
                  <input
                    type="text"
                    placeholder="Optional"
                    value={config.username || ''}
                    onChange={(e) => onChange({ username: e.target.value })}
                    disabled={disabled}
                    className="input-ds"
                  />
                </div>
                <div>
                  <label className="input-label">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Optional"
                      value={config.password || ''}
                      onChange={(e) => onChange({ password: e.target.value })}
                      disabled={disabled}
                      className="input-ds pr-8"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400"
                    >
                      {showPassword ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
