import { useState } from 'react';
import {
  ProviderSelector,
  ConfigTabs,
  type ConfigTab,
  IdentityTab,
  BrowserSection,
  LaunchSection,
  NetworkTab,
  SoundsTab,
  LaunchPad,
  PipelineStepConfigPanel,
  PipelineStepSummaryBar,
} from '../../../components/registration';
import type { PipelineStepOverride } from '../../../components/registration/PipelineStepConfigPanel';
import { type ProviderName } from '../../../types/ui';
import { type ProviderInfo } from '../../../lib/backend';
import { type LogVerbosity } from '../../../constants/logging';
import { type SaveStatus } from '../../../stores/registration/types';
import { CheckCircle2, ChevronDown, ChevronUp, Loader2, XCircle } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { t } from '@/lib/i18n';
import {
  type IdentityConfig,
  type NetworkConfig,
  StatusBadge,
  isIdentityConfigReady,
} from '@/components/ui';
import type { AddyIoAccountDetails } from '../../../types/generated';

interface CommandCenterProps {
  // Provider
  activeProvider: ProviderName;
  onProviderChange: (provider: ProviderName) => void;
  providers: ProviderInfo[];

  // Tabs + panel width (drag-resizable divider in AutoReg)
  activeTab: ConfigTab;
  onTabChange: (tab: ConfigTab) => void;
  width: number;

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
  browserEngine: string;
  onBrowserEngineChange: (engine: string) => void;
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

type ChipTone = 'default' | 'accent' | 'success';

/**
 * Cockpit section — collapsible block with a status chip in the header.
 * Replaces the old tab bar: every setting group is visible at a glance,
 * expand state persists per section in localStorage.
 */
function CockpitSection({
  id,
  title,
  chip,
  chipTone = 'default',
  defaultExpanded = true,
  forceExpanded = false,
  children,
}: {
  id: string;
  title: string;
  chip?: string;
  chipTone?: ChipTone;
  defaultExpanded?: boolean;
  forceExpanded?: boolean;
  children: React.ReactNode;
}) {
  const storageKey = `cockpit-v2-${id}`;
  const [storedExpanded, setExpanded] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored !== null ? stored === 'true' : defaultExpanded;
    } catch {
      return defaultExpanded;
    }
  });
  const expanded = forceExpanded || storedExpanded;
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {
      // ignore
    }
  };

  return (
    <div className="border-b border-white/[0.06] last:border-b-0">
      <div
        onClick={toggle}
        role="button"
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
        className="w-full flex items-center justify-between gap-2 py-1.5 group cursor-pointer"
      >
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 group-hover:text-slate-400 transition-colors">
          {title}
        </span>
        <span className="flex items-center gap-1.5 min-w-0">
          {chip && (
            <span
              className={cn(
                'px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border truncate',
                chipTone === 'accent' &&
                  'bg-indigo-500/10 border-indigo-500/30 text-indigo-300',
                chipTone === 'success' &&
                  'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
                chipTone === 'default' && 'bg-white/[0.03] border-white/10 text-slate-400'
              )}
            >
              {chip}
            </span>
          )}
          {expanded ? (
            <ChevronUp className="w-3 h-3 text-slate-700 group-hover:text-slate-500 shrink-0" />
          ) : (
            <ChevronDown className="w-3 h-3 text-slate-700 group-hover:text-slate-500 shrink-0" />
          )}
        </span>
      </div>
      <div
        className={cn(
          'overflow-hidden transition-all duration-200',
          expanded ? 'max-h-[2000px] opacity-100 pb-2' : 'max-h-0 opacity-0'
        )}
      >
        {children}
      </div>
    </div>
  );
}

export const CommandCenter = ({
  activeProvider,
  onProviderChange,
  providers,
  activeTab,
  onTabChange,
  width,
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
  browserEngine,
  onBrowserEngineChange,
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
  // instead of the cockpit sections.
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

  // ── Header chips: at-a-glance state of every section ────────────────────
  const identityChip = identityConfig.addyioEnabled
    ? 'Addy.io'
    : identityConfig.thirtyThreeMailEnabled
      ? '33mail'
      : identityConfig.mailtmEnabled
        ? 'Mail.tm'
        : identityConfig.icloudEnabled
          ? 'iCloud'
          : identityConfig.strategy === 'gmail'
            ? 'Gmail'
            : identityConfig.strategy === 'cf-to-imap'
              ? 'CF→IMAP'
              : 'Свой домен';
  const engineChip = browserEngine === 'shardbrowser' ? 'ShardBrowser' : 'CloakBrowser';
  const networkChip = networkConfig.enabled ? 'Прокси' : 'Прямое';
  const launchChip = `${speedMultiplier}× · ${delayBetweenAccounts}с`;
  const soundChip = captchaSoundEnabled ? 'звук вкл' : 'звук выкл';

  const showSection = (tab: ConfigTab) => activeTab === 'all' || activeTab === tab;
  const single = activeTab !== 'all';

  return (
    <div
      style={{ width }}
      className="min-w-[320px] max-w-[700px] overflow-hidden shrink-0 flex flex-col h-full border-b md:border-b-0 md:border-r border-white/5"
    >
      {/* Provider Selector; save status floats over its empty corner — zero layout shift */}
      <div className="relative">
        <ProviderSelector
          activeProvider={activeProvider}
          onProviderChange={onProviderChange}
          providers={providers}
          disabled={disabled}
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-1 z-10 flex justify-end px-4">
          {savePill}
        </div>
      </div>

      {/* Tab bar: "Все" shows the full cockpit; a single tab isolates one section */}
      <ConfigTabs activeTab={activeTab} onTabChange={onTabChange} disabled={disabled} />

      {/* Cockpit — all sections visible, collapsible, chip-annotated */}
      <div className="flex-1 overflow-y-auto px-4 py-1 min-h-0">
        {showScenarioEditor && pipelineSteps && onPipelineStepsChange ? (
          <PipelineStepConfigPanel
            steps={pipelineSteps}
            onChange={onPipelineStepsChange}
            onBack={() => setShowScenarioEditor(false)}
            disabled={isRunning}
          />
        ) : (
          <div className="flex flex-col">
            {showSection('identity') && (
            <CockpitSection
              id="identity"
              title={t('autoReg.cockpit.identity')}
              chip={identityChip}
              chipTone={isIdentityConfigReady(identityConfig) ? 'success' : 'default'}
              defaultExpanded={!isIdentityConfigReady(identityConfig)}
              forceExpanded={single}
            >
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
            </CockpitSection>
            )}

            {showSection('browser') && (
            <CockpitSection
              id="browser"
              title={t('autoReg.cockpit.browser')}
              chip={engineChip}
              chipTone="accent"
              defaultExpanded={false}
              forceExpanded={single}
            >
              <BrowserSection
                provider={activeProvider}
                browserEngine={browserEngine}
                onBrowserEngineChange={onBrowserEngineChange}
                headless={headless}
                onHeadlessChange={onHeadlessChange}
                realisticTyping={realisticTyping}
                onRealisticTypingChange={onRealisticTypingChange}
                humanDelays={humanDelays}
                onHumanDelaysChange={onHumanDelaysChange}
                screenshotsOnError={screenshotsOnError}
                onScreenshotsOnErrorChange={onScreenshotsOnErrorChange}
                disabled={disabled}
              />
            </CockpitSection>
            )}

            {showSection('network') && (
            <CockpitSection
              id="network"
              title={t('autoReg.cockpit.network')}
              chip={networkChip}
              defaultExpanded={false}
              forceExpanded={single}
            >
              <NetworkTab config={networkConfig} onChange={onNetworkConfigChange} disabled={disabled} />
            </CockpitSection>
            )}

            {showSection('launch') && (
            <CockpitSection
              id="launch"
              title={t('autoReg.cockpit.launch')}
              chip={launchChip}
              defaultExpanded={false}
              forceExpanded={single}
            >
              <LaunchSection
                provider={activeProvider}
                useRegistrationV2={useRegistrationV2}
                onUseRegistrationV2Change={onUseRegistrationV2Change}
                headless={headless}
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
                cardsText={cardsText}
                onCardsTextChange={onCardsTextChange}
                cardBin={cardBin}
                onCardBinChange={onCardBinChange}
                kiroPlan={kiroPlan}
                onKiroPlanChange={onKiroPlanChange}
                disabled={disabled}
              />
            </CockpitSection>
            )}

            {showSection('notify') && (
            <CockpitSection
              id="notify"
              title={t('autoReg.cockpit.notify')}
              chip={soundChip}
              defaultExpanded={false}
              forceExpanded={single}
            >
              <SoundsTab
                captchaSoundEnabled={captchaSoundEnabled}
                onCaptchaSoundEnabledChange={onCaptchaSoundEnabledChange}
                captchaSoundFile={captchaSoundFile}
                onCaptchaSoundFileChange={onCaptchaSoundFileChange}
                captchaTimeout={captchaTimeout}
                onCaptchaTimeoutChange={onCaptchaTimeoutChange}
                disabled={disabled}
              />
            </CockpitSection>
            )}
          </div>
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
        onConfigureMail={() => onTabChange('identity')}
      />
    </div>
  );
};
