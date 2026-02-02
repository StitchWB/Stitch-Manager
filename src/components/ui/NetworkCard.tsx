import { useState } from 'react';
import { Wifi, ChevronRight, Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { t } from '../../lib/i18n';
import { LoadingSpinner } from './LoadingSpinner';
import { Input } from './Input';

export interface NetworkConfig {
  enabled: boolean;
  url: string;
  username?: string;
  password?: string;
}

export type TestConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

interface NetworkCardProps {
  config: NetworkConfig;
  onChange: (config: Partial<NetworkConfig>) => void;
  onTest?: () => Promise<boolean> | void;
  disabled?: boolean;
  testStatus?: TestConnectionStatus;
  testError?: string;
}

export function NetworkCard({ 
  config, 
  onChange, 
  onTest,
  disabled,
  testStatus: externalTestStatus,
  testError: externalTestError,
}: NetworkCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [internalTestStatus, setInternalTestStatus] = useState<TestConnectionStatus>('idle');
  const [internalTestError, setInternalTestError] = useState<string>('');
  
  // Use external status if provided, otherwise use internal
  const testStatus = externalTestStatus ?? internalTestStatus;
  const testError = externalTestError ?? internalTestError;

  const isReady = !config.enabled || (config.enabled && !!config.url);
  const summary = config.enabled
    ? config.url
      ? `Proxy: ${config.url.slice(0, 30)}${config.url.length > 30 ? '...' : ''}`
      : t('autoReg.proxyUrlRequired')
    : t('autoReg.directConnection');

  // Handle test connection
  const handleTest = async () => {
    if (!onTest) return;
    
    if (externalTestStatus !== undefined) {
      // External state management - just call onTest
      onTest();
      return;
    }
    
    // Internal state management
    setInternalTestStatus('testing');
    setInternalTestError('');
    try {
      const result = await onTest();
      if (result === false) {
        setInternalTestStatus('error');
        setInternalTestError('Connection failed');
      } else {
        setInternalTestStatus('success');
      }
      // Auto-reset after 3 seconds
      setTimeout(() => {
        setInternalTestStatus('idle');
        setInternalTestError('');
      }, 3000);
    } catch (err) {
      setInternalTestStatus('error');
      setInternalTestError(err instanceof Error ? err.message : 'Connection failed');
      // Auto-reset after 5 seconds
      setTimeout(() => {
        setInternalTestStatus('idle');
        setInternalTestError('');
      }, 5000);
    }
  };

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
          <div className="text-sm font-medium text-slate-200">{t('autoReg.network')}</div>
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
            <span className="text-xs text-slate-400">{t('autoReg.useProxy')}</span>
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
              <Input
                type="text"
                label={t('autoReg.proxyUrl')}
                placeholder={t('autoReg.placeholders.proxyUrl')}
                value={config.url}
                onChange={(e) => onChange({ url: e.target.value })}
                disabled={disabled}
              />

              {/* Optional Credentials */}
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="text"
                  label={t('autoReg.username')}
                  placeholder={t('autoReg.placeholders.optional')}
                  value={config.username || ''}
                  onChange={(e) => onChange({ username: e.target.value })}
                  disabled={disabled}
                />
                <Input
                  type={showPassword ? 'text' : 'password'}
                  label={t('accounts.password')}
                  placeholder={t('autoReg.placeholders.optional')}
                  value={config.password || ''}
                  onChange={(e) => onChange({ password: e.target.value })}
                  disabled={disabled}
                  rightElement={
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-slate-600 hover:text-slate-400 p-1"
                    >
                      {showPassword ? (
                        <EyeOff className="w-3.5 h-3.5" />
                      ) : (
                        <Eye className="w-3.5 h-3.5" />
                      )}
                    </button>
                  }
                />
              </div>

              {/* Test Connection Button */}
              {onTest && (
                <div className="flex items-center justify-between pt-2">
                  <div className="h-4 flex items-center">
                    {testStatus === 'success' && (
                      <span className="text-2xs text-emerald-500 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        {t('autoReg.connected')}
                      </span>
                    )}
                    {testStatus === 'error' && (
                      <span className="text-2xs text-red-500 flex items-center gap-1" title={testError}>
                        <XCircle className="w-3 h-3" />
                        {testError || t('status.failed')}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={handleTest}
                    disabled={!isReady || disabled || testStatus === 'testing'}
                    className={cn(
                      "text-xs py-1.5 px-3 rounded-md border transition-colors flex items-center gap-1.5",
                      "border-white/10 text-slate-400 hover:text-white hover:border-white/20",
                      "disabled:opacity-50 disabled:cursor-not-allowed",
                      testStatus === 'success' && "border-emerald-500/30 text-emerald-400",
                      testStatus === 'error' && "border-red-500/30 text-red-400"
                    )}
                  >
                    {testStatus === 'testing' ? (
                      <>
                        <LoadingSpinner size="xs" />
                        {t('autoReg.testing')}
                      </>
                    ) : testStatus === 'success' ? (
                      <>
                        <CheckCircle className="w-3 h-3" />
                        {t('autoReg.success')}
                      </>
                    ) : testStatus === 'error' ? (
                      <>
                        <XCircle className="w-3 h-3" />
                        {t('autoReg.retry')}
                      </>
                    ) : (
                      t('autoReg.testConnection')
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
