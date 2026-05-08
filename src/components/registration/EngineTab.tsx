import { useState } from 'react';
import {
  Settings2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Tooltip } from '../Tooltip';
import type { ProviderName } from '../../types/ui';
import type { LogVerbosity } from '../../constants/logging';
import { LOG_VERBOSITY_OPTIONS } from '../../constants/logging';
import { GlassCard, Select, Toggle, Textarea, Badge } from '@/components/ui';
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
  cardsText?: string;
  onCardsTextChange?: (text: string) => void;
  disabled?: boolean;
}

// Compact collapsible group — minimal chrome, persists to localStorage
function CompactGroup({
  title,
  children,
  defaultExpanded = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
}) {
  const storageKey = `engine-tab-expanded-${title}`;
  const [expanded, setExpanded] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored !== null ? stored === 'true' : defaultExpanded;
    } catch {
      return defaultExpanded;
    }
  });
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
    <div className="border-t border-white/[0.06] first:border-0">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between py-1.5 group"
      >
        <span className="text-[10px] font-semibold text-slate-600 tracking-wide group-hover:text-slate-500 transition-colors">
          {title}
        </span>
        {expanded ? (
          <ChevronUp className="w-3 h-3 text-slate-700 group-hover:text-slate-500" />
        ) : (
          <ChevronDown className="w-3 h-3 text-slate-700 group-hover:text-slate-500" />
        )}
      </button>
      <div
        className={cn(
          'overflow-hidden transition-all duration-200',
          expanded ? 'max-h-[800px] opacity-100 pb-2' : 'max-h-0 opacity-0'
        )}
      >
        {children}
      </div>
    </div>
  );
}

// Inline toggle — label + toggle close together
function InlineToggle({
  label,
  tooltip,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  tooltip?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const content = (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-400">{label}</span>
      <Toggle
        label=""
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        tooltip={tooltip}
      />
    </div>
  );
  return tooltip ? <Tooltip content={tooltip}>{content}</Tooltip> : content;
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
  cardsText,
  onCardsTextChange,
  disabled,
}: EngineTabProps) {
  return (
    <div className="flex flex-col gap-2">
      {/* ===== CRITICAL SETTINGS — always visible, compact, single card ===== */}
      <GlassCard className="p-2">
        <div className="flex flex-col gap-1.5">
          {/* Row 1: Headless | Speed | Delay | Password */}
          <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-2 items-center">
            <InlineToggle
              label="Без окна"
              checked={headless}
              onChange={onHeadlessChange}
              disabled={disabled}
              tooltip="Запуск браузера без видимого окна. Ускоряет, но может быть обнаружен."
            />
            <Tooltip content="Скорость выполнения операций">
              <NumberInput
                label=""
                value={speedMultiplier}
                onChange={onSpeedMultiplierChange}
                min={0.5}
                max={2}
                step={0.1}
                unit="×"
                className="w-full"
              />
            </Tooltip>
            <Tooltip content="Задержка между регистрациями">
              <NumberInput
                label=""
                value={delayBetweenAccounts}
                onChange={onDelayBetweenAccountsChange}
                min={1}
                max={10}
                step={1}
                unit="сек"
                className="w-full"
              />
            </Tooltip>
            <Tooltip content="Длина генерируемого пароля">
              <NumberInput
                label=""
                value={passwordLength}
                onChange={onPasswordLengthChange}
                min={12}
                max={24}
                step={1}
                unit="сим"
                className="w-full"
              />
            </Tooltip>
          </div>

          {/* Row 2: Logs + Debug toggle */}
          <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 shrink-0">Логи</span>
              <Select
                value={logVerbosity}
                onChange={e => onLogVerbosityChange(e.target.value as LogVerbosity)}
                options={LOG_VERBOSITY_OPTIONS.map(opt => ({
                  value: opt.value,
                  label: opt.label,
                }))}
                disabled={disabled}
                containerClassName="flex-1"
                shellClassName="h-8 rounded-md"
                className="h-full py-0 px-2 pr-8 text-xs"
              />
            </div>
            <InlineToggle
              label="Debug"
              checked={showDebugLogsInConsole}
              onChange={onShowDebugLogsInConsoleChange}
              disabled={disabled}
              tooltip="Показывать технические детали в консоли браузера"
            />
          </div>
        </div>
      </GlassCard>

      {/* Warning for OpenAI */}
      {provider === 'openai' && headless && (
        <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
          <span className="text-[11px] text-amber-300">
            OpenAI может требовать CAPTCHA — рекомендуется видимый браузер
          </span>
        </div>
      )}

      {/* ===== ADVANCED — collapsible groups, flat, minimal ===== */}
      <div className="flex flex-col">
        <CompactGroup title="Таймауты">
          <div className="grid grid-cols-3 gap-x-2 gap-y-1">
            <NumberInput
              label="Email"
              value={verificationCodeTimeout}
              onChange={onVerificationCodeTimeoutChange}
              min={60}
              max={180}
              step={10}
              unit="сек"
              disabled={disabled}
              tooltip="Ожидание верификации email"
            />
            <NumberInput
              label="OAuth"
              value={oauthCallbackTimeout}
              onChange={onOauthCallbackTimeoutChange}
              min={30}
              max={180}
              step={10}
              unit="сек"
              disabled={disabled}
              tooltip="Ожидание OAuth авторизации"
            />
            <NumberInput
              label="Доступ"
              value={allowAccessWait}
              onChange={onAllowAccessWaitChange}
              min={60}
              max={300}
              step={10}
              unit="сек"
              disabled={disabled}
              tooltip="Ожидание страницы разрешения"
            />
            <NumberInput
              label="Страница"
              value={pageLoadTimeout}
              onChange={onPageLoadTimeoutChange}
              min={2}
              max={15}
              step={1}
              unit="сек"
              disabled={disabled}
              tooltip="Загрузка страницы"
            />
            <NumberInput
              label="Элемент"
              value={elementWaitTimeout}
              onChange={onElementWaitTimeoutChange}
              min={1}
              max={10}
              step={1}
              unit="сек"
              disabled={disabled}
              tooltip="Появление элемента на странице"
            />
            <NumberInput
              label="IMAP"
              value={imapPollInterval}
              onChange={onImapPollIntervalChange}
              min={0.5}
              max={5}
              step={0.5}
              unit="сек"
              disabled={disabled}
              tooltip="Интервал проверки почты"
            />
          </div>
        </CompactGroup>

        <CompactGroup title="Браузер">
          <div className="flex gap-3">
            <InlineToggle
              label="Набор"
              checked={realisticTyping}
              onChange={onRealisticTypingChange}
              disabled={disabled}
              tooltip="Имитация человеческого набора с задержками"
            />
            <InlineToggle
              label="Паузы"
              checked={humanDelays}
              onChange={onHumanDelaysChange}
              disabled={disabled}
              tooltip="Случайные паузы между действиями"
            />
            <InlineToggle
              label="Скриншоты"
              checked={screenshotsOnError}
              onChange={onScreenshotsOnErrorChange}
              disabled={disabled}
              tooltip="Скриншоты при ошибках для отладки"
            />
          </div>
        </CompactGroup>

        {(provider === 'fireworks' || provider === 'fireworks2') && onCardsTextChange && (
          <CompactGroup title="Карты">
            <Textarea
              value={cardsText || ''}
              onChange={e => onCardsTextChange(e.target.value)}
              placeholder={`4242424242424242|12|2026|123\n5555555555554444|01|2027|456`}
              rows={2}
              disabled={disabled}
              className="font-mono text-xs min-h-[60px]"
            />
            {cardsText && (
              <div className="mt-1 text-[11px] text-slate-500">
                {cardsText.split('\n').filter(l => l.trim()).length} карт загружено
              </div>
            )}
          </CompactGroup>
        )}
      </div>

      {/* Registration V2 badge (rare, bottom) */}
      {provider === 'aws' && (
        <GlassCard className="p-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings2 className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-xs text-slate-400">Регистрация V2</span>
              <Badge variant="info" size="sm" withDot>Rust</Badge>
            </div>
            <Toggle
              label=""
              checked={useRegistrationV2}
              onChange={onUseRegistrationV2Change}
              disabled={disabled}
              tooltip="Новый Rust-based поток с улучшенной обработкой ошибок"
            />
          </div>
        </GlassCard>
      )}
    </div>
  );
}
