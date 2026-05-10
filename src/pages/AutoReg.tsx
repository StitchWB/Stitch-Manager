import { useEffect, useState, useMemo } from 'react';
import { useLocation } from 'react-router-dom';

import { type ConfigTab } from '../components/registration';
import { type ProviderName } from '../types/ui';
import { type LogVerbosity } from '../constants/logging';
import { t } from '../lib/i18n';

import { useRegistrationStore } from '../stores/registration';
import { useUIPreferencesStore } from '../stores/uiPreferences';
import { checkPythonAutoreg } from '../lib/tauri';

import { useRegistrationFlow } from './AutoReg/hooks/useRegistrationFlow';
import { useEventListeners } from './AutoReg/hooks/useEventListeners';
import { useAddyioConnection } from './AutoReg/hooks/useAddyioConnection';
import { CommandCenter, ConsolePanel } from './AutoReg/components';
import { getActivePythonJobId } from './AutoReg/services';
import type { PipelineStepOverride } from '../components/registration/PipelineStepConfigPanel';
import { useAccountsStore } from '../stores/accounts';
import { useUIState } from '../hooks/useUIState';
import {
  Button,
  GlassCard,
  Select,
  type IdentityConfig,
  type NetworkConfig,
} from '@/components/ui';

export function computeEmailDomain(imap: {
  strategy: string;
  emailGenerationDomain?: string;
  email?: string;
}): string {
  if (imap.strategy === 'gmail') return 'gmail.com';
  if (imap.strategy === 'cf-to-imap' && imap.emailGenerationDomain) return imap.emailGenerationDomain;
  return imap.email?.split('@')[1] || 'example.com';
}

export default function AutoRegNext() {
  const location = useLocation();
  const autoRegSupportedProviders = useMemo<ProviderName[]>(
    () => ['kiro', 'aws', 'windsurf', 'trae', 'github', 'openai', 'fireworks', 'bitbucket'],
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
    addLog,
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
  const [pipelineJobId, setPipelineJobId] = useState<string | null>(null);
  const [showDebugLogs, setShowDebugLogs] = useUIState('autoreg-show-debug-logs', false, 'session');
  const [launchContext, setLaunchContext] = useUIState(
    'autoreg-launch-context',
    null as {
      source?: 'profile';
      profileAlias?: string;
      targetProvider?: string;
      awsBootstrapAccountId?: number;
      launchMode?: string;
    } | null,
    'session'
  );
  const [kiroBootstrapMode, setKiroBootstrapMode] = useUIState(
    'autoreg-kiro-bootstrap-mode',
    'existing_aws_session' as 'new_aws' | 'existing_aws_session',
    'session'
  );
  const [selectedAwsBootstrapAccountId, setSelectedAwsBootstrapAccountId] = useUIState(
    'autoreg-aws-bootstrap-account-id',
    null as number | null,
    'session'
  );

  // Pipeline step overrides per provider (persisted per session)
  // All pauseAfter=false by default — user opts in to pauses explicitly
  const [pipelineStepOverrides, setPipelineStepOverrides] = useState<Record<string, PipelineStepOverride[]>>({
    fireworks: [
      { id: 'signup', label: 'Sign Up', enabled: true, pauseAfter: false, skippable: false },
      { id: 'confirm_email', label: 'Confirm Email', enabled: true, pauseAfter: false, skippable: false },
      { id: 'onboarding', label: 'Onboarding', enabled: true, pauseAfter: false, skippable: true },
      { id: 'api_key', label: 'Create API Key', enabled: true, pauseAfter: false, skippable: true },
      { id: 'billing', label: 'Add Billing', enabled: true, pauseAfter: false, skippable: true },
    ],
  });

  const currentPipelineSteps = useMemo(
    () => pipelineStepOverrides[config.provider] || [],
    [pipelineStepOverrides, config.provider]
  );

  const { accounts: allAccounts, fetchAccounts: fetchAccountsForPicker } = useAccountsStore();

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
  const emailDomain = useMemo(
    () => computeEmailDomain(config.imap),
    [config.imap.strategy, config.imap.emailGenerationDomain, config.imap.email]
  );

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
    // CF-to-IMAP strategy
    if (config.imap.strategy === 'cf-to-imap') {
      return !!(config.imap.emailGenerationDomain && config.imap.server && config.imap.email && (config.imap.password || imapPasswordSet));
    }
    // Custom domain strategy
    return !!(config.imap.server && config.imap.email && (config.imap.password || imapPasswordSet));
  }, [config.imap, imapPasswordSet, gmailAppPasswordSet]);

  // AWS doesn't require IMAP configuration (can work without email verification in some cases)
  const canStart = config.provider === 'aws' ? true : isMailReady;

  const isProfileLaunchForKiro =
    launchContext?.source === 'profile' &&
    (launchContext.targetProvider || config.provider) === 'kiro';

  const effectiveCanStart = useMemo(() => {
    if (!isProfileLaunchForKiro) return canStart;
    if (kiroBootstrapMode === 'existing_aws_session') {
      return selectedAwsBootstrapAccountId !== null;
    }
    return canStart;
  }, [isProfileLaunchForKiro, kiroBootstrapMode, selectedAwsBootstrapAccountId, canStart]);

  const awsBootstrapCandidates = useMemo(
    () => allAccounts.filter(a => a.provider === 'aws_builder_id' || a.provider === 'aws'),
    [allAccounts]
  );

  const selectedAwsBootstrapAccount = useMemo(
    () =>
      selectedAwsBootstrapAccountId != null
        ? awsBootstrapCandidates.find(a => a.id === selectedAwsBootstrapAccountId) || null
        : null,
    [selectedAwsBootstrapAccountId, awsBootstrapCandidates]
  );

  const hasSelectedAwsSessionPath = useMemo(
    () => !!selectedAwsBootstrapAccount?.browserProfilePath,
    [selectedAwsBootstrapAccount]
  );

  // Use custom hooks
  const { activeThreads, isStopping, handleStart, handleTestImap, handleStop } =
    useRegistrationFlow({
      config: { ...config, logVerbosity },
      emailDomain,
      useRegistrationV2,
      canStart,
      launchContext: launchContext || undefined,
      pipelineStepOverrides: currentPipelineSteps,
      onThreadsChange: handleSetActiveThreads,
    });

  useEventListeners({ onThreadsChange: handleSetActiveThreads, launchContext });

  const isRunning = activeThreads > 0 || isStopping;

  useEffect(() => {
    if (!isRunning) {
      setPipelineJobId(null);
      return;
    }
    const interval = setInterval(() => {
      setPipelineJobId(getActivePythonJobId());
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

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

  useEffect(() => {
    if (
      launchContext?.source === 'profile' &&
      (config.provider === 'kiro' || launchContext.targetProvider === 'kiro')
    ) {
      void fetchAccountsForPicker();
    }
  }, [
    launchContext?.source,
    launchContext?.targetProvider,
    config.provider,
    fetchAccountsForPicker,
  ]);

  useEffect(() => {
    if (!launchContext?.profileAlias || selectedAwsBootstrapAccountId !== null) return;
    const profileAlias = launchContext.profileAlias.toLowerCase();
    const candidate = awsBootstrapCandidates.find(
      acc =>
        (acc.provider === 'aws_builder_id' || acc.provider === 'aws') &&
        acc.email.toLowerCase() === profileAlias
    );
    if (candidate) {
      setSelectedAwsBootstrapAccountId(candidate.id);
      setLaunchContext(prev => (prev ? { ...prev, awsBootstrapAccountId: candidate.id } : prev));
    }
  }, [launchContext?.profileAlias, selectedAwsBootstrapAccountId, awsBootstrapCandidates]);

  // Launch context: start from profile
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const source = params.get('source');
    const profile = params.get('profile');
    const target = params.get('target');
    const preset = params.get('preset');
    const awsBootstrap = params.get('awsBootstrapAccountId');
    const parsedAwsBootstrap = awsBootstrap ? Number(awsBootstrap) : undefined;

    if (source === 'profile' && profile) {
      addLog({ level: 'info', message: `[Launch] AutoReg started from profile: ${profile}` });
      setLaunchContext({
        source: 'profile',
        profileAlias: profile,
        targetProvider: target || 'kiro',
        awsBootstrapAccountId: Number.isFinite(parsedAwsBootstrap as number)
          ? parsedAwsBootstrap
          : undefined,
        launchMode:
          preset === 'kiro_via_aws_session' ? 'kiro_oauth_only_existing_session' : undefined,
      });
      if (Number.isFinite(parsedAwsBootstrap as number)) {
        setSelectedAwsBootstrapAccountId(parsedAwsBootstrap as number);
      }
      setKiroBootstrapMode(
        preset === 'kiro_via_aws_session' || Number.isFinite(parsedAwsBootstrap as number)
          ? 'existing_aws_session'
          : 'new_aws'
      );

      if ((target || 'kiro') !== config.provider) {
        stableSetProvider((target || 'kiro') as ProviderName);
      }
    }
  }, [location.search, config.provider, stableSetProvider]);

  // Identity config adapter for IdentitySystemCard
  const identityConfig: IdentityConfig = {
    strategy: config.imap.strategy,
    // Use imap.emailCustomPrefix first (loaded from DB), patterns as fallback
    emailPattern: config.imap.emailCustomPrefix || config.patterns.emailCustomPrefix || '',
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
    emailGenerationDomain: config.imap.emailGenerationDomain,
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
    <div className="h-full flex flex-col md:flex-row bg-[var(--ds-bg)]">
      {launchContext?.source === 'profile' && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 w-[min(960px,calc(100%-24px))]">
          <GlassCard className="p-3 border-cyan-500/20 bg-cyan-500/5">
            <div className="flex flex-wrap items-end gap-3 justify-between">
              <div className="min-w-[240px]">
                <div className="text-xs uppercase tracking-widest text-cyan-300/80">
                  Контекст запуска
                </div>
                <div className="text-sm text-white font-semibold mt-1 truncate">
                  Профиль: {launchContext.profileAlias}
                </div>
                <div className="text-xs text-slate-300 mt-1">
                  Цель: {launchContext.targetProvider || config.provider}
                </div>
              </div>

              {config.provider === 'kiro' && (
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">
                      AWS Bootstrap
                    </div>
                    <Select
                      value={kiroBootstrapMode}
                      onChange={e => {
                        const mode = e.target.value as 'new_aws' | 'existing_aws_session';
                        setKiroBootstrapMode(mode);
                        setLaunchContext(prev =>
                          prev
                            ? {
                                ...prev,
                                launchMode:
                                  mode === 'existing_aws_session'
                                    ? 'kiro_oauth_only_existing_session'
                                    : 'kiro_full_register',
                              }
                            : prev
                        );
                      }}
                      className="h-9 py-1 text-xs min-w-[220px]"
                    >
                      <option value="existing_aws_session">Use existing AWS session</option>
                      <option value="new_aws">Create new AWS account (legacy flow)</option>
                    </Select>
                  </div>

                  {kiroBootstrapMode === 'existing_aws_session' && (
                    <div>
                        <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">
                        AWS Account
                      </div>
                      <Select
                        value={selectedAwsBootstrapAccountId?.toString() ?? ''}
                        onChange={e => {
                          const val = e.target.value ? Number(e.target.value) : null;
                          setSelectedAwsBootstrapAccountId(val);
                          setLaunchContext(prev =>
                            prev
                              ? {
                                  ...prev,
                                  awsBootstrapAccountId: val ?? undefined,
                                }
                              : prev
                          );
                        }}
                        className="h-9 py-1 text-xs min-w-[260px]"
                      >
                        <option value="">Select AWS account</option>
                        {awsBootstrapCandidates.map(acc => (
                          <option key={acc.id} value={acc.id}>
                            #{acc.id} · {acc.email}
                          </option>
                        ))}
                      </Select>
                      {selectedAwsBootstrapAccountId === null && (
                        <div className="text-xs text-amber-300/90 mt-1">
                          {t('accounts.launchContextHintSelectAws')}
                        </div>
                      )}
                      {selectedAwsBootstrapAccountId !== null && !hasSelectedAwsSessionPath && (
                        <div className="text-[10px] text-amber-300/90 mt-1">
                          {t('accounts.launchContextHintNoAwsSessionPath')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <Button size="xs" variant="ghost" onClick={() => setLaunchContext(null)}>
                Очистить контекст
              </Button>
            </div>
          </GlassCard>
        </div>
      )}

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
        cardsText={config.advanced.cardsText || ''}
        onCardsTextChange={cardsText => stableSetAdvancedSettings({ cardsText })}
        networkConfig={networkConfig}
        onNetworkConfigChange={stableSetProxyConfig}
        pipelineSteps={currentPipelineSteps}
        onPipelineStepsChange={steps =>
          setPipelineStepOverrides(prev => ({ ...prev, [config.provider]: steps }))
        }
        count={config.count}
        onCountChange={stableSetCount}
        isRunning={activeThreads > 0 || isStopping}
        canStart={effectiveCanStart && !isStopping}
        pythonAvailable={pythonAvailable}
        onStart={handleStart}
        onStop={handleStop}
        jobId={pipelineJobId}
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
        pipelineJobId={pipelineJobId}
      />
    </div>
  );
}
