import {
  ProviderSelector,
  ConfigTabs,
  type ConfigTab,
  IdentityTab,
  EngineTab,
  NetworkTab,
  AutomationTab,
  InboxTab,
  LaunchPad,
} from '../../../components/registration';
import { type ProviderName } from '../../../types/ui';
import { type LogVerbosity } from '../../../constants/logging';
import { type SaveStatus } from '../../../stores/registration/types';
import type { IMAPConfig } from '../../../stores/registration/types';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { type IdentityConfig, type NetworkConfig } from '@/components/ui';

interface CommandCenterProps {
  // Provider
  activeProvider: ProviderName;
  onProviderChange: (provider: ProviderName) => void;
  allowedProviders?: ProviderName[];

  // Tabs
  activeTab: ConfigTab;
  onTabChange: (tab: ConfigTab) => void;

  // Identity
  identityConfig: IdentityConfig;
  onIdentityConfigChange: (updates: any) => void;
  onTestImap: () => Promise<boolean>;
  passwordSet: boolean;
  gmailAppPasswordSet: boolean;
  onTestAddyio: () => Promise<void>;
  isTestingAddyio: boolean;
  addyioConnectionStatus: 'idle' | 'success' | 'error';
  addyioConnectionMessage: string;
  addyioAccountInfo: any;
  addyioDomains: string[];
  imapConfig: IMAPConfig;
  onLog: (level: 'info' | 'warn' | 'error' | 'success' | 'debug', message: string) => void;

  // Engine
  useRegistrationV2: boolean;
  onUseRegistrationV2Change: (enabled: boolean) => void;
  headless: boolean;
  onHeadlessChange: (headless: boolean) => void;
  speedMultiplier: number;
  onSpeedMultiplierChange: (multiplier: number) => void;
  delayBetweenAccounts: number;
  onDelayBetweenAccountsChange: (delay: number) => void;
  logVerbosity: LogVerbosity;
  onLogVerbosityChange: (verbosity: LogVerbosity) => void;
  showDebugLogsInConsole: boolean;
  onShowDebugLogsInConsoleChange: (enabled: boolean) => void;
  verificationCodeTimeout: number;
  onVerificationCodeTimeoutChange: (timeout: number) => void;
  oauthCallbackTimeout: number;
  onOauthCallbackTimeoutChange: (timeout: number) => void;
  allowAccessWait: number;
  onAllowAccessWaitChange: (wait: number) => void;
  pageLoadTimeout: number;
  onPageLoadTimeoutChange: (timeout: number) => void;
  elementWaitTimeout: number;
  onElementWaitTimeoutChange: (timeout: number) => void;
  imapPollInterval: number;
  onImapPollIntervalChange: (interval: number) => void;
  passwordLength: number;
  onPasswordLengthChange: (length: number) => void;
  realisticTyping: boolean;
  onRealisticTypingChange: (enabled: boolean) => void;
  humanDelays: boolean;
  onHumanDelaysChange: (enabled: boolean) => void;
  screenshotsOnError: boolean;
  onScreenshotsOnErrorChange: (enabled: boolean) => void;
  cardsText?: string;
  onCardsTextChange?: (text: string) => void;

  // Network
  networkConfig: NetworkConfig;
  onNetworkConfigChange: (updates: any) => void;

  // Launch Pad
  count: number;
  onCountChange: (count: number) => void;
  isRunning: boolean;
  canStart: boolean;
  pythonAvailable: boolean | null;
  onStart: () => void;
  onStop: () => void;

  // State
  saveStatus: SaveStatus;
  disabled: boolean;
}

export const CommandCenter = ({
  activeProvider,
  onProviderChange,
  allowedProviders,
  activeTab,
  onTabChange,
  identityConfig,
  onIdentityConfigChange,
  onTestImap,
  passwordSet,
  gmailAppPasswordSet,
  onTestAddyio,
  isTestingAddyio,
  addyioConnectionStatus,
  addyioConnectionMessage,
  addyioAccountInfo,
  addyioDomains,
  imapConfig,
  onLog,
  useRegistrationV2,
  onUseRegistrationV2Change,
  headless,
  onHeadlessChange,
  speedMultiplier,
  onSpeedMultiplierChange,
  delayBetweenAccounts,
  onDelayBetweenAccountsChange,
  logVerbosity,
  onLogVerbosityChange,
  showDebugLogsInConsole,
  onShowDebugLogsInConsoleChange,
  verificationCodeTimeout,
  onVerificationCodeTimeoutChange,
  oauthCallbackTimeout,
  onOauthCallbackTimeoutChange,
  allowAccessWait,
  onAllowAccessWaitChange,
  pageLoadTimeout,
  onPageLoadTimeoutChange,
  elementWaitTimeout,
  onElementWaitTimeoutChange,
  imapPollInterval,
  onImapPollIntervalChange,
  passwordLength,
  onPasswordLengthChange,
  realisticTyping,
  onRealisticTypingChange,
  humanDelays,
  onHumanDelaysChange,
  screenshotsOnError,
  onScreenshotsOnErrorChange,
  cardsText,
  onCardsTextChange,
  networkConfig,
  onNetworkConfigChange,
  count,
  onCountChange,
  isRunning,
  canStart,
  pythonAvailable,
  onStart,
  onStop,
  saveStatus,
  disabled,
}: CommandCenterProps) => {
  const savePill =
    saveStatus === 'saving' ? (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-300 bg-white/5 border border-white/10 px-2 py-1 rounded-md">
        <Loader2 className="w-3 h-3 animate-spin" /> Saving
      </span>
    ) : saveStatus === 'saved' ? (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-md">
        <CheckCircle2 className="w-3 h-3" /> Saved
      </span>
    ) : saveStatus === 'error' ? (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-1 rounded-md">
        <XCircle className="w-3 h-3" /> Save failed
      </span>
    ) : null;

  return (
    <div className="w-full md:w-[360px] lg:w-[400px] shrink-0 flex flex-col h-full border-b md:border-b-0 md:border-r border-white/5">
      {/* Provider Selector */}
      <ProviderSelector
        activeProvider={activeProvider}
        onProviderChange={onProviderChange}
        allowedProviders={allowedProviders}
        disabled={disabled}
      />

      {/* Global save status */}
      {savePill && <div className={cn('px-4 pb-2 -mt-1 flex justify-end')}>{savePill}</div>}

      {/* Tab Bar */}
      <ConfigTabs activeTab={activeTab} onTabChange={onTabChange} disabled={disabled} />

      {/* Tabbed Content */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        {activeTab === 'identity' && (
          <IdentityTab
            provider={activeProvider}
            identityConfig={identityConfig}
            onConfigChange={updates => {
              if ('emailPattern' in updates) {
                onIdentityConfigChange({ ...updates });
              } else {
                onIdentityConfigChange(updates);
              }
            }}
            onTest={onTestImap}
            disabled={disabled}
            saveStatus={saveStatus}
            passwordSet={passwordSet}
            gmailAppPasswordSet={gmailAppPasswordSet}
            onTestAddyio={onTestAddyio}
            isTestingAddyio={isTestingAddyio}
            addyioConnectionStatus={addyioConnectionStatus}
            addyioConnectionMessage={addyioConnectionMessage}
            addyioAccountInfo={addyioAccountInfo}
            addyioDomains={addyioDomains}
          />
        )}

        {activeTab === 'engine' && (
          <EngineTab
            provider={activeProvider}
            useRegistrationV2={useRegistrationV2}
            onUseRegistrationV2Change={onUseRegistrationV2Change}
            headless={headless}
            onHeadlessChange={onHeadlessChange}
            speedMultiplier={speedMultiplier}
            onSpeedMultiplierChange={onSpeedMultiplierChange}
            delayBetweenAccounts={delayBetweenAccounts}
            onDelayBetweenAccountsChange={onDelayBetweenAccountsChange}
            logVerbosity={logVerbosity}
            onLogVerbosityChange={onLogVerbosityChange}
            showDebugLogsInConsole={showDebugLogsInConsole}
            onShowDebugLogsInConsoleChange={onShowDebugLogsInConsoleChange}
            verificationCodeTimeout={verificationCodeTimeout}
            onVerificationCodeTimeoutChange={onVerificationCodeTimeoutChange}
            oauthCallbackTimeout={oauthCallbackTimeout}
            onOauthCallbackTimeoutChange={onOauthCallbackTimeoutChange}
            allowAccessWait={allowAccessWait}
            onAllowAccessWaitChange={onAllowAccessWaitChange}
            pageLoadTimeout={pageLoadTimeout}
            onPageLoadTimeoutChange={onPageLoadTimeoutChange}
            elementWaitTimeout={elementWaitTimeout}
            onElementWaitTimeoutChange={onElementWaitTimeoutChange}
            imapPollInterval={imapPollInterval}
            onImapPollIntervalChange={onImapPollIntervalChange}
            passwordLength={passwordLength}
            onPasswordLengthChange={onPasswordLengthChange}
            realisticTyping={realisticTyping}
            onRealisticTypingChange={onRealisticTypingChange}
            humanDelays={humanDelays}
            onHumanDelaysChange={onHumanDelaysChange}
            screenshotsOnError={screenshotsOnError}
            onScreenshotsOnErrorChange={onScreenshotsOnErrorChange}
            cardsText={cardsText}
            onCardsTextChange={onCardsTextChange}
            disabled={disabled}
          />
        )}

        {activeTab === 'network' && (
          <NetworkTab config={networkConfig} onChange={onNetworkConfigChange} disabled={disabled} />
        )}

        {activeTab === 'automation' && <AutomationTab disabled={disabled} />}

        {activeTab === 'inbox' && <InboxTab imap={imapConfig} disabled={disabled} onLog={onLog} />}
      </div>

      {/* Launch Pad */}
      <LaunchPad
        count={count}
        onCountChange={onCountChange}
        isRunning={isRunning}
        canStart={canStart}
        pythonAvailable={pythonAvailable}
        onStart={onStart}
        onStop={onStop}
      />
    </div>
  );
};
