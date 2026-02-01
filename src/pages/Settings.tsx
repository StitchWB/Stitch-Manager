import { useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import {
  Settings as SettingsIcon,
  Moon,
  Sun,
  Monitor,
  Database,
  Globe,
  Loader2,
  CheckCircle,
  AlertCircle,
  FolderOpen,
  X,
  Code,
  Eye,
  EyeOff,
  RefreshCw,
  Server,
  Shield,
  Copy,
} from 'lucide-react';
import { useAppStore } from '../stores/app';
import { useLogsStore } from '../stores/logs';
import { useRegistrationStore } from '../stores/registration';
import {
  getSettings,
  updateSettings,
  getDatabasePath,
  testAddyioConnection,
  getAddyioAccount,
  getAddyioDomains,
  getAddyioRecipients,
  getEmailCounter,
  setEmailCounter,
} from '../lib/tauri';
import { SettingsData } from '../types/generated';
import { open } from '@tauri-apps/plugin-dialog';
import Header from '../components/layout/Header';
import { t } from '../lib/i18n';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Tooltip } from '../components/Tooltip';
import { validatePort, validateHostname, validateEmail, validateUrl } from '../lib/validation';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';

type SettingsCategory = 'general' | 'connectivity';

interface CategoryConfig {
  id: SettingsCategory;
  labelKey: string;
  icon: ReactNode;
}

const categories: CategoryConfig[] = [
  {
    id: 'general',
    labelKey: 'settings.categories.general',
    icon: <SettingsIcon className="w-4 h-4" />,
  },
  {
    id: 'connectivity',
    labelKey: 'settings.categories.connectivity',
    icon: <Globe className="w-4 h-4" />,
  },
];

export default function Settings() {
  const theme = useAppStore(state => state.theme);
  const setTheme = useAppStore(state => state.setTheme);
  const language = useAppStore(state => state.language);
  const setLanguage = useAppStore(state => state.setLanguage);

  const uiScale = useRegistrationStore(state => state.config.uiScale);
  const setUIScale = useRegistrationStore(state => state.setUIScale);

  const addLog = useLogsStore(state => state.addLog);
  const { copy } = useCopyToClipboard();

  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('general');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mounted, setMounted] = useState(false);

  const [imapServer, setImapServer] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [imapEmail, setImapEmail] = useState('');
  const [imapPassword, setImapPassword] = useState('');

  // Addy.io settings
  const [addyioEnabled, setAddyioEnabled] = useState(false);
  const [addyioApiToken, setAddyioApiToken] = useState('');
  const [addyioAliasFormat, setAddyioAliasFormat] = useState('uuid');
  const [addyioDomain, setAddyioDomain] = useState('');
  const [addyioAutoDelete, setAddyioAutoDelete] = useState(false);
  const [addyioDefaultRecipientId, setAddyioDefaultRecipientId] = useState('');
  const [addyioDescriptionTemplate, setAddyioDescriptionTemplate] = useState('');
  const [addyioFromName, setAddyioFromName] = useState('');

  // 33mail settings
  const [thirtyThreeMailEnabled, setThirtyThreeMailEnabled] = useState(false);
  const [thirtyThreeMailUsername, setThirtyThreeMailUsername] = useState('');
  const [thirtyThreeMailDomain, setThirtyThreeMailDomain] = useState('33mail.com');

  // Addy.io dynamic data
  const [addyioDomains, setAddyioDomains] = useState<string[]>([]);
  const [addyioRecipients, setAddyioRecipients] = useState<
    Array<{ id: string; email: string; emailVerifiedAt: string | null }>
  >([]);
  const [addyioAccountInfo, setAddyioAccountInfo] = useState<any>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');

  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('');
  const [customIdePaths, setCustomIdePaths] = useState<Record<string, string>>({});

  // Email counter state
  const [emailCounter, setEmailCounterState] = useState<number>(0);
  const [isLoadingCounter, setIsLoadingCounter] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [dbPath, setDbPath] = useState<string>('');

  // Validation errors
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Refs for timer cleanup to prevent memory leaks
  const categoryChangeOuterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const categoryChangeInnerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Force re-render when language changes
  void language; // Force re-render on language change

  // Mount animation
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Cleanup auto-save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = (await getSettings()) as unknown as SettingsData;

      setImapServer(data.imapServer || '');
      setImapPort(String(data.imapPort || 993));
      setImapEmail(data.imapEmail || '');
      if (data.imapPassword && data.imapPassword !== '********') {
        setImapPassword(data.imapPassword);
      }

      // Load addy.io settings
      setAddyioEnabled(data.addyioEnabled || false);
      setAddyioApiToken(data.addyioApiToken || '');
      setAddyioAliasFormat(data.addyioAliasFormat || 'uuid');
      setAddyioDomain(data.addyioDomain || '');
      setAddyioAutoDelete(data.addyioAutoDelete || false);
      setAddyioDefaultRecipientId(data.addyioDefaultRecipientId || '');
      setAddyioDescriptionTemplate(data.addyioDescriptionTemplate || '');
      setAddyioFromName(data.addyioFromName || '');

      // Load 33mail settings
      setThirtyThreeMailEnabled(data.thirtyThreeMailEnabled || false);
      setThirtyThreeMailUsername(data.thirtyThreeMailUsername || '');
      setThirtyThreeMailDomain(data.thirtyThreeMailDomain || '33mail.com');

      setProxyEnabled(data.proxyEnabled || false);
      setProxyUrl(data.proxyUrl || '');
      setCustomIdePaths(data.customIdePaths || {});

      if (data.theme && ['light', 'dark', 'system'].includes(data.theme)) {
        setTheme(data.theme as 'light' | 'dark' | 'system');
      }

      // Load email counter for current provider and strategy
      try {
        setIsLoadingCounter(true);
        const counter = await getEmailCounter({
          provider: data.provider || 'kiro',
          strategy: data.emailStrategy || 'counter',
        });
        setEmailCounterState(counter);
      } catch (e) {
        console.error('Failed to load email counter:', e);
        setEmailCounterState(0);
      } finally {
        setIsLoadingCounter(false);
      }

      // Load database path
      try {
        const path = await getDatabasePath();
        setDbPath(path);
      } catch (e) {
        console.error('Failed to get database path:', e);
        setDbPath('./stitch.db'); // Fallback
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      const { addNotification } = useAppStore.getState();
      addNotification({
        type: 'error',
        title: t('settings.loadFailed'),
        message: String(error),
      });
    } finally {
      setIsLoading(false);
    }
  }, [setTheme]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleCategoryChange = (category: SettingsCategory) => {
    if (category === activeCategory) return;

    if (categoryChangeOuterTimerRef.current) {
      clearTimeout(categoryChangeOuterTimerRef.current);
      categoryChangeOuterTimerRef.current = null;
    }
    if (categoryChangeInnerTimerRef.current) {
      clearTimeout(categoryChangeInnerTimerRef.current);
      categoryChangeInnerTimerRef.current = null;
    }

    setIsTransitioning(true);
    categoryChangeOuterTimerRef.current = setTimeout(() => {
      setActiveCategory(category);
      categoryChangeInnerTimerRef.current = setTimeout(() => setIsTransitioning(false), 50);
    }, 150);
  };

  // Cleanup category change timers on unmount
  useEffect(() => {
    return () => {
      if (categoryChangeOuterTimerRef.current) {
        clearTimeout(categoryChangeOuterTimerRef.current);
      }
      if (categoryChangeInnerTimerRef.current) {
        clearTimeout(categoryChangeInnerTimerRef.current);
      }
    };
  }, []);

  // Auto-hide saveStatus with cleanup
  useEffect(() => {
    if (saveStatus !== 'success') return;
    const timer = setTimeout(() => setSaveStatus('idle'), 3000);
    return () => clearTimeout(timer);
  }, [saveStatus]);

  // Validate fields on change
  const validateField = (field: string, value: string) => {
    let error: string | null = null;

    switch (field) {
      case 'imapServer':
        if (value.trim()) {
          error = validateHostname(value);
        }
        break;
      case 'imapPort':
        if (value.trim()) {
          error = validatePort(value);
        }
        break;
      case 'imapEmail':
        if (value.trim()) {
          error = validateEmail(value);
        }
        break;
      case 'proxyUrl':
        if (proxyEnabled && value.trim()) {
          error = validateUrl(value);
        }
        break;
    }

    setValidationErrors(prev => {
      const next = { ...prev };
      if (error) {
        next[field] = error;
      } else {
        delete next[field];
      }
      return next;
    });
  };

  // Test addy.io connection
  const handleTestAddyioConnection = useCallback(async () => {
    if (!addyioApiToken) {
      setConnectionStatus('error');
      setConnectionMessage('Please enter an API token');
      return;
    }

    setIsTestingConnection(true);
    setConnectionStatus('idle');
    setConnectionMessage('');

    try {
      const tokenDetails = await testAddyioConnection(addyioApiToken);
      const [account, domains, recipients] = await Promise.all([
        getAddyioAccount(addyioApiToken),
        getAddyioDomains(addyioApiToken),
        getAddyioRecipients(addyioApiToken),
      ]);

      setAddyioAccountInfo(account);
      setAddyioDomains(domains.data);
      setAddyioRecipients(recipients);

      if (!addyioDomain && domains.defaultAliasDomain) {
        setAddyioDomain(domains.defaultAliasDomain);
      }

      if (!addyioDefaultRecipientId && account.defaultRecipientId) {
        setAddyioDefaultRecipientId(account.defaultRecipientId);
      }

      setConnectionStatus('success');
      setConnectionMessage(`Connected successfully! Token: ${tokenDetails.name}`);

      addLog({
        level: 'success',
        message: 'Addy.io connection test successful',
        source: 'settings',
      });
    } catch (error) {
      setConnectionStatus('error');
      setConnectionMessage(error instanceof Error ? error.message : 'Connection failed');
      addLog({
        level: 'error',
        message: `Addy.io connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        source: 'settings',
      });
    } finally {
      setIsTestingConnection(false);
    }
  }, [addyioApiToken, addyioDomain, addyioDefaultRecipientId, addLog]);

  const handleSave = useCallback(async () => {
    try {
      setIsSaving(true);
      setSaveStatus('idle');
      setErrorMessage('');

      const settingsToSave = {
        theme,
        imapServer: imapServer,
        imapPort: parseInt(imapPort, 10) || 993,
        imapEmail: imapEmail,
        imapUser: imapEmail,
        proxyEnabled: proxyEnabled,
        proxyUrl: proxyUrl,
        imapPassword: imapPassword !== '********' ? imapPassword : '',
        addyioEnabled: addyioEnabled,
        addyioApiToken: addyioApiToken,
        addyioAliasFormat: addyioAliasFormat,
        addyioDomain: addyioDomain,
        addyioAutoDelete: addyioAutoDelete,
        addyioDefaultRecipientId: addyioDefaultRecipientId,
        addyioDescriptionTemplate: addyioDescriptionTemplate,
        addyioFromName: addyioFromName,
        thirtyThreeMailEnabled: thirtyThreeMailEnabled,
        thirtyThreeMailUsername: thirtyThreeMailUsername,
        thirtyThreeMailDomain: thirtyThreeMailDomain,
        customIdePaths: customIdePaths,
        // Removed automation settings (managed in PatcherSettingsDrawer)
      };

      await updateSettings(settingsToSave);

      setSaveStatus('success');
    } catch (error) {
      console.error('[Settings] Save failed:', error);
      setSaveStatus('error');
      setErrorMessage(error instanceof Error ? error.message : t('settings.failedToSave'));
      addLog({
        level: 'error',
        message: `Failed to save settings: ${error instanceof Error ? error.message : 'Unknown error'}`,
        source: 'settings',
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    theme,
    imapServer,
    imapPort,
    imapEmail,
    imapPassword,
    addyioEnabled,
    addyioApiToken,
    addyioAliasFormat,
    addyioDomain,
    addyioAutoDelete,
    addyioDefaultRecipientId,
    addyioDescriptionTemplate,
    addyioFromName,
    thirtyThreeMailEnabled,
    thirtyThreeMailUsername,
    thirtyThreeMailDomain,
    proxyEnabled,
    proxyUrl,
    customIdePaths,
    addLog,
    t,
  ]);

  const debouncedAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      handleSave();
    }, 800);
  }, [handleSave]);

  const handleEmailCounterChange = useCallback(
    async (newCounter: number) => {
      setEmailCounterState(newCounter);
      try {
        const settings = await getSettings();
        await setEmailCounter({
          provider: settings.provider || 'kiro',
          strategy: settings.emailStrategy || 'counter',
          counter: newCounter,
        });
        addLog({
          level: 'success',
          message: `Email counter updated to ${newCounter}`,
          source: 'settings',
        });
      } catch (error) {
        console.error('Failed to update email counter:', error);
        addLog({
          level: 'error',
          message: `Failed to update email counter: ${error instanceof Error ? error.message : 'Unknown error'}`,
          source: 'settings',
        });
      }
    },
    [addLog]
  );

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
  };

  const getAnimationStyle = (index: number) => ({
    opacity: mounted ? 1 : 0,
    transform: mounted ? 'translateY(0)' : 'translateY(8px)',
    transition: `opacity 300ms ease-out ${index * 50}ms, transform 300ms ease-out ${index * 50}ms`,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <Header title={t('settings.title')} icon={<SettingsIcon size={18} />} />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
          <span className="ml-2 text-slate-500 text-sm">{t('settings.loadingSettings')}</span>
        </div>
      </div>
    );
  }

  const renderGeneralSettings = () => (
    <div className="space-y-8" style={getAnimationStyle(0)}>
      {/* Theme Section */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
            <Sun className="w-4 h-4 text-primary" />
            {t('settings.general.appearance')}
          </h3>
          <p className="text-slate-500 text-xs">{t('settings.general.appearanceDescription')}</p>
        </div>
        <div className="flex gap-3">
          {[
            { value: 'light', icon: Sun, labelKey: 'settings.general.light' },
            { value: 'dark', icon: Moon, labelKey: 'settings.general.dark' },
            { value: 'system', icon: Monitor, labelKey: 'settings.general.system' },
          ].map(({ value, icon: Icon, labelKey }) => (
            <button
              key={value}
              onClick={() => handleThemeChange(value as 'light' | 'dark' | 'system')}
              className={`flex items-center gap-2 px-5 py-3 rounded-lg border text-sm font-medium transition-all active:scale-95 duration-75 ${
                theme === value
                  ? 'bg-primary/20 border-primary/50 text-primary shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                  : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Language Section */}
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" />
            {t('settings.general.language')}
          </h3>
          <p className="text-slate-500 text-xs">{t('settings.general.languageDescription')}</p>
        </div>
        <div className="flex gap-3">
          {[
            { value: 'en', label: 'English', flag: '🇺🇸' },
            { value: 'ru', label: 'Русский', flag: '🇷🇺' },
          ].map(({ value, label, flag }) => (
            <button
              key={value}
              onClick={() => setLanguage(value as 'en' | 'ru')}
              className={`flex items-center gap-2 px-5 py-3 rounded-lg border text-sm font-medium transition-all active:scale-95 duration-75 ${
                language === value
                  ? 'bg-primary/20 border-primary/50 text-primary shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                  : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              <span className="text-base">{flag}</span>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* UI Scale Section */}
      <div className="space-y-4 pt-6 border-t border-white/10">
        <div>
          <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-primary" />
            {t('settings.general.uiScale')}
          </h3>
          <p className="text-slate-500 text-xs">{t('settings.general.uiScaleDescription')}</p>
        </div>
        <div className="max-w-md bg-white/[0.02] border border-white/5 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-slate-300">
              {t('settings.general.scale')}
            </span>
            <span className="text-sm font-mono font-bold text-primary">
              {Math.round(uiScale * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0.7"
            max="1.3"
            step="0.05"
            value={uiScale}
            onChange={e => setUIScale(parseFloat(e.target.value))}
            className="w-full accent-primary h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer"
          />
          <div className="flex justify-between mt-2 text-[10px] text-slate-500 font-medium uppercase tracking-tighter">
            <span>{t('settings.general.scaleSmall')}</span>
            <button
              onClick={() => setUIScale(1.0)}
              className="text-primary/60 hover:text-primary transition-colors"
            >
              {t('settings.general.scaleReset')}
            </button>
            <span>{t('settings.general.scaleLarge')}</span>
          </div>
        </div>
      </div>

      {/* IDE Paths Section */}
      <div className="space-y-4 pt-6 border-t border-white/10">
        <div>
          <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
            <Code className="w-4 h-4 text-primary" />
            {t('settings.idePaths.title')}
          </h3>
          <p className="text-slate-500 text-xs">{t('settings.idePaths.description')}</p>
        </div>
        <div className="space-y-4">
          {['kiro', 'windsurf', 'trae'].map(ide => (
            <div key={ide} className="flex items-center gap-4">
              <span className="text-[10px] uppercase font-bold text-slate-500 w-20 px-1">
                {ide}
              </span>
              <Input
                placeholder={`Path to ${ide} extension folder...`}
                value={customIdePaths[ide] || ''}
                onChange={e => setCustomIdePaths(prev => ({ ...prev, [ide]: e.target.value }))}
                className="font-mono text-xs"
                rightElement={
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={async () => {
                        try {
                          const selected = await open({
                            directory: true,
                            title: `Select ${ide} extension folder`,
                          });
                          if (selected) {
                            setCustomIdePaths(prev => ({ ...prev, [ide]: selected as string }));
                          }
                        } catch (e) {
                          console.error('Failed to open folder dialog:', e);
                        }
                      }}
                    >
                      <FolderOpen size={14} />
                    </Button>
                    {customIdePaths[ide] && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-500/50 hover:text-red-400"
                        onClick={() =>
                          setCustomIdePaths(prev => {
                            const next = { ...prev };
                            delete next[ide];
                            return next;
                          })
                        }
                      >
                        <X size={14} />
                      </Button>
                    )}
                  </div>
                }
              />
            </div>
          ))}
        </div>
      </div>

      {/* Database Info Section */}
      <div className="space-y-4 pt-6 border-t border-white/10">
        <div>
          <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
            <Database className="w-4 h-4 text-slate-500" />
            {t('settings.database.title')}
          </h3>
        </div>
        <div className="glass-card rounded-lg p-3 bg-white/[0.02]">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-xs">{t('settings.database.location')}</span>
            <div className="flex items-center gap-2">
              <span className="text-slate-300 font-mono text-xs break-all max-w-[400px] text-right">
                {dbPath || './stitch.db'}
              </span>
              <Tooltip content={t('common.copy')}>
                <button
                  onClick={() => copy(dbPath || './stitch.db')}
                  className="p-1 hover:bg-white/10 rounded transition-colors text-slate-400 hover:text-white"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderConnectivitySettings = () => (
    <div className="space-y-8" style={getAnimationStyle(0)}>
      {/* Proxy Settings */}
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" />
            {t('settings.proxy.title')}
          </h3>
          <p className="text-slate-500 text-xs">{t('settings.proxy.description')}</p>
        </div>
        <div className="glass-card rounded-lg p-4 border border-white/10 space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={proxyEnabled}
              onChange={e => {
                setProxyEnabled(e.target.checked);
                debouncedAutoSave();
              }}
              className="w-4 h-4 rounded border-white/20 bg-white/5 text-primary focus:ring-0 focus:ring-offset-0 transition-colors"
            />
            <span className="text-slate-300 text-sm">{t('settings.proxy.enableProxy')}</span>
          </label>
          {proxyEnabled && (
            <div>
              <label className="input-label">{t('settings.proxy.proxyUrl')}</label>
              <input
                type="text"
                value={proxyUrl}
                onChange={e => {
                  setProxyUrl(e.target.value);
                  validateField('proxyUrl', e.target.value);
                  debouncedAutoSave();
                }}
                onBlur={e => validateField('proxyUrl', e.target.value)}
                placeholder="http://user:pass@host:port"
                className={`input-ds text-sm transition-all duration-200 ${
                  validationErrors.proxyUrl
                    ? 'border-red-500 focus:border-red-500'
                    : 'focus:border-primary'
                }`}
              />
              {validationErrors.proxyUrl && (
                <div className="flex items-center gap-1.5 mt-1.5 text-red-400 text-xs">
                  <AlertCircle className="w-3 h-3" />
                  {validationErrors.proxyUrl}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* IMAP Settings */}
      <div className="space-y-6 pt-6 border-t border-white/10">
        <div>
          <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
            <Server className="w-4 h-4 text-primary" />
            {t('settings.imap.title')}
          </h3>
          <p className="text-slate-500 text-xs">{t('settings.imap.description')}</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="input-label">{t('settings.imap.server')}</label>
            <input
              type="text"
              value={imapServer}
              onChange={e => {
                setImapServer(e.target.value);
                validateField('imapServer', e.target.value);
                debouncedAutoSave();
              }}
              onBlur={e => validateField('imapServer', e.target.value)}
              placeholder="imap.example.com"
              className={`input-ds text-sm transition-all duration-200 ${
                validationErrors.imapServer ? 'border-red-500' : 'focus:border-primary'
              }`}
            />
          </div>
          <div>
            <label className="input-label">{t('settings.imap.port')}</label>
            <input
              type="text"
              value={imapPort}
              onChange={e => {
                setImapPort(e.target.value);
                validateField('imapPort', e.target.value);
                debouncedAutoSave();
              }}
              className="input-ds text-sm transition-all duration-200"
            />
          </div>
          <div>
            <label className="input-label">{t('settings.imap.emailAddress')}</label>
            <input
              type="email"
              value={imapEmail}
              onChange={e => {
                setImapEmail(e.target.value);
                validateField('imapEmail', e.target.value);
                debouncedAutoSave();
              }}
              className="input-ds text-sm transition-all duration-200"
            />
          </div>
          <div>
            <label className="input-label">{t('settings.imap.password')}</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={imapPassword}
                onChange={e => {
                  setImapPassword(e.target.value);
                  debouncedAutoSave();
                }}
                placeholder="••••••••"
                className="input-ds text-sm pr-10 transition-all duration-200"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-white"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Email Counter Section */}
      <div className="space-y-6 pt-6 border-t border-white/10">
        <div>
          <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-primary" />
            Email Counter
          </h3>
          <p className="text-slate-500 text-xs">
            Current counter value for COUNTER email strategy (e.g., user+1@domain.com, user+2@domain.com)
          </p>
        </div>
        <div className="max-w-xs">
          <label className="input-label">Counter Value</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              value={emailCounter}
              onChange={e => handleEmailCounterChange(parseInt(e.target.value, 10) || 0)}
              disabled={isLoadingCounter}
              className="input-ds text-sm transition-all duration-200"
              placeholder="0"
            />
            {isLoadingCounter && (
              <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1.5">
            Next registration will use: user+{emailCounter + 1}@domain.com
          </p>
        </div>
      </div>

      {/* Email Services (Addy.io / 33mail) */}
      <div className="space-y-6 pt-6 border-t border-white/10">
        <div>
          <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
            <Shield className="w-4 h-4 text-indigo-400" />
            {t('autoReg.emailAliases')}
          </h3>
          <p className="text-slate-500 text-xs">Configure third-party email alias services.</p>
        </div>

        {/* Addy.io */}
        <div
          className={`glass-card rounded-lg p-4 border border-white/10 space-y-4 transition-opacity duration-200 ${
            !addyioEnabled ? 'opacity-60 hover:opacity-100' : ''
          }`}
        >
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={addyioEnabled}
              onChange={e => {
                setAddyioEnabled(e.target.checked);
                if (e.target.checked) setThirtyThreeMailEnabled(false);
                debouncedAutoSave();
              }}
              className="w-4 h-4 rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-0 transition-colors"
            />
            <span className="text-slate-300 text-sm">{t('autoReg.configureAddyio')}</span>
          </label>
          {addyioEnabled && (
            <div className="space-y-4 pl-7 animate-in fade-in zoom-in-95 duration-200">
              <div>
                <label className="input-label">API Token</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={addyioApiToken}
                    onChange={e => {
                      setAddyioApiToken(e.target.value);
                      setConnectionStatus('idle'); // Reset status on change
                      debouncedAutoSave();
                    }}
                    className="input-ds text-sm pr-10"
                    placeholder="addy_..."
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Test Connection Button */}
              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleTestAddyioConnection}
                  disabled={isTestingConnection || !addyioApiToken}
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  leftIcon={
                    isTestingConnection ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )
                  }
                >
                  {isTestingConnection ? 'Testing...' : 'Test Connection'}
                </Button>

                {connectionStatus !== 'idle' && (
                  <div
                    className={`text-xs flex items-center gap-1.5 ${
                      connectionStatus === 'success' ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {connectionStatus === 'success' ? (
                      <CheckCircle className="w-3 h-3" />
                    ) : (
                      <AlertCircle className="w-3 h-3" />
                    )}
                    {connectionMessage}
                  </div>
                )}
              </div>

              {/* Account Status Card */}
              {addyioAccountInfo && (
                <div className="glass-card rounded-lg p-3 border border-indigo-500/20 bg-indigo-500/5 mt-2">
                  <h4 className="text-white font-medium text-xs mb-2 flex items-center gap-2">
                    <CheckCircle className="w-3 h-3 text-emerald-400" />
                    Account Status
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-slate-500">Subscription:</span>
                      <span className="text-white ml-2 font-medium">
                        {addyioAccountInfo.subscription}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Bandwidth:</span>
                      <span className="text-white ml-2 font-medium">
                        {(addyioAccountInfo.bandwidth / 1024 / 1024).toFixed(1)} MB
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Dynamic Fields (only show if domains loaded or manual entry) */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Domain</label>
                  {addyioDomains.length > 0 ? (
                    <Select
                      value={addyioDomain}
                      onChange={e => {
                        setAddyioDomain(e.target.value);
                        debouncedAutoSave();
                      }}
                      options={[
                        { value: '', label: 'Select domain...' },
                        ...addyioDomains.map(d => ({ value: d, label: d })),
                      ]}
                    />
                  ) : (
                    <input
                      type="text"
                      value={addyioDomain}
                      onChange={e => {
                        setAddyioDomain(e.target.value);
                        debouncedAutoSave();
                      }}
                      className="input-ds text-sm"
                      placeholder="anonaddy.me"
                    />
                  )}
                </div>

                <div>
                  <label className="input-label">Format</label>
                  <Select
                    value={addyioAliasFormat}
                    onChange={e => {
                      setAddyioAliasFormat(e.target.value);
                      debouncedAutoSave();
                    }}
                    options={[
                      { value: 'uuid', label: 'UUID' },
                      { value: 'random_words', label: 'Random Words' },
                      { value: 'random_characters', label: 'Random Chars' },
                    ]}
                  />
                </div>
              </div>

              {/* Default Recipient */}
              {addyioRecipients.length > 0 && (
                <Select
                  value={addyioDefaultRecipientId}
                  onChange={e => {
                    setAddyioDefaultRecipientId(e.target.value);
                    debouncedAutoSave();
                  }}
                  options={[
                    { value: '', label: 'Use account default' },
                    ...addyioRecipients.map(r => ({
                      value: r.id,
                      label: `${r.email} ${r.emailVerifiedAt ? '✓' : '(unverified)'}`,
                    })),
                  ]}
                />
              )}

              {/* Advanced Options */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Description Template</label>
                  <input
                    type="text"
                    value={addyioDescriptionTemplate}
                    onChange={e => {
                      setAddyioDescriptionTemplate(e.target.value);
                      debouncedAutoSave();
                    }}
                    className="input-ds text-sm"
                    placeholder="{provider} - {date}"
                  />
                </div>
                <div>
                  <label className="input-label">From Name</label>
                  <input
                    type="text"
                    value={addyioFromName}
                    onChange={e => {
                      setAddyioFromName(e.target.value);
                      debouncedAutoSave();
                    }}
                    className="input-ds text-sm"
                    placeholder="My Alias"
                  />
                </div>
              </div>

              <label className="flex items-center gap-3 cursor-pointer mt-2">
                <input
                  type="checkbox"
                  checked={addyioAutoDelete}
                  onChange={e => {
                    setAddyioAutoDelete(e.target.checked);
                    debouncedAutoSave();
                  }}
                  className="w-4 h-4 rounded border-white/20 bg-white/5 text-indigo-500 focus:ring-0 transition-colors"
                />
                <span className="text-slate-300 text-sm">Auto-delete aliases</span>
              </label>
            </div>
          )}
        </div>

        {/* 33mail */}
        <div
          className={`glass-card rounded-lg p-4 border border-white/10 space-y-4 transition-opacity duration-200 ${
            !thirtyThreeMailEnabled ? 'opacity-60 hover:opacity-100' : ''
          }`}
        >
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={thirtyThreeMailEnabled}
              onChange={e => {
                setThirtyThreeMailEnabled(e.target.checked);
                if (e.target.checked) setAddyioEnabled(false);
                debouncedAutoSave();
              }}
              className="w-4 h-4 rounded border-white/20 bg-white/5 text-purple-500 focus:ring-0 transition-colors"
            />
            <span className="text-slate-300 text-sm">{t('autoReg.configure33mail')}</span>
          </label>
          {thirtyThreeMailEnabled && (
            <div className="space-y-4 pl-7 animate-in fade-in zoom-in-95 duration-200">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="input-label">Username</label>
                  <input
                    type="text"
                    value={thirtyThreeMailUsername}
                    onChange={e => {
                      setThirtyThreeMailUsername(e.target.value);
                      debouncedAutoSave();
                    }}
                    className="input-ds text-sm"
                    placeholder="user"
                  />
                </div>
                <div>
                  <label className="input-label">Domain</label>
                  <input
                    type="text"
                    value={thirtyThreeMailDomain}
                    onChange={e => {
                      setThirtyThreeMailDomain(e.target.value);
                      debouncedAutoSave();
                    }}
                    className="input-ds text-sm"
                    placeholder="33mail.com"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (activeCategory) {
      case 'general':
        return renderGeneralSettings();
      case 'connectivity':
        return renderConnectivitySettings();
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0a0a0c]">
      <Header title={t('settings.title')} icon={<SettingsIcon size={18} />} />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 border-r border-white/5 bg-[#0f1115]/50 flex flex-col p-4 gap-1 overflow-y-auto">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => handleCategoryChange(cat.id)}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                activeCategory === cat.id
                  ? 'bg-primary/10 text-primary border border-primary/20 shadow-[0_0_10px_rgba(99,102,241,0.1)]'
                  : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              {cat.icon}
              {t(cat.labelKey)}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-8 relative">
          {/* Transition wrapper */}
          <div
            className={`transition-all duration-150 ease-out ${
              isTransitioning ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'
            }`}
          >
            {renderContent()}
          </div>
        </div>
      </div>

      {/* Footer / Status Bar (optional, for save status) */}
      <div className="px-6 py-3 border-t border-white/5 bg-[#0f1115] flex justify-end items-center gap-4">
        {isSaving && (
          <span className="text-xs text-slate-400 flex items-center gap-1.5 animate-pulse">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Saving...
          </span>
        )}
        {saveStatus === 'success' && !isSaving && (
          <span className="text-xs text-emerald-400 flex items-center gap-1.5 animate-in fade-in slide-in-from-bottom-2">
            <CheckCircle className="w-3.5 h-3.5" />
            Settings saved
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="text-xs text-red-400 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            {errorMessage || t('settings.failedToSave')}
          </span>
        )}
      </div>
    </div>
  );
}
