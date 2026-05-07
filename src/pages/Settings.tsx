import { useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import {
  Settings as SettingsIcon,
  Globe,
  Repeat,
  CheckCircle,
  AlertCircle,
  Zap,
  Table2,
  Puzzle,
} from 'lucide-react';
import { useAppStore } from '../stores/app';
import { useLogsStore } from '../stores/logs';
import { useRegistrationStore } from '../stores/registration';
import { useUIState } from '../hooks/useUIState';
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
} from '@/lib/tauri';
import { normalizeSpreadsheetId } from '@/lib/tauri/modules/googleSheets';
import { SettingsData } from '../types/generated';
import Header from '../components/layout/Header';
import { t } from '../lib/i18n';
import { validatePort, validateHostname, validateEmail } from '../lib/validation';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import {
  ThemeLanguageSection,
  UIScaleSection,
  IDEPathsSection,
  DatabaseSection,
  IMAPSettingsSection,
  EmailCounterSection,
  EmailServicesSection,
  GoogleSheetsSettingsSection,
  ExtensionSettingsSection,
} from '../components/settings';

const SETTINGS_SECRET_MASK = '********';
import { ProxySettingsSectionV2 } from '../components/settings/ProxySettingsSectionV2';
import { ProxyLibrarySection } from '../components/settings/ProxyLibrarySection';
import { AiProxySettings } from '../components/settings/AiProxySettings';
import { AutomationTab } from '../components/registration/AutomationTab';
import { LoadingSpinner, TabButton } from '@/components/ui';

type SettingsCategory =
  | 'general'
  | 'connectivity'
  | 'automation'
  | 'google-sheets'
  | 'ai-proxy'
  | 'extension';

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
  {
    id: 'automation',
    labelKey: 'settings.categories.automation',
    icon: <Repeat className="w-4 h-4" />,
  },
  {
    id: 'google-sheets',
    labelKey: 'settings.categories.googleSheets',
    icon: <Table2 className="w-4 h-4" />,
  },
  {
    id: 'ai-proxy',
    labelKey: 'settings.categories.aiProxy',
    icon: <Zap className="w-4 h-4" />,
  },
  {
    id: 'extension',
    labelKey: 'settings.categories.extension',
    icon: <Puzzle className="w-4 h-4" />,
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

  const [activeCategory, setActiveCategory] = useUIState<SettingsCategory>(
    'settings-active-category',
    'general',
    'persist'
  );
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
  const [addyioApiTokenDraft, setAddyioApiTokenDraft] = useState('');
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

  // Mail.tm settings
  const [mailtmEnabled, setMailtmEnabled] = useState(false);

  // Addy.io dynamic data
  const [addyioDomains, setAddyioDomains] = useState<string[]>([]);
  const [addyioRecipients, setAddyioRecipients] = useState<
    Array<{ id: string; email: string; emailVerifiedAt: string | null }>
  >([]);
  const [addyioAccountInfo, setAddyioAccountInfo] = useState<any>(null);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');

  const [customIdePaths, setCustomIdePaths] = useState<Record<string, string>>({});
  const [googleSheetsSpreadsheetId, setGoogleSheetsSpreadsheetId] = useState('');
  const [googleSheetsServiceAccountJson, setGoogleSheetsServiceAccountJson] = useState('');
  const [hasStoredGoogleSheetsServiceAccountJson, setHasStoredGoogleSheetsServiceAccountJson] =
    useState(false);

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
      setAddyioApiTokenDraft(data.addyioApiToken || '');
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

      // Load Mail.tm settings
      setMailtmEnabled(data.mailtmEnabled || false);

      setCustomIdePaths(data.customIdePaths || {});
      setGoogleSheetsSpreadsheetId((data as any).googleSheetsSpreadsheetId || '');
      setGoogleSheetsServiceAccountJson(
        (data as any).googleSheetsServiceAccountJson === '********'
          ? ''
          : (data as any).googleSheetsServiceAccountJson || ''
      );
      setHasStoredGoogleSheetsServiceAccountJson(
        Boolean(
          (data as any).googleSheetsServiceAccountJson &&
          (data as any).googleSheetsServiceAccountJson === SETTINGS_SECRET_MASK
        )
      );

      if (data.theme && ['light', 'dark', 'system'].includes(data.theme)) {
        setTheme(data.theme as 'light' | 'dark' | 'system');
      }

      // Load email counter for current provider and strategy
      // Strategy is determined by mail strategy: 'gmail' uses 'gmail', 'custom' uses 'custom'
      try {
        setIsLoadingCounter(true);
        const mailStrategy = data.mailStrategy || 'custom';
        const counterStrategy = mailStrategy === 'gmail' ? 'gmail' : 'custom';

        const counter = await getEmailCounter({
          provider: data.provider || 'kiro',
          strategy: counterStrategy,
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
    const tokenToTest = addyioApiTokenDraft || addyioApiToken;
    if (!tokenToTest) {
      setConnectionStatus('error');
      setConnectionMessage('Please enter an API token');
      return;
    }

    setIsTestingConnection(true);
    setConnectionStatus('idle');
    setConnectionMessage('');

    try {
      const tokenDetails = await testAddyioConnection(tokenToTest);
      const [account, domains, recipients] = await Promise.all([
        getAddyioAccount(tokenToTest),
        getAddyioDomains(tokenToTest),
        getAddyioRecipients(tokenToTest),
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
  }, [addyioApiTokenDraft, addyioApiToken, addyioDomain, addyioDefaultRecipientId, addLog]);

  const handleSaveAddyioApiToken = useCallback(async () => {
    try {
      setIsSaving(true);
      setSaveStatus('idle');
      setErrorMessage('');

      await updateSettings({ addyioApiToken: addyioApiTokenDraft } as any);
      setAddyioApiToken(addyioApiTokenDraft);
      setSaveStatus('success');
    } catch (error) {
      console.error('[Settings] Save Addy.io token failed:', error);
      setSaveStatus('error');
      setErrorMessage(error instanceof Error ? error.message : t('settings.failedToSave'));
      addLog({
        level: 'error',
        message: `Failed to save Addy.io token: ${error instanceof Error ? error.message : 'Unknown error'}`,
        source: 'settings',
      });
    } finally {
      setIsSaving(false);
    }
  }, [addyioApiTokenDraft, addLog]);

  const handleSave = useCallback(async () => {
    try {
      setIsSaving(true);
      setSaveStatus('idle');
      setErrorMessage('');

      const normalizedGoogleSheetsSpreadsheetId = normalizeSpreadsheetId(googleSheetsSpreadsheetId);

      const settingsToSave = {
        theme,
        imapServer: imapServer,
        imapPort: parseInt(imapPort, 10) || 993,
        imapEmail: imapEmail,
        imapUser: imapEmail,
        imapPassword: imapPassword !== '********' ? imapPassword : '',
        addyioEnabled: addyioEnabled,
        // Do NOT auto-save Addy.io token while typing. Use explicit save.
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
        mailtmEnabled: mailtmEnabled,
        customIdePaths: customIdePaths,
        googleSheetsSpreadsheetId: normalizedGoogleSheetsSpreadsheetId,
        // Removed automation settings (managed in PatcherSettingsDrawer)
      };

      if (googleSheetsServiceAccountJson.trim()) {
        (settingsToSave as any).googleSheetsServiceAccountJson = googleSheetsServiceAccountJson;
      }

      await updateSettings(settingsToSave);
      if (normalizedGoogleSheetsSpreadsheetId !== googleSheetsSpreadsheetId) {
        setGoogleSheetsSpreadsheetId(normalizedGoogleSheetsSpreadsheetId);
      }

      setSaveStatus('success');

      if (googleSheetsServiceAccountJson.trim()) {
        setGoogleSheetsServiceAccountJson('');
        setHasStoredGoogleSheetsServiceAccountJson(true);
      }
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
    mailtmEnabled,
    customIdePaths,
    googleSheetsSpreadsheetId,
    googleSheetsServiceAccountJson,
    addLog,
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
        const mailStrategy = settings.mailStrategy || 'custom';
        const counterStrategy = mailStrategy === 'gmail' ? 'gmail' : 'custom';

        await setEmailCounter({
          provider: settings.provider || 'kiro',
          strategy: counterStrategy,
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
          <LoadingSpinner size="md" />
          <span className="ml-2 text-slate-500 text-sm">{t('settings.loadingSettings')}</span>
        </div>
      </div>
    );
  }

  const renderGeneralSettings = () => (
    <div className="space-y-8" style={getAnimationStyle(0)}>
      <ThemeLanguageSection
        theme={theme}
        onThemeChange={handleThemeChange}
        language={language}
        onLanguageChange={setLanguage}
      />

      <UIScaleSection uiScale={uiScale} onUIScaleChange={setUIScale} />

      <IDEPathsSection
        customIdePaths={customIdePaths}
        onCustomIdePathsChange={paths => {
          setCustomIdePaths(paths);
          debouncedAutoSave();
        }}
      />

      <DatabaseSection dbPath={dbPath} onCopy={copy} />
    </div>
  );

  const renderConnectivitySettings = () => (
    <div className="space-y-8" style={getAnimationStyle(0)}>
      <ProxyLibrarySection />

      <ProxySettingsSectionV2 />

      <IMAPSettingsSection
        imapServer={imapServer}
        onImapServerChange={server => {
          setImapServer(server);
          debouncedAutoSave();
        }}
        imapPort={imapPort}
        onImapPortChange={port => {
          setImapPort(port);
          debouncedAutoSave();
        }}
        imapEmail={imapEmail}
        onImapEmailChange={email => {
          setImapEmail(email);
          debouncedAutoSave();
        }}
        imapPassword={imapPassword}
        onImapPasswordChange={password => {
          setImapPassword(password);
          debouncedAutoSave();
        }}
        showPassword={showPassword}
        onShowPasswordToggle={() => setShowPassword(!showPassword)}
        validationErrors={validationErrors}
        onValidate={validateField}
      />

      <EmailCounterSection
        emailCounter={emailCounter}
        onEmailCounterChange={handleEmailCounterChange}
        isLoading={isLoadingCounter}
      />

      <EmailServicesSection
        addyioEnabled={addyioEnabled}
        onAddyioEnabledChange={enabled => {
          setAddyioEnabled(enabled);
          if (enabled) setThirtyThreeMailEnabled(false);
          debouncedAutoSave();
        }}
        addyioApiToken={addyioApiTokenDraft}
        onAddyioApiTokenChange={token => {
          setAddyioApiTokenDraft(token);
          setConnectionStatus('idle');
        }}
        onSaveAddyioApiToken={handleSaveAddyioApiToken}
        isAddyioApiTokenDirty={addyioApiTokenDraft !== addyioApiToken}
        isSavingAddyioApiToken={isSaving}
        addyioAliasFormat={addyioAliasFormat}
        onAddyioAliasFormatChange={format => {
          setAddyioAliasFormat(format);
          debouncedAutoSave();
        }}
        addyioDomain={addyioDomain}
        onAddyioDomainChange={domain => {
          setAddyioDomain(domain);
          debouncedAutoSave();
        }}
        addyioAutoDelete={addyioAutoDelete}
        onAddyioAutoDeleteChange={enabled => {
          setAddyioAutoDelete(enabled);
          debouncedAutoSave();
        }}
        addyioDefaultRecipientId={addyioDefaultRecipientId}
        onAddyioDefaultRecipientIdChange={id => {
          setAddyioDefaultRecipientId(id);
          debouncedAutoSave();
        }}
        addyioDescriptionTemplate={addyioDescriptionTemplate}
        onAddyioDescriptionTemplateChange={template => {
          setAddyioDescriptionTemplate(template);
          debouncedAutoSave();
        }}
        addyioFromName={addyioFromName}
        onAddyioFromNameChange={name => {
          setAddyioFromName(name);
          debouncedAutoSave();
        }}
        addyioDomains={addyioDomains}
        addyioRecipients={addyioRecipients}
        addyioAccountInfo={addyioAccountInfo}
        isTestingConnection={isTestingConnection}
        connectionStatus={connectionStatus}
        connectionMessage={connectionMessage}
        onTestConnection={handleTestAddyioConnection}
        showPassword={showPassword}
        onShowPasswordToggle={() => setShowPassword(!showPassword)}
        thirtyThreeMailEnabled={thirtyThreeMailEnabled}
        onThirtyThreeMailEnabledChange={enabled => {
          setThirtyThreeMailEnabled(enabled);
          if (enabled) setAddyioEnabled(false);
          debouncedAutoSave();
        }}
        thirtyThreeMailUsername={thirtyThreeMailUsername}
        onThirtyThreeMailUsernameChange={username => {
          setThirtyThreeMailUsername(username);
          debouncedAutoSave();
        }}
        thirtyThreeMailDomain={thirtyThreeMailDomain}
        onThirtyThreeMailDomainChange={domain => {
          setThirtyThreeMailDomain(domain);
          debouncedAutoSave();
        }}
        mailtmEnabled={mailtmEnabled}
        onMailtmEnabledChange={enabled => {
          setMailtmEnabled(enabled);
          if (enabled) {
            setAddyioEnabled(false);
            setThirtyThreeMailEnabled(false);
          }
          debouncedAutoSave();
        }}
      />
    </div>
  );

  const renderContent = () => {
    switch (activeCategory) {
      case 'general':
        return renderGeneralSettings();
      case 'connectivity':
        return renderConnectivitySettings();
      case 'automation':
        return <AutomationTab />;
      case 'google-sheets':
        return (
          <div style={getAnimationStyle(0)}>
            <GoogleSheetsSettingsSection
              spreadsheetId={googleSheetsSpreadsheetId}
              serviceAccountJson={googleSheetsServiceAccountJson}
              hasStoredServiceAccountJson={hasStoredGoogleSheetsServiceAccountJson}
              onSpreadsheetIdChange={value => setGoogleSheetsSpreadsheetId(value)}
              onServiceAccountJsonChange={value => setGoogleSheetsServiceAccountJson(value)}
              onSave={handleSave}
            />
          </div>
        );
      case 'ai-proxy':
        return (
          <div style={getAnimationStyle(0)}>
            <AiProxySettings />
          </div>
        );
      case 'extension':
        return (
          <div style={getAnimationStyle(0)}>
            <ExtensionSettingsSection />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-ds-surface-base">
      <Header title={t('settings.title')} icon={<SettingsIcon size={18} />} />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 border-r border-white/5 bg-ds-surface-elevated/50 flex flex-col p-4 gap-1 overflow-y-auto">
          {categories.map(cat => (
            <TabButton
              key={cat.id}
              active={activeCategory === cat.id}
              onClick={() => handleCategoryChange(cat.id)}
              icon={cat.icon}
              label={t(cat.labelKey)}
              className="justify-start px-4 py-3"
            />
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
      <div className="px-6 py-3 border-t border-white/5 bg-ds-surface-elevated flex justify-end items-center gap-4">
        {isSaving && (
          <span className="text-xs text-slate-400 flex items-center gap-1.5 animate-pulse">
            <LoadingSpinner size="xs" color="muted" />
            {t('common.saving')}
          </span>
        )}
        {saveStatus === 'success' && !isSaving && (
          <span className="text-xs text-emerald-400 flex items-center gap-1.5 animate-in fade-in slide-in-from-bottom-2">
            <CheckCircle className="w-3.5 h-3.5" />
            {t('settings.settingsSaved')}
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
