import { useEffect, useState, useMemo } from 'react';

import { type IdentityConfig } from '../components/ui/IdentitySystemCard';
import { type NetworkConfig } from '../components/ui/NetworkCard';
import { type ConfigTab } from '../components/registration';
import { type ProviderName } from '../types';
import { type LogVerbosity } from '../constants/logging';

import { useRegistrationStore } from '../stores/registration';
import { useUIPreferencesStore } from '../stores/uiPreferences';
import { checkPythonAutoreg } from '../lib/tauri';

import { useRegistrationFlow } from './AutoReg/hooks/useRegistrationFlow';
import { useEventListeners } from './AutoReg/hooks/useEventListeners';
import { useAddyioConnection } from './AutoReg/hooks/useAddyioConnection';
import { CommandCenter, ConsolePanel } from './AutoReg/components';

export default function AutoRegNext() {
  const autoRegSupportedProviders = useMemo<ProviderName[]>(
    () => ['kiro', 'aws', 'windsurf', 'trae', 'github', 'openai'],
    []
  );

  const {
    config,
    logs,
    successCount,
    failedCount,
    imapPasswordSet,
    gmailAppPasswordSet,
    saveStatus,
    activeProvider,
    logVerbosity,
    setIMAPConfig,
    clearLogs,
    setActiveProvider,
  } = useRegistrationStore();

  // Use stable store functions for callbacks that can be triggered after re-renders.
  // This prevents stale closures where a later re-render might reload old provider
  // and effectively "snap" the registration back to Kiro.
  // In practice the store facade can return new function references each render.
  // Resolve them from getState when wiring long-lived callbacks.
  const stableSetProvider = useMemo(() => useRegistrationStore.getState().setProvider, []);
  const stableSetIMAPConfig = useMemo(() => useRegistrationStore.getState().setIMAPConfig, []);
  const stableSetProxyConfig = useMemo(() => useRegistrationStore.getState().setProxyConfig, []);
  const stableSetAdvancedSettings = useMemo(
    () => useRegistrationStore.getState().setAdvancedSettings,
    []
  );
  const stableSetCount = useMemo(() => useRegistrationStore.getState().setCount, []);
  const stableSetLogVerbosity = useMemo(() => useRegistrationStore.getState().setLogVerbosity, []);

  // Normalize unsupported providers (e.g. old persisted value 'openai')
  // so AutoReg always points to an implemented backend flow.
  useEffect(() => {
    if (!autoRegSupportedProviders.includes(config.provider as ProviderName)) {
      stableSetProvider('kiro');
    }
  }, [config.provider, autoRegSupportedProviders, stableSetProvider]);

  // Use UI preferences for persistent state
  const { autoRegPage, setAutoRegTab, setAutoRegV2, setAutoRegRunning } = useUIPreferencesStore();

  const [pythonAvailable, setPythonAvailable] = useState<boolean | null>(null);
  const [showDebugLogs, setShowDebugLogs] = useState(false);

  // Use persisted preferences instead of local state
  const activeTab = autoRegPage.activeTab;
  const useRegistrationV2 = autoRegPage.useRegistrationV2;

  // Wrapper functions to update preferences
  const handleSetActiveTab = (tab: ConfigTab) => {
    setAutoRegTab(tab);
  };

  const handleSetUseRegistrationV2 = (enabled: boolean) => {
    setAutoRegV2(enabled);
  };

  // Sync activeThreads with isRunning preference
  const handleSetActiveThreads = (threads: number) => {
    setAutoRegRunning(threads > 0);
  };

  // Get email domain for pattern generation
  const emailDomain = useMemo(() => {
    if (config.imap.strategy === 'gmail') {
      return 'gmail.com';
    }
    return config.imap.email?.split('@')[1] || 'example.com';
  }, [config.imap.strategy, config.imap.email]);

  // Check if mail configuration is ready
  const isMailReady = useMemo(() => {
    // Gmail strategy
    if (config.imap.strategy === 'gmail') {
      return !!(config.imap.gmailBase && (config.imap.gmailAppPassword || gmailAppPasswordSet));
    }
    // Addy.io strategy
    if (config.imap.addyioEnabled) {
      return !!(config.imap.addyioApiToken && config.imap.server && config.imap.email);
    }
    // 33mail strategy
    if (config.imap.thirtyThreeMailEnabled) {
      return !!(config.imap.thirtyThreeMailUsername && config.imap.server && config.imap.email);
    }
    // Mail.tm strategy - always ready (no configuration needed)
    if (config.imap.mailtmEnabled) {
      return true;
    }
    // Custom domain strategy
    return !!(config.imap.server && config.imap.email && (config.imap.password || imapPasswordSet));
  }, [config.imap, imapPasswordSet, gmailAppPasswordSet]);

  // AWS doesn't require IMAP configuration (can work without email verification in some cases)
  const canStart = config.provider === 'aws' ? true : isMailReady;

  // Use custom hooks
  const { activeThreads, isStopping, handleStart, handleTestImap, handleStop } =
    useRegistrationFlow({
      config,
      emailDomain,
      useRegistrationV2,
      canStart,
      onThreadsChange: handleSetActiveThreads,
    });

  useEventListeners({ onThreadsChange: handleSetActiveThreads });

  const {
    addyioDomains,
    addyioAccountInfo,
    isTestingAddyio,
    addyioConnectionStatus,
    addyioConnectionMessage,
    handleTestAddyioConnection,
  } = useAddyioConnection({
    addyioApiToken: config.imap.addyioApiToken,
    addyioDomain: config.imap.addyioDomain,
    addyioDefaultRecipientId: config.imap.addyioDefaultRecipientId,
    onConfigUpdate: setIMAPConfig,
  });

  // Initialize on mount
  useEffect(() => {
    console.log('[AUTOREG] useEffect: initializing, calling loadSettings');
    // NOTE: useRegistrationStore returns new function references on each render.
    // This effect must run only once; otherwise, it can repeatedly reload DB settings
    // and overwrite user edits (e.g. count snapping back to previous value).
    useRegistrationStore.getState().loadSettings();
    checkPythonAutoreg()
      .then(setPythonAvailable)
      .catch(() => setPythonAvailable(false));

    // Save settings when user leaves the page or switches tabs
    const handleBeforeUnload = () => {
      console.log('[AUTOREG] beforeunload event fired');
      const settingsLoaded = useRegistrationStore.getState().settingsLoaded;
      console.log('[AUTOREG] beforeunload: settingsLoaded =', settingsLoaded);
      if (settingsLoaded) {
        console.log('[AUTOREG] beforeunload: calling saveImmediately');
        useRegistrationStore.getState().saveImmediately();
      }
    };

    const handleVisibilityChange = () => {
      console.log(
        '[AUTOREG] visibilitychange event fired, document.visibilityState =',
        document.visibilityState
      );
      if (document.visibilityState === 'hidden') {
        console.log('[AUTOREG] tab became hidden, attempting to save');
        const settingsLoaded = useRegistrationStore.getState().settingsLoaded;
        console.log('[AUTOREG] visibilitychange: settingsLoaded =', settingsLoaded);
        if (settingsLoaded) {
          console.log('[AUTOREG] visibilitychange: calling saveImmediately');
          useRegistrationStore.getState().saveImmediately();
        }
      }
    };

    console.log('[AUTOREG] adding event listeners for beforeunload and visibilitychange');
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      console.log('[AUTOREG] cleaning up event listeners');
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Identity config adapter for IdentitySystemCard
  const identityConfig: IdentityConfig = {
    strategy: config.imap.strategy,
    emailPattern: String(config.patterns.emailPattern),
    server: config.imap.server,
    port: config.imap.port,
    email: config.imap.email,
    password: config.imap.password,
    gmailBase: config.imap.gmailBase,
    gmailAlias: config.imap.gmailAlias,
    gmailAppPassword: config.imap.gmailAppPassword,
    addyioEnabled: config.imap.addyioEnabled,
    addyioApiToken: config.imap.addyioApiToken,
    addyioDomain: config.imap.addyioDomain,
    addyioAliasFormat: config.imap.addyioAliasFormat,
    addyioAutoDelete: config.imap.addyioAutoDelete,
    thirtyThreeMailEnabled: config.imap.thirtyThreeMailEnabled,
    thirtyThreeMailUsername: config.imap.thirtyThreeMailUsername,
    thirtyThreeMailDomain: config.imap.thirtyThreeMailDomain,
    mailtmEnabled: config.imap.mailtmEnabled,
  };

  // Network config adapter for NetworkCard
  const networkConfig: NetworkConfig = {
    enabled: config.proxy.enabled,
    url: config.proxy.url,
    username: config.proxy.username,
    password: config.proxy.password,
    type: config.proxy.type,
    list: config.proxy.list,
    rotationEnabled: config.proxy.rotationEnabled,
  };

  return (
    <div className="h-full flex flex-col md:flex-row" style={{ background: '#050508' }}>
      {/* Left Panel - Command Center */}
      <CommandCenter
        activeProvider={config.provider as ProviderName}
        onProviderChange={stableSetProvider}
        allowedProviders={autoRegSupportedProviders}
        activeTab={activeTab}
        onTabChange={handleSetActiveTab}
        identityConfig={identityConfig}
        onIdentityConfigChange={stableSetIMAPConfig}
        onTestImap={handleTestImap}
        passwordSet={imapPasswordSet}
        gmailAppPasswordSet={gmailAppPasswordSet}
        onTestAddyio={handleTestAddyioConnection}
        isTestingAddyio={isTestingAddyio}
        addyioConnectionStatus={addyioConnectionStatus}
        addyioConnectionMessage={addyioConnectionMessage}
        addyioAccountInfo={addyioAccountInfo}
        addyioDomains={addyioDomains}
        useRegistrationV2={useRegistrationV2}
        onUseRegistrationV2Change={handleSetUseRegistrationV2}
        headless={config.advanced.headless}
        onHeadlessChange={headless => stableSetAdvancedSettings({ headless })}
        speedMultiplier={config.advanced.speedMultiplier}
        onSpeedMultiplierChange={speedMultiplier => stableSetAdvancedSettings({ speedMultiplier })}
        delayBetweenAccounts={config.advanced.delayBetweenAccounts}
        onDelayBetweenAccountsChange={delayBetweenAccounts =>
          stableSetAdvancedSettings({ delayBetweenAccounts })
        }
        logVerbosity={logVerbosity as LogVerbosity}
        onLogVerbosityChange={stableSetLogVerbosity}
        showDebugLogsInConsole={showDebugLogs}
        onShowDebugLogsInConsoleChange={setShowDebugLogs}
        verificationCodeTimeout={config.advanced.verificationCodeTimeout}
        onVerificationCodeTimeoutChange={verificationCodeTimeout =>
          stableSetAdvancedSettings({ verificationCodeTimeout })
        }
        oauthCallbackTimeout={config.advanced.oauthCallbackTimeout}
        onOauthCallbackTimeoutChange={oauthCallbackTimeout =>
          stableSetAdvancedSettings({ oauthCallbackTimeout })
        }
        allowAccessWait={config.advanced.allowAccessWait}
        onAllowAccessWaitChange={allowAccessWait => stableSetAdvancedSettings({ allowAccessWait })}
        pageLoadTimeout={config.advanced.pageLoadTimeout}
        onPageLoadTimeoutChange={pageLoadTimeout => stableSetAdvancedSettings({ pageLoadTimeout })}
        elementWaitTimeout={config.advanced.elementWaitTimeout}
        onElementWaitTimeoutChange={elementWaitTimeout =>
          stableSetAdvancedSettings({ elementWaitTimeout })
        }
        imapPollInterval={config.advanced.imapPollInterval}
        onImapPollIntervalChange={imapPollInterval =>
          stableSetAdvancedSettings({ imapPollInterval })
        }
        passwordLength={config.advanced.passwordLength}
        onPasswordLengthChange={passwordLength => stableSetAdvancedSettings({ passwordLength })}
        realisticTyping={config.advanced.realisticTyping}
        onRealisticTypingChange={realisticTyping => stableSetAdvancedSettings({ realisticTyping })}
        humanDelays={config.advanced.humanDelays}
        onHumanDelaysChange={humanDelays => stableSetAdvancedSettings({ humanDelays })}
        screenshotsOnError={config.advanced.screenshotsOnError}
        onScreenshotsOnErrorChange={screenshotsOnError =>
          stableSetAdvancedSettings({ screenshotsOnError })
        }
        networkConfig={networkConfig}
        onNetworkConfigChange={stableSetProxyConfig}
        count={config.count}
        onCountChange={stableSetCount}
        isRunning={activeThreads > 0 || isStopping}
        canStart={canStart && !isStopping}
        pythonAvailable={pythonAvailable}
        onStart={handleStart}
        onStop={handleStop}
        saveStatus={saveStatus}
        disabled={activeThreads > 0}
      />

      {/* Right Panel - Console */}
      <ConsolePanel
        logs={logs}
        successCount={successCount}
        failedCount={failedCount}
        activeThreads={activeThreads}
        isRunning={activeThreads > 0}
        canStart={canStart}
        activeProvider={activeProvider || undefined}
        onStart={handleStart}
        onClear={clearLogs}
        onProviderChange={provider => setActiveProvider(provider || '')}
        showDebug={showDebugLogs}
        onShowDebugChange={setShowDebugLogs}
      />
    </div>
  );
}
