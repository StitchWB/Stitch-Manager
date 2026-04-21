import { Settings2, Eye, EyeOff, Timer, Keyboard, MessageSquare } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tooltip } from '../Tooltip';

import { t } from '../../lib/i18n';
import type { ProviderName } from '../../types/ui';
import type { LogVerbosity } from '../../constants/logging';
import { LOG_VERBOSITY_OPTIONS } from '../../constants/logging';
import { RangeSlider, SectionHeader, Select, Toggle } from '@/components/ui';
import { NumberInput } from '../ui/NumberInput';

interface EngineTabProps {
  provider: ProviderName;
  useRegistrationV2: boolean;
  onUseRegistrationV2Change: (enabled: boolean) => void;
  headless: boolean;
  onHeadlessChange: (enabled: boolean) => void;
  speedMultiplier: number;
  onSpeedMultiplierChange: (value: number) => void;
  delayBetweenAccounts: number;
  onDelayBetweenAccountsChange: (value: number) => void;
  logVerbosity: LogVerbosity;
  onLogVerbosityChange: (level: LogVerbosity) => void;
  showDebugLogsInConsole: boolean;
  onShowDebugLogsInConsoleChange: (enabled: boolean) => void;
  verificationCodeTimeout: number;
  onVerificationCodeTimeoutChange: (value: number) => void;
  oauthCallbackTimeout: number;
  onOauthCallbackTimeoutChange: (value: number) => void;
  allowAccessWait: number;
  onAllowAccessWaitChange: (value: number) => void;
  pageLoadTimeout: number;
  onPageLoadTimeoutChange: (value: number) => void;
  elementWaitTimeout: number;
  onElementWaitTimeoutChange: (value: number) => void;
  imapPollInterval: number;
  onImapPollIntervalChange: (value: number) => void;
  passwordLength: number;
  onPasswordLengthChange: (value: number) => void;
  realisticTyping: boolean;
  onRealisticTypingChange: (enabled: boolean) => void;
  humanDelays: boolean;
  onHumanDelaysChange: (enabled: boolean) => void;
  screenshotsOnError: boolean;
  onScreenshotsOnErrorChange: (enabled: boolean) => void;
  disabled?: boolean;
}

export function EngineTab({
  provider,
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
  disabled,
}: EngineTabProps) {
  return (
    <div className="space-y-4">
      {/* Registration V2 Toggle - Only for AWS/Kiro */}
      {provider === 'aws' && (
        <div
          className="rounded-lg p-3"
          style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
              <Settings2
                className={cn('w-4 h-4', useRegistrationV2 ? 'text-indigo-400' : 'text-slate-500')}
              />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-slate-200 flex items-center gap-2">
                Registration V2
                <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                  NEW
                </span>
              </div>
              <div className="text-[10px] text-slate-500">
                Rust-based flow with better error handling
              </div>
            </div>
          </div>
          <Toggle
            label="Enable Registration V2"
            checked={useRegistrationV2}
            onChange={onUseRegistrationV2Change}
            disabled={disabled}
          />
        </div>
      )}

      {/* Headless Mode */}
      <div
        className="rounded-lg p-3"
        style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
            {headless ? (
              <EyeOff className="w-4 h-4 text-indigo-400" />
            ) : (
              <Eye className="w-4 h-4 text-slate-500" />
            )}
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium text-slate-200">{t('autoReg.headless')}</div>
            <div className="text-[10px] text-slate-500">{t('autoReg.headlessDescription')}</div>
          </div>
        </div>
        <Toggle
          label={t('autoReg.headless')}
          checked={headless}
          onChange={onHeadlessChange}
          disabled={disabled}
        />
        {provider === 'openai' && headless && (
          <div className="mt-2 text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-md px-2 py-1">
            OpenAI flow may require CAPTCHA/payment checks — visible browser is recommended.
          </div>
        )}
      </div>

      {/* Log Verbosity */}
      <div
        className="rounded-lg p-3"
        style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-slate-500" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-medium text-slate-200">{t('autoReg.logVerbosity')}</div>
            <div className="text-[10px] text-slate-500">{t('autoReg.logVerbosityDescription')}</div>
          </div>
        </div>
        <Tooltip content={t('autoReg.logVerbosityTooltip')}>
          <Select
            value={logVerbosity}
            onChange={e => onLogVerbosityChange(e.target.value as LogVerbosity)}
            options={LOG_VERBOSITY_OPTIONS.map(opt => ({
              value: opt.value,
              label: opt.label,
            }))}
            disabled={disabled}
          />
        </Tooltip>
        <div className="mt-2">
          <Toggle
            label="Debug entries in console"
            checked={showDebugLogsInConsole}
            onChange={onShowDebugLogsInConsoleChange}
            disabled={disabled}
            tooltip="Only affects console filtering; does not change backend log verbosity"
          />
        </div>
      </div>

      {/* Speed & Delay Row */}
      <div className="grid grid-cols-2 gap-3">
        {/* Speed Multiplier */}
        <Tooltip content={t('autoReg.tooltips.speed')}>
          <RangeSlider
            label={t('autoReg.speed')}
            value={speedMultiplier}
            onChange={onSpeedMultiplierChange}
            min={0.5}
            max={2}
            step={0.1}
            unit="x"
            valueFormatter={v => v.toFixed(1)}
            showMinMax
            minLabel={t('autoReg.slow')}
            maxLabel={t('autoReg.fast')}
          />
        </Tooltip>

        {/* Delay Between Accounts */}
        <Tooltip content={t('autoReg.tooltips.delay')}>
          <RangeSlider
            label={t('autoReg.delay')}
            value={delayBetweenAccounts}
            onChange={onDelayBetweenAccountsChange}
            min={1}
            max={10}
            step={1}
            unit="s"
            showMinMax
            minLabel="1s"
            maxLabel="10s"
          />
        </Tooltip>
      </div>

      {/* Timeouts Section */}
      <SectionHeader
        title={t('autoReg.timeouts')}
        icon={<Timer className="w-3.5 h-3.5 text-slate-500" />}
      >
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            label={t('autoReg.verification')}
            value={verificationCodeTimeout}
            onChange={onVerificationCodeTimeoutChange}
            min={60}
            max={180}
            step={10}
            disabled={disabled}
            tooltip={t('autoReg.tooltips.verification')}
          />
          <NumberInput
            label={t('autoReg.oauth')}
            value={oauthCallbackTimeout}
            onChange={onOauthCallbackTimeoutChange}
            min={30}
            max={180}
            step={10}
            disabled={disabled}
            tooltip={t('autoReg.tooltips.oauth')}
          />
          <NumberInput
            label={t('autoReg.allowAccess')}
            value={allowAccessWait}
            onChange={onAllowAccessWaitChange}
            min={60}
            max={300}
            step={10}
            disabled={disabled}
            tooltip={t('autoReg.tooltips.allowAccess')}
          />
          <NumberInput
            label={t('autoReg.pageLoad')}
            value={pageLoadTimeout}
            onChange={onPageLoadTimeoutChange}
            min={2}
            max={15}
            step={1}
            disabled={disabled}
            tooltip={t('autoReg.tooltips.pageLoad')}
          />
          <NumberInput
            label={t('autoReg.elementWait')}
            value={elementWaitTimeout}
            onChange={onElementWaitTimeoutChange}
            min={1}
            max={10}
            step={1}
            disabled={disabled}
            tooltip={t('autoReg.tooltips.elementWait')}
          />
          <NumberInput
            label={t('autoReg.imapPoll')}
            value={imapPollInterval}
            onChange={onImapPollIntervalChange}
            min={0.5}
            max={5}
            step={0.5}
            disabled={disabled}
            tooltip={t('autoReg.tooltips.imapPoll')}
          />
        </div>
      </SectionHeader>

      {/* Browser Behavior Section */}
      <SectionHeader
        title={t('autoReg.behavior')}
        icon={<Keyboard className="w-3.5 h-3.5 text-slate-500" />}
      >
        {/* Password Length */}
        <Tooltip content={t('autoReg.tooltips.passwordLength')}>
          <RangeSlider
            label={t('autoReg.passwordLength')}
            value={passwordLength}
            onChange={onPasswordLengthChange}
            min={12}
            max={24}
            step={1}
            showMinMax={false}
            className="mb-3"
          />
        </Tooltip>

        {/* Toggle Switches */}
        <div className="grid grid-cols-2 gap-2">
          <Toggle
            label={t('autoReg.realisticTyping')}
            checked={realisticTyping}
            onChange={onRealisticTypingChange}
            disabled={disabled}
            tooltip={t('autoReg.tooltips.realisticTyping')}
          />
          <Toggle
            label={t('autoReg.humanDelays')}
            checked={humanDelays}
            onChange={onHumanDelaysChange}
            disabled={disabled}
            tooltip={t('autoReg.tooltips.humanDelays')}
          />
          <Toggle
            label={t('autoReg.screenshots')}
            checked={screenshotsOnError}
            onChange={onScreenshotsOnErrorChange}
            disabled={disabled}
            tooltip={t('autoReg.tooltips.screenshots')}
          />
        </div>
      </SectionHeader>
    </div>
  );
}
