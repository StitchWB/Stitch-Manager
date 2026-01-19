import { useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { 
  Settings as SettingsIcon, 
  Moon, 
  Sun, 
  Monitor, 
  Database, 
  Mail, 
  Globe, 
  Save, 
  Loader2, 
  CheckCircle, 
  AlertCircle, 
  FolderOpen, 
  X, 
  Code,
  Eye,
  EyeOff,
  Palette,
  Zap,
  RefreshCw,
  Coins
} from 'lucide-react';
import { useAppStore } from '../stores/app';
import { useLogsStore } from '../stores/logs';
import { getSettings, updateSettings, getDatabasePath } from '../lib/tauri';
import { open } from '@tauri-apps/plugin-dialog';
import Header from '../components/layout/Header';
import { t } from '../lib/i18n';
import PoolSettingsPanel from '../components/settings/PoolSettingsPanel';
import { validatePort, validateHostname, validateEmail, validateUrl } from '../lib/validation';

interface SettingsData {
  theme: string;
  imap_server: string;
  imap_port: number;
  imap_email: string;
  imap_password: string;
  proxy_enabled: boolean;
  proxy_url: string;
  custom_ide_paths?: Record<string, string>;
  // Patcher settings
  auto_rotate_enabled?: boolean;
  log_requests_enabled?: boolean;
  spoof_machine_id_enabled?: boolean;
}

type SettingsCategory = 'general' | 'patcher' | 'token-pool' | 'imap' | 'proxy' | 'ide-paths' | 'database';

interface CategoryConfig {
  id: SettingsCategory;
  labelKey: string;
  icon: ReactNode;
}

const categories: CategoryConfig[] = [
  { id: 'general', labelKey: 'settings.categories.general', icon: <Palette className="w-4 h-4" /> },
  { id: 'patcher', labelKey: 'settings.categories.patcher', icon: <Zap className="w-4 h-4" /> },
  { id: 'token-pool', labelKey: 'settings.categories.tokenPool', icon: <Coins className="w-4 h-4" /> },
  { id: 'imap', labelKey: 'settings.categories.imap', icon: <Mail className="w-4 h-4" /> },
  { id: 'proxy', labelKey: 'settings.categories.proxy', icon: <Globe className="w-4 h-4" /> },
  { id: 'ide-paths', labelKey: 'settings.categories.idePaths', icon: <Code className="w-4 h-4" /> },
  { id: 'database', labelKey: 'settings.categories.database', icon: <Database className="w-4 h-4" /> },
];

export default function Settings() {
  const { theme, setTheme, language, setLanguage } = useAppStore();
  const { addLog } = useLogsStore();
  
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('general');
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mounted, setMounted] = useState(false);
  
  const [imapServer, setImapServer] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [imapEmail, setImapEmail] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('');
  const [customIdePaths, setCustomIdePaths] = useState<Record<string, string>>({});
  
  // Patcher settings
  const [autoRotateEnabled, setAutoRotateEnabled] = useState(true);
  const [logRequestsEnabled, setLogRequestsEnabled] = useState(true);
  const [spoofMachineIdEnabled, setSpoofMachineIdEnabled] = useState(true);
  
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

  // Force re-render when language changes
  void language; // Force re-render on language change

  // Mount animation
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await getSettings() as unknown as SettingsData;
      
      setImapServer(data.imap_server || '');
      setImapPort(String(data.imap_port || 993));
      setImapEmail(data.imap_email || '');
      if (data.imap_password && data.imap_password !== '********') {
        setImapPassword(data.imap_password);
      }
      setProxyEnabled(data.proxy_enabled || false);
      setProxyUrl(data.proxy_url || '');
      setCustomIdePaths(data.custom_ide_paths || {});
      
      // Load patcher settings
      setAutoRotateEnabled(data.auto_rotate_enabled ?? true);
      setLogRequestsEnabled(data.log_requests_enabled ?? true);
      setSpoofMachineIdEnabled(data.spoof_machine_id_enabled ?? true);
      
      if (data.theme && ['light', 'dark', 'system'].includes(data.theme)) {
        setTheme(data.theme as 'light' | 'dark' | 'system');
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
    
    // Clear any existing timers to prevent memory leaks
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

  // Check if form has validation errors
  const hasValidationErrors = Object.keys(validationErrors).length > 0;

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setSaveStatus('idle');
      setErrorMessage('');
      
      const settingsToSave = {
        theme,
        imap_server: imapServer,
        imap_port: parseInt(imapPort, 10) || 993,
        imap_email: imapEmail,
        proxy_enabled: proxyEnabled,
        proxy_url: proxyUrl,
        imap_password: imapPassword !== '********' ? imapPassword : '',
        custom_ide_paths: customIdePaths,
        // Patcher settings
        auto_rotate_enabled: autoRotateEnabled,
        log_requests_enabled: logRequestsEnabled,
        spoof_machine_id_enabled: spoofMachineIdEnabled,
      };
      
      await updateSettings(settingsToSave);
      setSaveStatus('success');
      addLog({
        level: 'success',
        message: 'Settings saved successfully',
        source: 'settings',
      });
    } catch (error) {
      console.error('Failed to save settings:', error);
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
  };

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
  };

  // Staggered animation helper
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
      <div>
        <div>
          <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
            <Sun className="w-4 h-4 text-primary" />
            {t('settings.general.appearance')}
          </h3>
          <p className="text-slate-500 text-xs mb-4">{t('settings.general.appearanceDescription')}</p>
        </div>
        <div className="flex gap-3">
          {[
            { value: 'light', icon: Sun, labelKey: 'settings.general.light' },
            { value: 'dark', icon: Moon, labelKey: 'settings.general.dark' },
            { value: 'system', icon: Monitor, labelKey: 'settings.general.system' },
          ].map(({ value, icon: Icon, labelKey }, i) => (
            <button
              key={value}
              onClick={() => handleThemeChange(value as 'light' | 'dark' | 'system')}
              style={getAnimationStyle(i + 1)}
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
      <div>
        <div>
          <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" />
            {t('settings.general.language')}
          </h3>
          <p className="text-slate-500 text-xs mb-4">{t('settings.general.languageDescription')}</p>
        </div>
        <div className="flex gap-3">
          {[
            { value: 'en', label: 'English', flag: '🇺🇸' },
            { value: 'ru', label: 'Русский', flag: '🇷🇺' },
          ].map(({ value, label, flag }, i) => (
            <button
              key={value}
              onClick={() => setLanguage(value as 'en' | 'ru')}
              style={getAnimationStyle(i + 4)}
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
    </div>
  );

  const renderPatcherSettings = () => (
    <div className="space-y-6">
      <div style={getAnimationStyle(0)}>
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-400" />
          {t('settings.patcher.title')}
        </h3>
        <p className="text-slate-500 text-xs mb-4">{t('settings.patcher.description')}</p>
      </div>

      {/* Auto-Rotate Toggle */}
      <div 
        className="glass-card rounded-lg p-4 border border-white/10"
        style={getAnimationStyle(1)}
      >
        <label className="flex items-start gap-4 cursor-pointer">
          <div className="pt-0.5">
            <input
              type="checkbox"
              checked={autoRotateEnabled}
              onChange={(e) => setAutoRotateEnabled(e.target.checked)}
              className="w-5 h-5 rounded border-white/20 bg-white/5 text-amber-500 focus:ring-amber-500/50 focus:ring-offset-0 transition-colors"
            />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <RefreshCw className="w-4 h-4 text-amber-400" />
              <span className="text-white font-medium text-sm">{t('settings.patcher.autoRotate')}</span>
            </div>
            <p className="text-slate-500 text-xs leading-relaxed">
              {t('settings.patcher.autoRotateDescription')}
            </p>
          </div>
        </label>
      </div>

      {/* Log Requests Toggle */}
      <div 
        className="glass-card rounded-lg p-4 border border-white/10"
        style={getAnimationStyle(2)}
      >
        <label className="flex items-start gap-4 cursor-pointer">
          <div className="pt-0.5">
            <input
              type="checkbox"
              checked={logRequestsEnabled}
              onChange={(e) => setLogRequestsEnabled(e.target.checked)}
              className="w-5 h-5 rounded border-white/20 bg-white/5 text-primary focus:ring-primary/50 focus:ring-offset-0 transition-colors"
            />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Code className="w-4 h-4 text-primary" />
              <span className="text-white font-medium text-sm">{t('settings.patcher.logRequests')}</span>
            </div>
            <p className="text-slate-500 text-xs leading-relaxed">
              {t('settings.patcher.logRequestsDescription')}
            </p>
          </div>
        </label>
      </div>

      {/* Spoof Machine ID Toggle */}
      <div 
        className="glass-card rounded-lg p-4 border border-white/10"
        style={getAnimationStyle(3)}
      >
        <label className="flex items-start gap-4 cursor-pointer">
          <div className="pt-0.5">
            <input
              type="checkbox"
              checked={spoofMachineIdEnabled}
              onChange={(e) => setSpoofMachineIdEnabled(e.target.checked)}
              className="w-5 h-5 rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-emerald-500/50 focus:ring-offset-0 transition-colors"
            />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Monitor className="w-4 h-4 text-emerald-400" />
              <span className="text-white font-medium text-sm">{t('settings.patcher.spoofMachineId')}</span>
            </div>
            <p className="text-slate-500 text-xs leading-relaxed">
              {t('settings.patcher.spoofMachineIdDescription')}
            </p>
          </div>
        </label>
      </div>

      {/* Info Box */}
      <div 
        className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4"
        style={getAnimationStyle(4)}
      >
        <p className="text-amber-200/80 text-xs leading-relaxed">
          <strong className="text-amber-300">⚡ {t('settings.patcher.note')}:</strong> {t('settings.patcher.noteDescription')}
        </p>
      </div>
    </div>
  );

  const renderImapSettings = () => (
    <div className="space-y-6">
      <div style={getAnimationStyle(0)}>
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <Mail className="w-4 h-4 text-primary" />
          {t('settings.imap.title')}
        </h3>
        <p className="text-slate-500 text-xs mb-4">{t('settings.imap.description')}</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div style={getAnimationStyle(1)}>
          <label className="input-label">{t('settings.imap.server')}</label>
          <input
            type="text"
            value={imapServer}
            onChange={(e) => {
              setImapServer(e.target.value);
              validateField('imapServer', e.target.value);
            }}
            onBlur={(e) => validateField('imapServer', e.target.value)}
            placeholder="imap.example.com"
            className={`input-ds text-sm transition-all duration-200 ${
              validationErrors.imapServer ? 'border-red-500 focus:border-red-500' : 'focus:border-primary'
            }`}
          />
          {validationErrors.imapServer && (
            <div className="flex items-center gap-1.5 mt-1.5 text-red-400 text-xs">
              <AlertCircle className="w-3 h-3" />
              {validationErrors.imapServer}
            </div>
          )}
        </div>
        <div style={getAnimationStyle(2)}>
          <label className="input-label">{t('settings.imap.port')}</label>
          <input
            type="text"
            value={imapPort}
            onChange={(e) => {
              setImapPort(e.target.value);
              validateField('imapPort', e.target.value);
            }}
            onBlur={(e) => validateField('imapPort', e.target.value)}
            placeholder="993"
            className={`input-ds text-sm transition-all duration-200 ${
              validationErrors.imapPort ? 'border-red-500 focus:border-red-500' : 'focus:border-primary'
            }`}
          />
          {validationErrors.imapPort && (
            <div className="flex items-center gap-1.5 mt-1.5 text-red-400 text-xs">
              <AlertCircle className="w-3 h-3" />
              {validationErrors.imapPort}
            </div>
          )}
        </div>
        <div style={getAnimationStyle(3)}>
          <label className="input-label">{t('settings.imap.emailAddress')}</label>
          <input
            type="email"
            value={imapEmail}
            onChange={(e) => {
              setImapEmail(e.target.value);
              validateField('imapEmail', e.target.value);
            }}
            onBlur={(e) => validateField('imapEmail', e.target.value)}
            placeholder="user@example.com"
            className={`input-ds text-sm transition-all duration-200 ${
              validationErrors.imapEmail ? 'border-red-500 focus:border-red-500' : 'focus:border-primary'
            }`}
          />
          {validationErrors.imapEmail && (
            <div className="flex items-center gap-1.5 mt-1.5 text-red-400 text-xs">
              <AlertCircle className="w-3 h-3" />
              {validationErrors.imapEmail}
            </div>
          )}
        </div>
        <div style={getAnimationStyle(4)}>
          <label className="input-label">{t('settings.imap.password')}</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={imapPassword}
              onChange={(e) => setImapPassword(e.target.value)}
              placeholder="••••••••"
              className="input-ds text-sm pr-10 transition-all duration-200 focus:border-primary"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-white transition-colors active:scale-95"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderProxySettings = () => (
    <div className="space-y-6">
      <div style={getAnimationStyle(0)}>
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" />
          {t('settings.proxy.title')}
        </h3>
        <p className="text-slate-500 text-xs mb-4">{t('settings.proxy.description')}</p>
      </div>
      <div className="space-y-4">
        <label className="flex items-center gap-3 cursor-pointer" style={getAnimationStyle(1)}>
          <input
            type="checkbox"
            checked={proxyEnabled}
            onChange={(e) => setProxyEnabled(e.target.checked)}
            className="w-4 h-4 rounded border-white/20 bg-white/5 text-primary focus:ring-0 focus:ring-offset-0 transition-colors"
          />
          <span className="text-slate-300 text-sm">{t('settings.proxy.enableProxy')}</span>
        </label>
        {proxyEnabled && (
          <div style={getAnimationStyle(2)}>
            <label className="input-label">{t('settings.proxy.proxyUrl')}</label>
            <input
              type="text"
              value={proxyUrl}
              onChange={(e) => {
                setProxyUrl(e.target.value);
                validateField('proxyUrl', e.target.value);
              }}
              onBlur={(e) => validateField('proxyUrl', e.target.value)}
              placeholder="http://proxy:8080"
              className={`input-ds text-sm transition-all duration-200 ${
                validationErrors.proxyUrl ? 'border-red-500 focus:border-red-500' : 'focus:border-primary'
              }`}
            />
            {validationErrors.proxyUrl && (
              <div className="flex items-center gap-1.5 mt-1.5 text-red-400 text-xs">
                <AlertCircle className="w-3 h-3" />
                {validationErrors.proxyUrl}
              </div>
            )}
            <p className="text-slate-500 text-xs mt-2">
              {t('settings.proxy.proxyUrlHint')}
            </p>
          </div>
        )}
      </div>
    </div>
  );

  const renderIdePathsSettings = () => (
    <div className="space-y-6">
      <div style={getAnimationStyle(0)}>
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <Code className="w-4 h-4 text-primary" />
          {t('settings.idePaths.title')}
        </h3>
        <p className="text-slate-500 text-xs mb-4">
          {t('settings.idePaths.description')}
        </p>
      </div>
      <div className="space-y-3">
        {['kiro', 'windsurf', 'trae'].map((ide, index) => (
          <div 
            key={ide} 
            className="flex items-center gap-3"
            style={getAnimationStyle(index + 1)}
          >
            <span className="text-slate-400 w-20 capitalize text-sm font-medium">{ide}</span>
            <input
              type="text"
              value={customIdePaths[ide] || ''}
              onChange={(e) => setCustomIdePaths(prev => ({ ...prev, [ide]: e.target.value }))}
              placeholder={`Path to ${ide} extension folder...`}
              className="flex-1 input-ds text-xs transition-all duration-200 focus:border-primary"
            />
            <button
              onClick={async () => {
                try {
                  const selected = await open({ directory: true, title: `Select ${ide} extension folder` });
                  if (selected) {
                    setCustomIdePaths(prev => ({ ...prev, [ide]: selected as string }));
                  }
                } catch (e) {
                  console.error('Failed to open folder dialog:', e);
                  const { addNotification } = useAppStore.getState();
                  addNotification({
                    type: 'error',
                    title: t('settings.folderDialogFailed'),
                    message: String(e),
                  });
                }
              }}
              className="btn-icon active:scale-95 transition-transform duration-75 hover:bg-white/[0.08]"
              title={t('common.browse')}
            >
              <FolderOpen className="w-4 h-4" />
            </button>
            {customIdePaths[ide] && (
              <button
                onClick={() => setCustomIdePaths(prev => {
                  const next = { ...prev };
                  delete next[ide];
                  return next;
                })}
                className="btn-icon text-red-400 hover:text-red-300 hover:bg-red-500/10 active:scale-95 transition-all duration-75"
                title={t('common.clear')}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="text-slate-500 text-xs mt-4" style={getAnimationStyle(4)}>
        {t('settings.idePaths.pathExample')}
      </p>
    </div>
  );

  const renderDatabaseSettings = () => (
    <div className="space-y-6">
      <div style={getAnimationStyle(0)}>
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          {t('settings.database.title')}
        </h3>
        <p className="text-slate-500 text-xs mb-4">{t('settings.database.description')}</p>
      </div>
      <div className="space-y-4">
        <div 
          className="glass-card rounded-lg p-4"
          style={getAnimationStyle(1)}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-slate-400 text-sm">{t('settings.database.location')}</span>
            <span className="text-slate-200 font-mono text-xs break-all max-w-[300px] text-right">{dbPath || './stitch.db'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-sm">{t('settings.database.type')}</span>
            <span className="text-slate-200 text-sm">SQLite</span>
          </div>
        </div>
        <p className="text-slate-500 text-xs" style={getAnimationStyle(2)}>
          {t('settings.database.sqliteDescription')}
        </p>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (activeCategory) {
      case 'general':
        return renderGeneralSettings();
      case 'patcher':
        return renderPatcherSettings();
      case 'token-pool':
        return <PoolSettingsPanel getAnimationStyle={getAnimationStyle} />;
      case 'imap':
        return renderImapSettings();
      case 'proxy':
        return renderProxySettings();
      case 'ide-paths':
        return renderIdePathsSettings();
      case 'database':
        return renderDatabaseSettings();
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header 
        title={t('settings.title')} 
        subtitle={t('settings.subtitle')}
        icon={<SettingsIcon size={18} />}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Deep Space Void with improved spacing */}
        <div 
          className="w-52 shrink-0 border-r border-white/5 flex flex-col"
          style={{ background: 'rgba(15, 23, 42, 0.3)' }}
        >
          <nav className="flex-1 py-4">
            {categories.map((category, index) => (
              <button
                key={category.id}
                onClick={() => handleCategoryChange(category.id)}
                style={getAnimationStyle(index + 1)}
                className={`relative w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-all duration-200 ${
                  activeCategory === category.id
                    ? 'bg-white/5 text-white'
                    : 'text-slate-500 hover:bg-white/[0.02] hover:text-slate-300'
                }`}
              >
                {/* Active indicator bar */}
                {activeCategory === category.id && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-purple-500 rounded-r" />
                )}
                <span className={`transition-colors duration-200 ${activeCategory === category.id ? 'text-purple-400' : ''}`}>
                  {category.icon}
                </span>
                {t(category.labelKey)}
              </button>
            ))}
          </nav>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Scrollable Form Area */}
          <div className="flex-1 overflow-y-auto p-6">
            <div 
              className={`max-w-2xl transition-all duration-150 ${
                isTransitioning ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'
              }`}
            >
              {renderContent()}
            </div>
          </div>

          {/* Save Button - Fixed at bottom with glassmorphism */}
          <div 
            className="shrink-0 p-4 border-t border-white/10 bg-slate-950/80 backdrop-blur-xl"
            style={getAnimationStyle(6)}
          >
            <div className="flex items-center justify-end gap-3">
              {saveStatus === 'success' && (
                <span className="flex items-center gap-1.5 text-emerald-400 text-xs animate-fade-in">
                  <CheckCircle className="w-3.5 h-3.5" />
                  {t('settings.settingsSaved')}
                </span>
              )}
              {saveStatus === 'error' && (
                <span className="flex items-center gap-1.5 text-red-400 text-xs animate-fade-in">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {errorMessage || t('settings.failedToSave')}
                </span>
              )}
              <button 
                onClick={handleSave} 
                disabled={isSaving || hasValidationErrors} 
                className={`btn-primary py-2 px-5 text-sm flex items-center gap-2 active:scale-95 transition-all duration-75 ${
                  !isSaving && !hasValidationErrors ? 'hover:shadow-[0_0_20px_rgba(99,102,241,0.4)]' : 'opacity-50 cursor-not-allowed'
                }`}
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {t('settings.saveSettings')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
