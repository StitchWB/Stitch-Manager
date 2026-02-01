import { useState, useCallback, useEffect, memo } from 'react';
import {
  Mail,
  Eye,
  EyeOff,
  Info,
  RefreshCw,
  CheckCircle,
  XCircle,
  Globe,
  Shield,
  AtSign,
  Server,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { t } from '../../lib/i18n';
import { DEFAULT_IMAP_PORT, EMAIL_SHORTCODES, RANDOM_NAMES } from '../../constants/registration';
import { Button } from './Button';
import { Input } from './Input';
import { Tooltip } from './Tooltip';

export type MailStrategy = 'custom' | 'gmail';

export interface IdentityConfig {
  strategy: MailStrategy;
  emailPattern: string;
  server: string;
  port: number;
  email: string;
  password: string;
  gmailBase: string;
  gmailAlias: string;
  gmailAppPassword: string;
  addyioEnabled?: boolean;
  addyioApiToken?: string;
  addyioDomain?: string;
  addyioAliasFormat?: string;
  addyioAutoDelete?: boolean;
  thirtyThreeMailEnabled?: boolean;
  thirtyThreeMailUsername?: string;
  thirtyThreeMailDomain?: string;
}

export type TestConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

interface IdentitySystemCardProps {
  config: IdentityConfig;
  onChange: (config: Partial<IdentityConfig>) => void;
  onTest: () => Promise<boolean> | void;
  disabled?: boolean;
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error';
  passwordSet?: boolean;
  gmailAppPasswordSet?: boolean;
  testStatus?: TestConnectionStatus;
  testError?: string;
  onTestAddyio?: () => void;
  isTestingAddyio?: boolean;
  addyioConnectionStatus?: 'idle' | 'success' | 'error';
  addyioConnectionMessage?: string;
  addyioAccountInfo?: any;
  addyioDomains?: string[];
}

// Sub-component moved outside to prevent re-mounting flicker
const ImapForm = memo(
  ({
    config,
    onChange,
    disabled,
    passwordSet,
    showPassword,
    setShowPassword,
  }: {
    config: IdentityConfig;
    onChange: (c: Partial<IdentityConfig>) => void;
    disabled?: boolean;
    passwordSet?: boolean;
    showPassword?: boolean;
    setShowPassword: (v: boolean) => void;
  }) => (
    <div className="space-y-4 pt-4 border-t border-white/5">
      <div className="flex items-center gap-2 px-1">
        <Server className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-[10px] uppercase text-slate-500 tracking-wider font-bold">
          {t('autoReg.imapCredentials')}
        </span>
        <Tooltip content="The mailbox where registration emails will arrive">
          <Info className="w-3 h-3 text-slate-600 cursor-help" />
        </Tooltip>
      </div>

      <div className="flex gap-3">
        <Input
          label={t('autoReg.host')}
          placeholder="imap.example.com"
          value={config.server}
          onChange={e => onChange({ server: e.target.value })}
          disabled={disabled}
          containerClassName="flex-[3]"
        />
        <Input
          label={t('autoReg.port')}
          type="number"
          placeholder="993"
          value={config.port}
          onChange={e => onChange({ port: parseInt(e.target.value) || DEFAULT_IMAP_PORT })}
          disabled={disabled}
          containerClassName="flex-1"
          className="text-center"
        />
      </div>

      <Input
        label={t('accounts.email')}
        type="email"
        placeholder="user@example.com"
        value={config.email}
        onChange={e => onChange({ email: e.target.value })}
        disabled={disabled}
      />

      <Input
        label={t('accounts.password')}
        type={showPassword ? 'text' : 'password'}
        placeholder={passwordSet ? `(${t('autoReg.saved')})` : '••••••••'}
        value={config.password || ''}
        onChange={e => onChange({ password: e.target.value })}
        disabled={disabled}
        rightElement={
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="h-7 w-7"
          >
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
          </Button>
        }
      />
    </div>
  )
);

ImapForm.displayName = 'ImapForm';

type GenerationMode = 'custom' | 'gmail' | 'addyio' | '33mail';

export function IdentitySystemCard({
  config,
  onChange,
  onTest,
  disabled,
  saveStatus = 'idle',
  passwordSet = false,
  gmailAppPasswordSet = false,
  testStatus: externalTestStatus,
  testError: externalTestError,
  onTestAddyio,
  isTestingAddyio = false,
  addyioConnectionStatus = 'idle',
  addyioConnectionMessage = '',
  addyioAccountInfo,
  addyioDomains = [],
}: IdentitySystemCardProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [showAppPassword, setShowAppPassword] = useState(false);
  const [preview, setPreview] = useState('');
  const [internalTestStatus, setInternalTestStatus] = useState<TestConnectionStatus>('idle');
  const [internalTestError, setInternalTestError] = useState<string>('');

  const testStatus = externalTestStatus ?? internalTestStatus;
  const testError = externalTestError ?? internalTestError;

  const activeMode: GenerationMode = config.addyioEnabled
    ? 'addyio'
    : config.thirtyThreeMailEnabled
      ? '33mail'
      : config.strategy === 'gmail'
        ? 'gmail'
        : 'custom';

  const handleModeChange = (mode: GenerationMode) => {
    const updates: Partial<IdentityConfig> = {
      strategy: mode === 'gmail' ? 'gmail' : 'custom',
      addyioEnabled: mode === 'addyio',
      thirtyThreeMailEnabled: mode === '33mail',
    };
    onChange(updates);
  };

  const handleTest = async () => {
    if (externalTestStatus !== undefined) {
      onTest();
      return;
    }
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
      setTimeout(() => {
        setInternalTestStatus('idle');
        setInternalTestError('');
      }, 3000);
    } catch (err) {
      setInternalTestStatus('error');
      setInternalTestError(err instanceof Error ? err.message : 'Connection failed');
      setTimeout(() => {
        setInternalTestStatus('idle');
        setInternalTestError('');
      }, 5000);
    }
  };

  const isReady =
    activeMode === 'gmail'
      ? !!(config.gmailBase && (config.gmailAppPassword || gmailAppPasswordSet))
      : activeMode === 'addyio'
        ? !!(config.addyioApiToken && config.server && config.email)
        : activeMode === '33mail'
          ? !!(config.thirtyThreeMailUsername && config.server && config.email)
          : !!(config.server && config.email && (config.password || passwordSet));

  const generatePreview = useCallback(() => {
    if (activeMode === 'gmail') {
      const base = config.gmailBase?.replace('@gmail.com', '') || 'your.email';
      let alias = config.gmailAlias || 'alias';
      alias = alias
        .replace(/\{counter\}/gi, '1')
        .replace(/\{rnd\}/gi, Math.random().toString(36).substring(2, 6))
        .replace(/\{time\}/gi, Date.now().toString().slice(-6))
        .replace(/\{name\}/gi, RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]);
      setPreview(`${base}+${alias}@gmail.com`);
    } else if (activeMode === 'custom') {
      let result = config.emailPattern || 'prefix';
      const domain = config.email?.split('@')[1] || 'example.com';
      result = result
        .replace(/\{counter\}/gi, '1')
        .replace(/\{rnd\}/gi, Math.random().toString(36).substring(2, 6))
        .replace(/\{time\}/gi, Date.now().toString().slice(-6))
        .replace(/\{name\}/gi, RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]);
      setPreview(`${result}@${domain}`);
    } else if (activeMode === '33mail') {
      const user = config.thirtyThreeMailUsername?.trim() || 'username';
      const domain = config.thirtyThreeMailDomain?.trim() || '33mail.com';
      setPreview(`random@${user}.${domain}`);
    } else if (activeMode === 'addyio') {
      const domain = config.addyioDomain || 'anonaddy.me';
      setPreview(`uuid@${domain}`);
    }
  }, [activeMode, config]);

  useEffect(() => {
    generatePreview();
  }, [generatePreview]);

  const insertShortcode = (code: string) => {
    onChange({ emailPattern: (config.emailPattern || '') + code });
  };

  return (
    <div className="bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
      <div className="px-5 py-4 border-b border-white/5 bg-white/[0.02]">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
            <Mail className={cn('w-5 h-5', isReady ? 'text-emerald-400' : 'text-slate-500')} />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-white tracking-tight">
              {t('autoReg.identitySystem')}
            </h3>
            <p className="text-[10px] text-slate-500 font-medium">{t('autoReg.emailGeneration')}</p>
          </div>
          {isReady && (
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400 uppercase tracking-wider px-2 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/50" />
              {t('autoReg.ready')}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 p-4">
        {[
          { id: 'custom', label: t('autoReg.customDomain'), icon: Globe, color: 'text-blue-400' },
          { id: 'gmail', label: t('autoReg.gmailAlias'), icon: Mail, color: 'text-red-400' },
          { id: '33mail', label: '33mail', icon: AtSign, color: 'text-purple-400' },
          { id: 'addyio', label: 'Addy.io', icon: Shield, color: 'text-indigo-400' },
        ].map(mode => (
          <button
            key={mode.id}
            type="button"
            onClick={() => handleModeChange(mode.id as GenerationMode)}
            disabled={disabled}
            className={cn(
              'flex flex-col items-center justify-center p-3 rounded-xl border transition-all duration-300 gap-2 select-none',
              activeMode === mode.id
                ? 'bg-white/10 border-white/20 shadow-lg ring-1 ring-white/10'
                : 'bg-white/[0.02] border-white/5 hover:bg-white/5 hover:border-white/10 text-slate-500'
            )}
          >
            <mode.icon
              className={cn(
                'w-5 h-5 transition-transform duration-300',
                activeMode === mode.id ? mode.color + ' scale-110' : 'opacity-40'
              )}
            />
            <span
              className={cn(
                'text-[10px] font-bold uppercase tracking-wider',
                activeMode === mode.id ? 'text-white' : ''
              )}
            >
              {mode.label}
            </span>
          </button>
        ))}
      </div>

      <div className="px-5 pb-5 space-y-5">
        {activeMode === 'custom' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                  {t('autoReg.emailPattern')}
                </label>
                <div className="flex gap-1">
                  {EMAIL_SHORTCODES.map(({ id, code }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => insertShortcode(code)}
                      disabled={disabled}
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-slate-500 hover:text-slate-300 border border-white/5 transition-colors"
                    >
                      {code}
                    </button>
                  ))}
                </div>
              </div>
              <Input
                value={config.emailPattern}
                onChange={e => onChange({ emailPattern: e.target.value })}
                disabled={disabled}
                placeholder="prefix"
                className="font-mono"
                suffixText={`@${config.email?.split('@')[1] || 'domain.com'}`}
              />
              <div className="flex items-center justify-between px-1">
                <span className="text-xs text-emerald-400 font-mono font-medium truncate">
                  {preview}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  onClick={generatePreview}
                  className="h-6 w-6"
                >
                  <RefreshCw size={12} />
                </Button>
              </div>
            </div>
            <ImapForm
              config={config}
              onChange={onChange}
              disabled={disabled}
              passwordSet={passwordSet}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
            />
          </div>
        )}

        {activeMode === 'gmail' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Input
              label={t('autoReg.masterGmail')}
              type="email"
              placeholder="your.email@gmail.com"
              value={config.gmailBase}
              onChange={e => onChange({ gmailBase: e.target.value })}
              disabled={disabled}
            />
            <Input
              label={t('autoReg.appPassword')}
              type={showAppPassword ? 'text' : 'password'}
              placeholder={gmailAppPasswordSet ? `(${t('autoReg.saved')})` : '••••••••'}
              value={config.gmailAppPassword}
              onChange={e => onChange({ gmailAppPassword: e.target.value })}
              disabled={disabled}
              rightElement={
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  onClick={() => setShowAppPassword(!showAppPassword)}
                  className="h-7 w-7"
                >
                  {showAppPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </Button>
              }
            />
            <div className="space-y-2">
              <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider px-1">
                {t('autoReg.aliasPattern')}
              </label>
              <Input
                value={config.gmailAlias}
                onChange={e => onChange({ gmailAlias: e.target.value })}
                disabled={disabled}
                placeholder="alias_{rnd}"
                prefixText={`${config.gmailBase?.replace('@gmail.com', '') || 'user'}+`}
                suffixText="@gmail.com"
                className="font-mono"
              />
              <div className="flex items-center justify-between px-1">
                <span className="text-xs text-emerald-400 font-mono font-medium truncate">
                  {preview}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  onClick={generatePreview}
                  className="h-6 w-6"
                >
                  <RefreshCw size={12} />
                </Button>
              </div>
            </div>
          </div>
        )}

        {activeMode === '33mail' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Input
              label="33mail Username"
              value={config.thirtyThreeMailUsername || ''}
              onChange={e => onChange({ thirtyThreeMailUsername: e.target.value })}
              placeholder="username"
              suffixText={`.${config.thirtyThreeMailDomain || '33mail.com'}`}
              className="font-mono"
            />
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-3 shadow-lg">
              <p className="text-purple-300 text-[10px] font-bold uppercase tracking-widest mb-1 opacity-60">
                {t('common.preview')}
              </p>
              <p className="text-white text-xs font-mono truncate">{preview}</p>
            </div>
            <ImapForm
              config={config}
              onChange={onChange}
              disabled={disabled}
              passwordSet={passwordSet}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
            />
          </div>
        )}

        {activeMode === 'addyio' && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Input
              label={t('autoReg.addyio.apiToken')}
              type="password"
              value={config.addyioApiToken || ''}
              onChange={e => onChange({ addyioApiToken: e.target.value })}
              placeholder="add_..."
              disabled={disabled}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={onTestAddyio}
              className="w-full"
              isLoading={isTestingAddyio}
              disabled={!config.addyioApiToken}
              leftIcon={<RefreshCw size={14} />}
            >
              {t('autoReg.addyio.testConnection')}
            </Button>
            {addyioConnectionStatus !== 'idle' && (
              <div
                className={cn(
                  'flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider px-3 py-2 rounded-lg',
                  addyioConnectionStatus === 'success'
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-red-500/10 text-red-400 border border-red-500/20'
                )}
              >
                {addyioConnectionStatus === 'success' ? (
                  <CheckCircle size={14} />
                ) : (
                  <XCircle size={14} />
                )}
                {addyioConnectionMessage}
              </div>
            )}
            {addyioAccountInfo && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-3 grid grid-cols-2 gap-2 text-[10px] font-bold uppercase tracking-widest">
                <div>
                  <span className="text-slate-500">Plan:</span>{' '}
                  <span className="text-white ml-2">{addyioAccountInfo.subscription}</span>
                </div>
                <div>
                  <span className="text-slate-500">Active:</span>{' '}
                  <span className="text-white ml-2">
                    {addyioAccountInfo.totalActiveAliases} / {addyioAccountInfo.totalAliases}
                  </span>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider px-1">
                  Domain
                </label>
                {addyioDomains.length > 0 ? (
                  <select
                    value={config.addyioDomain || ''}
                    onChange={e => onChange({ addyioDomain: e.target.value })}
                    disabled={disabled}
                    className="w-full h-9 bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50 transition-all cursor-pointer"
                  >
                    <option value="" className="bg-[#0f1115]">
                      Default
                    </option>
                    {addyioDomains.map(d => (
                      <option key={d} value={d} className="bg-[#0f1115]">
                        {d}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    value={config.addyioDomain || ''}
                    onChange={e => onChange({ addyioDomain: e.target.value })}
                    placeholder="anonaddy.me"
                    disabled={disabled}
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider px-1">
                  Format
                </label>
                <select
                  value={config.addyioAliasFormat || 'uuid'}
                  onChange={e => onChange({ addyioAliasFormat: e.target.value })}
                  disabled={disabled}
                  className="w-full h-9 bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50 transition-all cursor-pointer"
                >
                  <option value="uuid" className="bg-[#0f1115]">
                    UUID
                  </option>
                  <option value="random_words" className="bg-[#0f1115]">
                    Words
                  </option>
                  <option value="random_characters" className="bg-[#0f1115]">
                    Chars
                  </option>
                </select>
              </div>
            </div>
            <ImapForm
              config={config}
              onChange={onChange}
              disabled={disabled}
              passwordSet={passwordSet}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
            />
          </div>
        )}
      </div>

      {(activeMode === 'custom' || activeMode === 'gmail') && (
        <div className="px-5 py-4 border-t border-white/5 bg-white/[0.01] flex items-center justify-between">
          <div className="flex items-center gap-2">
            {saveStatus === 'saved' && (
              <span className="text-[10px] font-bold uppercase text-emerald-500 tracking-widest animate-in fade-in duration-500">
                {t('autoReg.saved')}
              </span>
            )}
            {testStatus === 'success' && (
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400 uppercase tracking-wider bg-emerald-500/10 px-2 py-1 rounded-md">
                <CheckCircle size={12} /> IMAP OK
              </div>
            )}
            {testStatus === 'error' && (
              <Tooltip content={testError || 'Connection failed'}>
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-red-400 uppercase tracking-wider bg-red-500/10 px-2 py-1 rounded-md cursor-help">
                  <XCircle size={12} /> Error
                </div>
              </Tooltip>
            )}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleTest}
            isLoading={testStatus === 'testing'}
            leftIcon={<RefreshCw size={14} />}
          >
            {t('autoReg.testConnection')}
          </Button>
        </div>
      )}
    </div>
  );
}
