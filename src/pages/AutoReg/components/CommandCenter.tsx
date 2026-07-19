import { useState } from 'react';
import {
  ProviderSelector,
  ConfigTabs,
  type ConfigTab,
  IdentityTab,
  EngineTab,
  NetworkTab,
  SoundsTab,
  LaunchPad,
  PipelineStepConfigPanel,
  PipelineStepSummaryBar,
} from '../../../components/registration';
import type { PipelineStepOverride } from '../../../components/registration/PipelineStepConfigPanel';
import { type ProviderName } from '../../../types/ui';
import { type LogVerbosity } from '../../../constants/logging';
import { type SaveStatus } from '../../../stores/registration/types';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { t } from '@/lib/i18n';
import { type IdentityConfig, type NetworkConfig, StatusBadge } from '@/components/ui';
import type { AddyIoAccountDetails } from '../../../types/generated';

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
  onIdentityConfigChange: (updates: Partial<IdentityConfig>) => void;
  onTestImap: () => Promise<boolean>;
  passwordSet: boolean;
  gmailAppPasswordSet: boolean;
  onTestAddyio: () => Promise<void>;
  isTestingAddyio: boolean;
  addyioConnectionStatus: 'idle' | 'success' | 'error';
  addyioConnectionMessage: string;
  addyioAccountInfo: AddyIoAccountDetails | null;
  addyioDomains: string[];

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

  // Sounds
  captchaSoundEnabled: boolean;
  onCaptchaSoundEnabledChange: (enabled: boolean) => void;
  captchaSoundFile: string;
  onCaptchaSoundFileChange: (file: string) => void;
  captchaTimeout: number;
  onCaptchaTimeoutChange: (timeout: number) => void;

  // Cards
  cardBin?: string;
  onCardBinChange?: (text: string) => void;

  // Kiro plan
  kiroPlan?: string;
  onKiroPlanChange?: (plan: string) => void;

  // Network
  networkConfig: NetworkConfig;
  onNetworkConfigChange: (updates: Partial<NetworkConfig>) => void;

  // Pipeline step config
  pipelineSteps?: PipelineStepOverride[];
  onPipelineStepsChange?: (steps: PipelineStepOverride[]) => void;

  // Launch Pad
  count: number;
  onCountChange: (count: number) => void;
  isRunning: boolean;
  canStart: boolean;
  pythonAvailable: boolean | null;
  onStart: () => void;
  onStop: () => void;
  jobId?: string | null;

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
  cardBin,
  onCardBinChange,
  kiroPlan,
  onKiroPlanChange,
  captchaSoundEnabled,
  onCaptchaSoundEnabledChange,
  captchaSoundFile,
  onCaptchaSoundFileChange,
  captchaTimeout,
  onCaptchaTimeoutChange,
  networkConfig,
  onNetworkConfigChange,
  pipelineSteps,
  onPipelineStepsChange,
  count,
  onCountChange,
  isRunning,
  canStart,
  pythonAvailable,
  onStart,
  onStop,
  jobId,
  saveStatus,
  disabled,
}: CommandCenterProps) => {
  // When true, the scrollable content area shows the scenario step editor
  // instead of the active tab's content.
  const [showScenarioEditor, setShowScenarioEditor] = useState(false);

  const savePill =
    saveStatus === 'saving' ? (
      <StatusBadge status="idle" size="sm" className="rounded-md border border-white/10">
        <Loader2 className="w-3 h-3 animate-spin" /> {t('autoReg.saving')}
      </StatusBadge>
    ) : saveStatus === 'saved' ? (
      <StatusBadge status="success" size="sm" className="rounded-md border border-emerald-500/20">
        <CheckCircle2 className="w-3 h-3" /> {t('autoReg.saved')}
      </StatusBadge>
    ) : saveStatus === 'error' ? (
      <StatusBadge status="error" size="sm" className="rounded-md border border-red-500/20">
        <XCircle className="w-3 h-3" /> {t('autoReg.saveError')}
      </StatusBadge>
    ) : null;

  return (
    <div className="w-full min-w-[320px] max-w-[520px] md:w-[360px] lg:w-[400px] resize-x overflow-hidden shrink-0 flex flex-col h-full border-b md:border-b-0 md:border-r border-white/5">
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

      {/* Tabbed Content - with scroll */}
      <div className="flex-1 overflow-y-auto px-4 py-2 min-h-0">
        {/* Scenario editor overlays the regular tab content */}
        {showScenarioEditor && pipelineSteps && onPipelineStepsChange ? (
          <PipelineStepConfigPanel
            steps={pipelineSteps}
            onChange={onPipelineStepsChange}
            onBack={() => setShowScenarioEditor(false)}
            disabled={isRunning}
          />
        ) : (
          <>
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
                cardBin={cardBin}
                onCardBinChange={onCardBinChange}
                kiroPlan={kiroPlan}
                onKiroPlanChange={onKiroPlanChange}
                disabled={disabled}
              />
            )}

            {activeTab === 'network' && (
              <NetworkTab config={networkConfig} onChange={onNetworkConfigChange} disabled={disabled} />
            )}

            {activeTab === 'sounds' && (
              <SoundsTab
                captchaSoundEnabled={captchaSoundEnabled}
                onCaptchaSoundEnabledChange={onCaptchaSoundEnabledChange}
                captchaSoundFile={captchaSoundFile}
                onCaptchaSoundFileChange={onCaptchaSoundFileChange}
                captchaTimeout={captchaTimeout}
                onCaptchaTimeoutChange={onCaptchaTimeoutChange}
                disabled={disabled}
              />
            )}

            {/* Tab 'inbox' removed — inbox settings merged into identity tab */}
          </>
        )}
      </div>

      {/* Compact scenario summary bar — always visible when steps are present */}
      {pipelineSteps && onPipelineStepsChange && !showScenarioEditor && (
        <PipelineStepSummaryBar
          steps={pipelineSteps}
          onConfigure={() => setShowScenarioEditor(true)}
          disabled={isRunning}
        />
      )}

      {/* Launch Pad */}
      <LaunchPad
        count={count}
        onCountChange={onCountChange}
        isRunning={isRunning}
        canStart={canStart}
        pythonAvailable={pythonAvailable}
        onStart={onStart}
        onStop={onStop}
        jobId={jobId}
      />
    </div>
  );
};
