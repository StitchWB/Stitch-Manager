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
  Cloud,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AddyIoAccountDetails } from '../../types/generated';
import { t } from '@/lib/i18n';
import { DEFAULT_IMAP_PORT, EMAIL_SHORTCODES, RANDOM_NAMES } from '../../constants/registration';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';
import { Tooltip } from './Tooltip';

export type MailStrategy = 'custom' | 'gmail' | 'cf-to-imap';

export interface IdentityConfig {
  strategy: MailStrategy;
  emailPattern: string;
  emailCustomPrefix?: string;
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
  mailtmEnabled?: boolean;
  icloudEnabled?: boolean;
  emailGenerationDomain?: string;
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
  addyioAccountInfo?: AddyIoAccountDetails | null;
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
    <div className="space-y-2 pt-2">
      <div className="flex gap-2">
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

/**
 * Compact disclosure around the IMAP credentials form.
 * Collapsed (default once configured) shows a one-line summary
 * "host · email" instead of the full form — saves ~200px of panel height.
 */
const CollapsibleImapForm = memo(
  ({
    config,
    onChange,
    disabled,
    passwordSet,
  }: {
    config: IdentityConfig;
    onChange: (c: Partial<IdentityConfig>) => void;
    disabled?: boolean;
    passwordSet?: boolean;
  }) => {
    const configured = !!(config.server && config.email && (config.password || passwordSet));
    const [expanded, setExpanded] = useState(!configured);
    const [showPassword, setShowPassword] = useState(false);
    const summary =
      config.server || config.email
        ? `${config.server || 'imap…'} · ${config.email || '…'}`
        : '—';

    return (
      <div className="pt-3 border-t border-white/5">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center justify-between gap-2 py-1 group"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Server className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="text-[10px] uppercase text-slate-500 tracking-wider font-bold shrink-0">
              {t('autoReg.imapCredentials')}
            </span>
            <Tooltip content="The mailbox where registration emails will arrive">
              <Info className="w-3 h-3 text-slate-600 cursor-help shrink-0" />
            </Tooltip>
            <span
              className={cn(
                'text-[10px] font-mono truncate',
                configured ? 'text-slate-400' : 'text-amber-400/80'
              )}
            >
              {summary}
            </span>
          </span>
          {expanded ? (
            <ChevronUp className="w-3 h-3 text-slate-600 group-hover:text-slate-400 shrink-0" />
          ) : (
            <ChevronDown className="w-3 h-3 text-slate-600 group-hover:text-slate-400 shrink-0" />
          )}
        </button>
        {expanded && (
          <ImapForm
            config={config}
            onChange={onChange}
            disabled={disabled}
            passwordSet={passwordSet}
            showPassword={showPassword}
            setShowPassword={setShowPassword}
          />
        )}
      </div>
    );
  }
);

CollapsibleImapForm.displayName = 'CollapsibleImapForm';

/** Inline IMAP test controls — rendered inside the alias-preview row to save height. */
const ImapTestInline = memo(
  ({
    onTest,
    testing,
    testStatus,
    testError,
    saveStatus,
  }: {
    onTest: () => void;
    testing: boolean;
    testStatus: TestConnectionStatus;
    testError: string;
    saveStatus?: string;
  }) => (
    <span className="flex items-center gap-1.5">
      {saveStatus === 'saved' && (
        <span className="text-[9px] font-bold uppercase text-emerald-500 tracking-widest">
          {t('autoReg.saved')}
        </span>
      )}
      {testStatus === 'success' && (
        <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-400 uppercase tracking-wider">
          <CheckCircle size={11} /> {t('identity.imapOk')}
        </span>
      )}
      {testStatus === 'error' && (
        <Tooltip content={testError || 'Connection failed'}>
          <span className="flex items-center gap-1 text-[9px] font-bold text-red-400 uppercase tracking-wider cursor-help">
            <XCircle size={11} /> {t('common.error')}
          </span>
        </Tooltip>
      )}
      <Button
        variant="ghost"
        size="xs"
        type="button"
        onClick={onTest}
        isLoading={testing}
        leftIcon={<RefreshCw size={12} />}
        className="text-slate-400 hover:text-slate-200"
      >
        Тест
      </Button>
    </span>
  )
);

ImapTestInline.displayName = 'ImapTestInline';

type GenerationMode = 'custom' | 'cf-to-imap' | 'gmail' | 'addyio' | '33mail' | 'mailtm' | 'icloud_pool';

/** Shared readiness check — used by the card itself and the cockpit header chip. */
export function isIdentityConfigReady(
  config: IdentityConfig,
  passwordSet = false,
  gmailAppPasswordSet = false
): boolean {
  const mode: GenerationMode = config.addyioEnabled
    ? 'addyio'
    : config.thirtyThreeMailEnabled
      ? '33mail'
      : config.mailtmEnabled
        ? 'mailtm'
        : config.icloudEnabled
          ? 'icloud_pool'
          : config.strategy === 'gmail'
            ? 'gmail'
            : config.strategy === 'cf-to-imap'
              ? 'cf-to-imap'
              : 'custom';
  switch (mode) {
    case 'gmail':
      return !!(config.gmailBase && (config.gmailAppPassword || gmailAppPasswordSet));
    case 'addyio':
      return !!(config.addyioApiToken && config.server && config.email);
    case '33mail':
      return !!(config.thirtyThreeMailUsername && config.server && config.email);
    case 'mailtm':
      return true;
    case 'icloud_pool':
      return !!config.icloudEnabled;
    case 'cf-to-imap':
      return !!(
        config.emailGenerationDomain &&
        config.server &&
        config.email &&
        (config.password || passwordSet)
      );
    default:
      return !!(config.server && config.email && (config.password || passwordSet));
  }
}

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
      : config.mailtmEnabled
        ? 'mailtm'
        : config.icloudEnabled
          ? 'icloud_pool'
          : config.strategy === 'gmail'
            ? 'gmail'
            : config.strategy === 'cf-to-imap'
              ? 'cf-to-imap'
              : 'custom';

  const handleModeChange = (mode: GenerationMode) => {
    const updates: Partial<IdentityConfig> = {
      strategy:
        mode === 'gmail' ? 'gmail' : mode === 'cf-to-imap' ? 'cf-to-imap' : 'custom',
      addyioEnabled: mode === 'addyio',
      thirtyThreeMailEnabled: mode === '33mail',
      mailtmEnabled: mode === 'mailtm',
      icloudEnabled: mode === 'icloud_pool',
      // Preserve emailGenerationDomain when in cf-to-imap mode, clear when leaving
      emailGenerationDomain:
        mode === 'cf-to-imap' ? (config.emailGenerationDomain || '') : '',
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
    } else if (activeMode === 'cf-to-imap') {
      let result = config.emailPattern || 'prefix';
      const domain = config.emailGenerationDomain || 'domain.com';
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
    } else if (activeMode === 'mailtm') {
      const randomStr = Math.random().toString(36).substring(2, 10);
      setPreview(`${randomStr}@tmpmail.net`);
    } else if (activeMode === 'icloud_pool') {
      const randomStr = Math.random().toString(36).substring(2, 10);
      setPreview(`${randomStr}@privaterelay.appleid.com`);
    }
  }, [activeMode, config]);

  // Avoid setState directly inside an effect body (react-hooks/set-state-in-effect)
  useEffect(() => {
    queueMicrotask(() => generatePreview());
  }, [generatePreview]);

  const insertShortcode = (code: string) => {
    onChange({ emailPattern: (config.emailPattern || '') + code });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-4 gap-1">
        {[
          { id: 'custom', label: 'Домен', icon: Globe, color: 'text-blue-400' },
          { id: 'cf-to-imap', label: 'CF→IMAP', icon: AtSign, color: 'text-amber-400' },
          { id: 'gmail', label: 'Gmail', icon: Mail, color: 'text-red-400' },
          { id: '33mail', label: '33mail', icon: AtSign, color: 'text-purple-400' },
          { id: 'addyio', label: 'Addy.io', icon: Shield, color: 'text-indigo-400' },
          { id: 'mailtm', label: 'Mail.tm', icon: Mail, color: 'text-cyan-400' },
          { id: 'icloud_pool', label: 'iCloud', icon: Cloud, color: 'text-sky-400' },
        ].map(mode => (
          <button
            key={mode.id}
            type="button"
            onClick={() => handleModeChange(mode.id as GenerationMode)}
            disabled={disabled}
            className={cn(
              'flex items-center justify-center px-1 py-1 rounded-md border transition-all duration-300 gap-1 select-none',
              activeMode === mode.id
                ? 'bg-white/10 border-white/20 shadow-lg ring-1 ring-white/10'
                : 'bg-white/[0.02] border-white/5 hover:bg-white/5 hover:border-white/10'
            )}
          >
            <mode.icon
              className={cn(
                'w-3.5 h-3.5 transition-transform duration-300 flex-shrink-0',
                activeMode === mode.id ? mode.color + ' scale-110' : 'opacity-60'
              )}
            />
            <span
              className={cn(
                'text-[8px] font-bold uppercase tracking-wider truncate',
                activeMode === mode.id ? 'text-white' : 'text-slate-400'
              )}
            >
              {mode.label}
            </span>
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        {activeMode === 'custom' && (
          <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
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
              <div className="flex items-center justify-between gap-1 px-1">
                <span className="text-xs text-emerald-400 font-mono font-medium truncate">
                  {preview}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <ImapTestInline
                    onTest={handleTest}
                    testing={testStatus === 'testing'}
                    testStatus={testStatus}
                    testError={testError}
                    saveStatus={saveStatus}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    onClick={generatePreview}
                    className="h-6 w-6"
                  >
                    <RefreshCw size={12} />
                  </Button>
                </span>
              </div>
            </div>
            <CollapsibleImapForm
              config={config}
              onChange={onChange}
              disabled={disabled}
              passwordSet={passwordSet}
            />
          </div>
        )}

        {activeMode === 'cf-to-imap' && (
          <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <Input
              label={t('autoReg.emailGenerationDomain')}
              placeholder="customdomain.com"
              value={config.emailGenerationDomain || ''}
              onChange={e => onChange({ emailGenerationDomain: e.target.value })}
              disabled={disabled}
              className="font-mono"
            />
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
                suffixText={`@${config.emailGenerationDomain || 'domain.com'}`}
              />
              <div className="flex items-center justify-between gap-1 px-1">
                <span className="text-xs text-emerald-400 font-mono font-medium truncate">
                  {preview}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <ImapTestInline
                    onTest={handleTest}
                    testing={testStatus === 'testing'}
                    testStatus={testStatus}
                    testError={testError}
                    saveStatus={saveStatus}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    onClick={generatePreview}
                    className="h-6 w-6"
                  >
                    <RefreshCw size={12} />
                  </Button>
                </span>
              </div>
            </div>
            <CollapsibleImapForm
              config={config}
              onChange={onChange}
              disabled={disabled}
              passwordSet={passwordSet}
            />
          </div>
        )}

        {activeMode === 'gmail' && (
          <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
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
              <div className="flex items-center justify-between gap-1 px-1">
                <span className="text-xs text-emerald-400 font-mono font-medium truncate">
                  {preview}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <ImapTestInline
                    onTest={handleTest}
                    testing={testStatus === 'testing'}
                    testStatus={testStatus}
                    testError={testError}
                    saveStatus={saveStatus}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    type="button"
                    onClick={generatePreview}
                    className="h-6 w-6"
                  >
                    <RefreshCw size={12} />
                  </Button>
                </span>
              </div>
            </div>
          </div>
        )}

        {activeMode === '33mail' && (
          <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <Input
              label="33mail Username"
              value={config.thirtyThreeMailUsername || ''}
              onChange={e => onChange({ thirtyThreeMailUsername: e.target.value })}
              placeholder="username"
              suffixText={`.${config.thirtyThreeMailDomain || '33mail.com'}`}
              className="font-mono"
            />
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 bg-purple-500/10 border border-purple-500/20 rounded-xl p-2.5 shadow-lg">
                <p className="text-purple-300 text-[10px] font-bold uppercase tracking-widest mb-1 opacity-60">
                  {t('common.preview')}
                </p>
                <p className="text-white text-xs font-mono truncate">{preview}</p>
              </div>
              <ImapTestInline
                onTest={handleTest}
                testing={testStatus === 'testing'}
                testStatus={testStatus}
                testError={testError}
                saveStatus={saveStatus}
              />
            </div>
            <CollapsibleImapForm
              config={config}
              onChange={onChange}
              disabled={disabled}
              passwordSet={passwordSet}
            />
          </div>
        )}

        {activeMode === 'addyio' && (
          <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
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
                  <span className="text-slate-500">{t('identity.planLabel')}</span>{' '}
                  <span className="text-white ml-2">{addyioAccountInfo.subscription}</span>
                </div>
                <div>
                  <span className="text-slate-500">{t('identity.activeLabel')}</span>{' '}
                  <span className="text-white ml-2">
                    {addyioAccountInfo.totalActiveAliases} / {addyioAccountInfo.totalAliases}
                  </span>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider px-1">
                  {t('settings.domain')}
                </label>
                {addyioDomains.length > 0 ? (
                  <Select
                    containerClassName="w-full"
                    className="h-9 py-2 text-sm"
                    value={config.addyioDomain || ''}
                    onValueChange={value => onChange({ addyioDomain: value })}
                    disabled={disabled}
                    options={[
                      { value: '', label: 'Default' },
                      ...addyioDomains.map(d => ({ value: d, label: d })),
                    ]}
                  />
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
                  {t('settings.formatLabel')}
                </label>
                <Select
                  containerClassName="w-full"
                  className="h-9 py-2 text-sm"
                  value={config.addyioAliasFormat || 'uuid'}
                  onValueChange={value => onChange({ addyioAliasFormat: value })}
                  disabled={disabled}
                  options={[
                    { value: 'uuid', label: 'UUID' },
                    { value: 'random_words', label: 'Words' },
                    { value: 'random_characters', label: 'Chars' },
                  ]}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <ImapTestInline
                onTest={handleTest}
                testing={testStatus === 'testing'}
                testStatus={testStatus}
                testError={testError}
                saveStatus={saveStatus}
              />
            </div>
            <CollapsibleImapForm
              config={config}
              onChange={onChange}
              disabled={disabled}
              passwordSet={passwordSet}
            />
          </div>
        )}

        {activeMode === 'mailtm' && (
          <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-2.5 shadow-lg">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                  <Mail className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="flex-1 space-y-2">
                  <p className="text-cyan-300 text-xs font-bold uppercase tracking-widest">
                    {t('identity.temporaryEmailService')}
                  </p>
                  <p className="text-slate-300 text-xs leading-relaxed">
                    {t('identity.mailtmDescription')}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-cyan-400 font-medium">
                    <CheckCircle size={12} />
                    <span>{t('identity.autoGeneratedAddresses')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-cyan-400 font-medium">
                    <CheckCircle size={12} />
                    <span>{t('identity.noImapConfigNeeded')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-cyan-400 font-medium">
                    <CheckCircle size={12} />
                    <span>{t('identity.perfectForOneTimeRegistrations')}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeMode === 'icloud_pool' && (
          <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div className="bg-sky-500/10 border border-sky-500/20 rounded-xl p-2.5 shadow-lg">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-sky-500/20 flex items-center justify-center">
                  <Cloud className="w-4 h-4 text-sky-400" />
                </div>
                <div className="flex-1 space-y-2">
                  <p className="text-sky-300 text-xs font-bold uppercase tracking-widest">
                    iCloud Hide My Email
                  </p>
                  <p className="text-slate-300 text-xs leading-relaxed">
                    Aliases from your iCloud pool ({t('identity.noImapConfigNeeded').toLowerCase()} — verification via iCloud IMAP).
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-sky-400 font-medium">
                    <CheckCircle size={12} />
                    <span>@privaterelay.appleid.com forwarding</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-sky-400 font-medium">
                    <CheckCircle size={12} />
                    <span>~700 aliases / month for $0.99</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-sky-400 font-medium">
                    <CheckCircle size={12} />
                    <span>Pre-fill pool in Settings → Connectivity</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-sky-500/5 border border-sky-500/20 rounded-lg px-3 py-2 text-[10px] text-sky-300 font-mono truncate">
              {preview || 'abc123@privaterelay.appleid.com'}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
