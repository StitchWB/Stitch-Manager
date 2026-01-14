import { useState, useCallback, useEffect } from 'react';
import { Mail, Eye, EyeOff, Info, RefreshCw, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { DEFAULT_IMAP_PORT, EMAIL_SHORTCODES, RANDOM_NAMES } from '../../constants/registration';

export type MailStrategy = 'custom' | 'gmail';

export interface IdentityConfig {
  strategy: MailStrategy;
  // Pattern (stored as string, not EmailPattern enum)
  emailPattern: string;
  // Custom domain fields
  server: string;
  port: number;
  email: string;
  password: string;
  // Gmail alias fields
  gmailBase: string;
  gmailAlias: string;
  gmailAppPassword: string;
}

export type TestConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

interface IdentitySystemCardProps {
  config: IdentityConfig;
  onChange: (config: Partial<IdentityConfig>) => void;
  onTest: () => Promise<boolean> | void;
  disabled?: boolean;
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  passwordSet?: boolean;
  testStatus?: TestConnectionStatus;
  testError?: string;
}

export function IdentitySystemCard({
  config,
  onChange,
  onTest,
  disabled,
  saveStatus = 'idle',
  passwordSet = false,
  testStatus: externalTestStatus,
  testError: externalTestError,
}: IdentitySystemCardProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showAppPassword, setShowAppPassword] = useState(false);
  const [preview, setPreview] = useState('');
  const [internalTestStatus, setInternalTestStatus] = useState<TestConnectionStatus>('idle');
  const [internalTestError, setInternalTestError] = useState<string>('');
  
  // Use external status if provided, otherwise use internal
  const testStatus = externalTestStatus ?? internalTestStatus;
  const testError = externalTestError ?? internalTestError;

  // Handle test connection with internal state management
  const handleTest = async () => {
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

  const isGmail = config.strategy === 'gmail';
  
  // Determine if configuration is ready
  const isReady = isGmail
    ? !!(config.gmailBase && config.gmailAppPassword)
    : !!(config.server && config.email && (config.password || passwordSet));

  // Get domain for preview
  const emailDomain = isGmail 
    ? 'gmail.com' 
    : config.email?.split('@')[1] || 'example.com';

  // Generate preview
  const generatePreview = useCallback(() => {
    if (isGmail) {
      const base = config.gmailBase?.replace('@gmail.com', '') || 'your.email';
      // For Gmail, use gmailAlias directly, or generate from pattern if alias contains shortcodes
      let alias = config.gmailAlias || 'alias';
      // Show example counter value (1, 2, 3...) instead of replacing
      alias = alias.replace(/\{counter\}/gi, '1');
      alias = alias.replace(/\{rnd\}/gi, Math.random().toString(36).substring(2, 6));
      alias = alias.replace(/\{time\}/gi, Date.now().toString().slice(-6));
      alias = alias.replace(/\{name\}/gi, RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]);
      setPreview(`${base}+${alias}@gmail.com`);
    } else {
      let result = config.emailPattern || 'prefix';
      // Show example counter value (1, 2, 3...) instead of replacing
      result = result.replace(/\{counter\}/gi, '1');
      result = result.replace(/\{rnd\}/gi, Math.random().toString(36).substring(2, 6));
      result = result.replace(/\{time\}/gi, Date.now().toString().slice(-6));
      result = result.replace(/\{name\}/gi, RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]);
      setPreview(`${result}@${emailDomain}`);
    }
  }, [config.emailPattern, config.gmailBase, config.gmailAlias, isGmail, emailDomain]);

  useEffect(() => {
    generatePreview();
  }, [generatePreview]);

  const insertShortcode = (code: string) => {
    onChange({ emailPattern: (config.emailPattern || '') + code });
  };

  return (
    <div className="card border border-white/5">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
            <Mail className={cn('w-4 h-4', isReady ? 'text-emerald-400' : 'text-slate-500')} />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-white">Identity System</h3>
            <p className="text-2xs text-slate-500 mt-0.5">Email generation & authentication</p>
          </div>
          {isReady && (
            <div className="flex items-center gap-1.5 text-2xs text-emerald-400">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/50" />
              Ready
            </div>
          )}
        </div>
      </div>

      {/* Strategy Switcher - Pill Style */}
      <div className="px-4 pt-4">
        <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <button
            onClick={() => onChange({ strategy: 'custom' })}
            disabled={disabled}
            className={cn(
              'flex-1 py-2 text-xs font-medium rounded-md transition-all duration-200',
              config.strategy === 'custom'
                ? 'text-white bg-white/10'
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/5',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            Custom Domain
          </button>
          <button
            onClick={() => onChange({ strategy: 'gmail' })}
            disabled={disabled}
            className={cn(
              'flex-1 py-2 text-xs font-medium rounded-md transition-all duration-200',
              config.strategy === 'gmail'
                ? 'text-white bg-white/10'
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/5',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            Gmail Alias
          </button>
        </div>
      </div>

      {/* Dynamic Body */}
      <div className="px-4 py-4 space-y-4">{isGmail ? (
          <>
            {/* Gmail Mode */}
            {/* Master Identity */}
            <div>
              <label className="input-label">Master Gmail</label>
              <input
                type="email"
                placeholder="your.email@gmail.com"
                value={config.gmailBase}
                onChange={(e) => onChange({ gmailBase: e.target.value })}
                disabled={disabled}
                className="input-ds"
              />
            </div>

            {/* Alias Configuration */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="input-label mb-0">Alias Pattern</label>
                <div className="flex items-center gap-1">
                  {EMAIL_SHORTCODES.map(({ id, code }) => (
                    <button
                      key={id}
                      onClick={() => onChange({ gmailAlias: (config.gmailAlias || '') + code })}
                      disabled={disabled}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-slate-500 hover:bg-white/10 hover:text-slate-300 transition-colors border border-white/5"
                      title={code}
                    >
                      {code}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="flex items-center h-9 rounded-md overflow-hidden input-ds px-0">
                <span className="pl-3 pr-1 text-xs font-mono text-slate-500 select-none">
                  {config.gmailBase?.replace('@gmail.com', '') || 'your.email'}+
                </span>
                <input
                  type="text"
                  placeholder="kiro_{time}_{rnd}"
                  value={config.gmailAlias}
                  onChange={(e) => onChange({ gmailAlias: e.target.value })}
                  disabled={disabled}
                  className="flex-1 h-full bg-transparent border-none outline-none text-xs font-mono text-white placeholder-slate-600 focus:ring-0"
                />
                <span className="pr-3 pl-1 text-xs font-mono text-slate-500 select-none border-l border-white/10">
                  @gmail.com
                </span>
              </div>

              {/* Hint for dynamic patterns */}
              {config.gmailAlias && !config.gmailAlias.includes('{') && (
                <div className="text-[10px] text-amber-400/80 mt-1">
                  ⚠ Static alias - add {'{rnd}'} or {'{time}'} for unique emails
                </div>
              )}

              {/* Preview */}
              <div className="flex items-center justify-between mt-2">
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-emerald-400 font-mono truncate block">{preview}</span>
                  <span className="text-[10px] text-slate-600">↻ Click refresh to see another example</span>
                </div>
                <button
                  onClick={generatePreview}
                  className="btn-icon p-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Gmail App Password */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <label className="input-label mb-0">App Password</label>
                <div className="group relative">
                  <Info className="w-3 h-3 text-slate-600 cursor-help" />
                  <div className="absolute left-0 bottom-full mb-2 w-56 p-2 rounded-md bg-slate-900 border border-white/10 text-[10px] text-slate-300 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-10">
                    Generate an App Password in your Google Account settings (Security → 2-Step
                    Verification → App passwords). Do not use your regular Gmail password.
                  </div>
                </div>
              </div>
              <div className="relative">
                <input
                  type={showAppPassword ? 'text' : 'password'}
                  placeholder="••••••••••••••••"
                  value={config.gmailAppPassword}
                  onChange={(e) => onChange({ gmailAppPassword: e.target.value })}
                  disabled={disabled}
                  className="input-ds pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowAppPassword(!showAppPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400"
                >
                  {showAppPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Custom Domain Mode */}
            {/* Pattern Section */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="input-label mb-0">Email Pattern</label>
                <div className="flex items-center gap-1">
                  {EMAIL_SHORTCODES.map(({ id, code }) => (
                    <button
                      key={id}
                      onClick={() => insertShortcode(code)}
                      disabled={disabled}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-slate-500 hover:bg-white/10 hover:text-slate-300 transition-colors border border-white/5"
                      title={code}
                    >
                      {code}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center h-9 rounded-md overflow-hidden input-ds px-0">
                <input
                  type="text"
                  value={config.emailPattern}
                  onChange={(e) => onChange({ emailPattern: e.target.value })}
                  disabled={disabled}
                  placeholder="prefix"
                  className="flex-1 h-full bg-transparent border-none outline-none pl-3 text-xs font-mono text-white placeholder-slate-600 focus:ring-0"
                />
                <span className="pr-3 pl-1 text-xs font-mono text-slate-500 select-none border-l border-white/10">
                  @{emailDomain}
                </span>
              </div>

              {/* Preview */}
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-emerald-400 font-mono truncate">{preview}</span>
                <button
                  onClick={generatePreview}
                  className="btn-icon p-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Credentials Section */}
            <div className="space-y-3 pt-2 border-t border-white/5">
              <div className="text-2xs uppercase text-slate-500 tracking-wider">
                IMAP Credentials
              </div>
              
              {/* IMAP Host & Port */}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="input-label">Host</label>
                  <input
                    type="text"
                    placeholder="imap.example.com"
                    value={config.server}
                    onChange={(e) => onChange({ server: e.target.value })}
                    disabled={disabled}
                    className="input-ds"
                  />
                </div>
                <div className="w-20">
                  <label className="input-label">Port</label>
                  <input
                    type="number"
                    placeholder="993"
                    value={config.port}
                    onChange={(e) =>
                      onChange({ port: parseInt(e.target.value) || DEFAULT_IMAP_PORT })
                    }
                    disabled={disabled}
                    className="input-ds text-center"
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label className="input-label">Email</label>
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={config.email}
                  onChange={(e) => onChange({ email: e.target.value })}
                  disabled={disabled}
                  className="input-ds"
                />
              </div>

              {/* Password */}
              <div>
                <label className="input-label">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder={passwordSet ? '(saved)' : '••••••••'}
                    value={config.password || ''}
                    onChange={(e) => onChange({ password: e.target.value })}
                    disabled={disabled}
                    className={cn(
                      'input-ds pr-10',
                      passwordSet && !config.password && 'ring-1 ring-emerald-500/30'
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-white/5">
          <div className="h-4 flex items-center gap-2">
            {saveStatus === 'saving' && (
              <span className="text-2xs text-slate-500">Saving...</span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-2xs text-emerald-500">Saved</span>
            )}
            {saveStatus === 'error' && (
              <span className="text-2xs text-red-500">Save failed</span>
            )}
            {/* Test connection feedback */}
            {testStatus === 'success' && (
              <span className="text-2xs text-emerald-500 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                Connected
              </span>
            )}
            {testStatus === 'error' && (
              <span className="text-2xs text-red-500 flex items-center gap-1" title={testError}>
                <XCircle className="w-3 h-3" />
                {testError || 'Failed'}
              </span>
            )}
          </div>
          <button
            onClick={handleTest}
            disabled={!isReady || disabled || testStatus === 'testing'}
            className={cn(
              "btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5",
              testStatus === 'success' && "border-emerald-500/30 text-emerald-400",
              testStatus === 'error' && "border-red-500/30 text-red-400"
            )}
          >
            {testStatus === 'testing' ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Testing...
              </>
            ) : testStatus === 'success' ? (
              <>
                <CheckCircle className="w-3 h-3" />
                Success
              </>
            ) : testStatus === 'error' ? (
              <>
                <XCircle className="w-3 h-3" />
                Retry
              </>
            ) : (
              'Test Connection'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
