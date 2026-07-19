import { t } from "@/lib/i18n"; import { useState, useEffect } from 'react';
import {
  Settings2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CreditCard,
  Sparkles,
  Loader2
} from
  'lucide-react';
import { safeInvoke } from '../../lib/tauri/core';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { Tooltip } from '../Tooltip';
import type { ProviderName } from '../../types/ui';
import type { LogVerbosity } from '../../constants/logging';
import { LOG_VERBOSITY_OPTIONS } from '../../constants/logging';
import { Button, GlassCard, Input, Select, Toggle, Textarea, Badge } from '@/components/ui';
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
  cardBin?: string;
  onCardBinChange?: (text: string) => void;
  // Kiro-specific
  kiroPlan?: string;
  onKiroPlanChange?: (plan: string) => void;
  disabled?: boolean;
}

// Compact collapsible group — minimal chrome, persists to localStorage
function CompactGroup({
  title,
  children,
  defaultExpanded = false




}: { title: string; children: React.ReactNode; defaultExpanded?: boolean; }) {
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
      <div
        onClick={toggle}
        className="w-full flex items-center justify-between py-1.5 group cursor-pointer"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
      >

        <span className="text-[10px] font-semibold text-slate-600 tracking-wide group-hover:text-slate-500 transition-colors">
          {title}
        </span>
        {expanded ?
          <ChevronUp className="w-3 h-3 text-slate-700 group-hover:text-slate-500" /> :

          <ChevronDown className="w-3 h-3 text-slate-700 group-hover:text-slate-500" />
        }
      </div>
      <div
        className={cn(
          'overflow-hidden transition-all duration-200',
          expanded ? 'max-h-[800px] opacity-100 pb-2' : 'max-h-0 opacity-0'
        )}>

        {children}
      </div>
    </div>);

}

// Inline toggle — label + toggle close together
function InlineToggle({
  label,
  tooltip,
  checked,
  onChange,
  disabled






}: { label: string; tooltip?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; }) {
  const content =
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-400">{label}</span>
      <Toggle
        label=""
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        tooltip={tooltip} />

    </div>;

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
  disabled
}: EngineTabProps) {
  const [cardMode, setCardMode] = useState<'manual' | 'auto'>('auto');
  const [findingLive, setFindingLive] = useState(false);
  const [lastFoundCard, setLastFoundCard] = useState<string | null>(null);

  // Sync cardMode when cardsText changes - preserve user's manual choice if they have cards
  // but default to auto when cardsText is empty
  useEffect(() => {
    if (!cardsText && cardMode === 'manual') {
      setCardMode('auto');
    }
  }, [cardsText, cardMode]);

  const handleFindLive = async () => {
    if (!cardBin || findingLive) return;
    setFindingLive(true);
    setLastFoundCard(null);

    try {
      const result = await safeInvoke<{ number: string; month: string; year: string; cvv: string; } | null>('find_live_card', {
        bin: cardBin,
        maxAttempts: 20,
        month: null,
        year: null
      });

      if (result) {
        const cardStr = `${result.number}|${result.month}|${result.year}|${result.cvv}`;
        setLastFoundCard(cardStr);
        onCardsTextChange?.(cardStr);
        toast.success(`Live карта найдена!`);
      } else {
        toast.error('Не удалось найти Live карту');
      }
    } catch (err) {
      toast.error('Ошибка: ' + String(err));
    } finally {
      setFindingLive(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* ===== PRIMARY EXECUTION SETTINGS ===== */}
      <GlassCard className="p-3">
        <div className="mb-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-300">Основные параметры</div>
          <div className="text-[10px] text-slate-500">Применяются к следующему запуску</div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 rounded-md bg-white/[0.02] px-2.5 py-2">
            <InlineToggle
              label="Открывать браузерное окно"
              checked={!headless}
              onChange={enabled => onHeadlessChange(!enabled)}
              disabled={disabled}
              tooltip="Показывать браузерное окно во время выполнения." />
          </div>

          <Tooltip content="Скорость выполнения операций">
            <NumberInput
              label="Скорость"
              value={speedMultiplier}
              onChange={onSpeedMultiplierChange}
              min={0.5}
              max={2}
              step={0.1}
              unit="×"
              className="w-full" />
          </Tooltip>
          <Tooltip content="Задержка между задачами">
            <NumberInput
              label="Задержка"
              value={delayBetweenAccounts}
              onChange={onDelayBetweenAccountsChange}
              min={1}
              max={10}
              step={1}
              unit="сек"
              className="w-full" />
          </Tooltip>
          <Tooltip content={t("autoReg.engineTab.passwordLengthTooltip")}>
            <NumberInput
              label="Длина пароля"
              value={passwordLength}
              onChange={onPasswordLengthChange}
              min={12}
              max={24}
              step={1}
              unit={t("autoReg.engineTab.symbolUnit")}
              className="w-full" />
          </Tooltip>
          <div className="flex flex-col gap-1">
            <span className="text-[9px] uppercase font-medium text-slate-600 tracking-wider px-0.5">{t("autoReg.engineTab.logsLabel")}</span>
            <Select
              value={logVerbosity}
              onChange={(event) => onLogVerbosityChange(event.target.value as LogVerbosity)}
              options={LOG_VERBOSITY_OPTIONS.map(option => ({ value: option.value, label: option.label }))}
              disabled={disabled}
              shellClassName="h-8 rounded-md"
              className="h-full py-0 px-2 pr-8 text-xs" />
          </div>
        </div>
      </GlassCard>

      {/* Warning for OpenAI */}
      {provider === 'openai' && headless &&
        <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
          <span className="text-[11px] text-amber-300">{t("autoReg.engineTab.openai_captcha")}

          </span>
        </div>
      }

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
              tooltip="Ожидание верификации email" />

            <NumberInput
              label="OAuth"
              value={oauthCallbackTimeout}
              onChange={onOauthCallbackTimeoutChange}
              min={30}
              max={180}
              step={10}
              unit="сек"
              disabled={disabled}
              tooltip="Ожидание OAuth авторизации" />

            <NumberInput
              label="Доступ"
              value={allowAccessWait}
              onChange={onAllowAccessWaitChange}
              min={60}
              max={300}
              step={10}
              unit="сек"
              disabled={disabled}
              tooltip="Ожидание страницы разрешения" />

            <NumberInput
              label="Страница"
              value={pageLoadTimeout}
              onChange={onPageLoadTimeoutChange}
              min={2}
              max={15}
              step={1}
              unit="сек"
              disabled={disabled}
              tooltip="Загрузка страницы" />

            <NumberInput
              label="Элемент"
              value={elementWaitTimeout}
              onChange={onElementWaitTimeoutChange}
              min={1}
              max={10}
              step={1}
              unit="сек"
              disabled={disabled}
              tooltip="Появление элемента на странице" />

            <NumberInput
              label="IMAP"
              value={imapPollInterval}
              onChange={onImapPollIntervalChange}
              min={0.5}
              max={5}
              step={0.5}
              unit="сек"
              disabled={disabled}
              tooltip="Интервал проверки почты" />

          </div>
        </CompactGroup>

        <CompactGroup title="Браузер">
          <div className="grid gap-1 rounded-md bg-white/[0.02] p-2">
            <InlineToggle
              label="Плавный набор текста"
              checked={realisticTyping}
              onChange={onRealisticTypingChange}
              disabled={disabled}
              tooltip="Добавляет задержки между вводимыми символами." />
            <InlineToggle
              label="Дополнительные паузы"
              checked={humanDelays}
              onChange={onHumanDelaysChange}
              disabled={disabled}
              tooltip="Добавляет небольшие паузы между действиями." />
            <InlineToggle
              label="Скриншоты при ошибках"
              checked={screenshotsOnError}
              onChange={onScreenshotsOnErrorChange}
              disabled={disabled}
              tooltip="Сохраняет скриншоты для отладки ошибок." />
          </div>
        </CompactGroup>

        {provider === 'fireworks' && (onCardsTextChange || onCardBinChange) &&
          <CompactGroup title="Карты">
            {/* Mode toggle */}
            <div className="flex gap-1 mb-2">
              <Button
                size="xs"
                variant={cardMode === 'manual' ? 'primary' : 'ghost'}
                onClick={() => setCardMode('manual')}
                className={cn(
                  'px-2 py-0.5 text-[11px] rounded transition-colors',
                  cardMode === 'manual' ? '' : 'text-slate-500 hover:text-slate-300'
                )}>{t("autoReg.engineTab.manual")}


              </Button>
              <Button
                size="xs"
                variant={cardMode === 'auto' ? 'primary' : 'ghost'}
                onClick={() => setCardMode('auto')}
                className={cn(
                  'px-2 py-0.5 text-[11px] rounded transition-colors',
                  cardMode === 'auto' ? '' : 'text-slate-500 hover:text-slate-300'
                )}>{t("autoReg.engineTab.auto")}


              </Button>
            </div>

            {cardMode === 'manual' ?
              <>
                <Textarea
                  value={cardsText || ''}
                  onChange={(e) => onCardsTextChange?.(e.target.value)}
                  placeholder={`4242424242424242|12|2026|123\n5555555555554444|01|2027|456`}
                  rows={2}
                  disabled={disabled}
                  className="font-mono text-xs min-h-[60px]" />

                {cardsText &&
                  <div className="mt-1 text-[11px] text-slate-500">
                    {cardsText.split('\n').filter((l) => l.trim()).length} {t('autoReg.engineTab.cardsLoaded')}
                  </div>
                }
              </> :

              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={cardBin || ''}
                    onChange={(e) => onCardBinChange?.(e.target.value)}
                    placeholder="515462002112xxxx"
                    disabled={disabled || findingLive}
                    className="flex-1 text-xs font-mono"
                    shellClassName="h-7"
                  />

                  <Button
                    size="xs"
                    variant="primary"
                    onClick={handleFindLive}
                    disabled={disabled || findingLive || !cardBin}
                    className={cn(
                      'flex items-center gap-1',
                      findingLive || !cardBin ?
                        'bg-white/[0.03] text-slate-600 cursor-not-allowed' :
                        'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20'
                    )}>

                    {findingLive ?
                      <Loader2 size={12} className="animate-spin" /> :

                      <>
                        <Sparkles size={12} />
                        {t('autoReg.engineTab.findLive')}
                      </>
                    }
                  </Button>
                </div>

                {lastFoundCard &&
                  <div className="text-[11px] text-emerald-400 flex items-center gap-1">
                    <CreditCard size={12} />{t("autoReg.engineTab.live")}
                    {lastFoundCard}
                  </div>
                }

                {cardsText && !lastFoundCard &&
                  <div className="text-[11px] text-slate-500">
                    {t('autoReg.engineTab.savedCards', { count: cardsText.split('\n').filter((l) => l.trim()).length })}
                  </div>
                }
              </div>
            }
          </CompactGroup>
        }

        {/* Kiro plan selection — only for kiro_v2 */}
        {provider === 'kiro_v2' && onKiroPlanChange &&
          <CompactGroup title="Тариф Kiro" defaultExpanded>
            <div className="flex flex-col gap-1 pb-1">
              {[
                { value: 'free', label: 'Free', sub: '$0 · 50 кр' },
                { value: 'pro', label: 'Pro', sub: '$20 · 1K' },
                { value: 'pro_plus', label: 'Pro+', sub: '$40 · 2K' },
                { value: 'pro_max', label: 'Pro Max', sub: '$100 · 5K' },
                { value: 'power', label: 'Power', sub: '$200 · 10K' },
              ].map(opt => {
                const active = (kiroPlan || 'free') === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={disabled}
                    onClick={() => onKiroPlanChange(opt.value)}
                    className={cn(
                      'flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs transition-colors text-left',
                      'border',
                      active
                        ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                        : 'bg-white/[0.02] border-white/[0.05] text-slate-400 hover:text-slate-200 hover:bg-white/[0.05]',
                      disabled && 'opacity-50 pointer-events-none',
                    )}
                  >
                    <span className="font-medium">{opt.label}</span>
                    <span className={cn('text-[10px]', active ? 'text-indigo-400' : 'text-slate-600')}>
                      {opt.sub}
                    </span>
                  </button>
                );
              })}
            </div>
          </CompactGroup>
        }
      </div>

      {/* Registration V2 badge (rare, bottom) */}
      {provider === 'aws' &&
        <GlassCard className="p-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings2 className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-xs text-slate-400">{t("autoReg.engineTab.v2")}</span>
              <Badge variant="info" size="sm" withDot>{t("autoReg.engineTab.rust")}</Badge>
            </div>
            <Toggle
              label=""
              checked={useRegistrationV2}
              onChange={onUseRegistrationV2Change}
              disabled={disabled}
              tooltip="Новый Rust-based поток с улучшенной обработкой ошибок" />

          </div>
        </GlassCard>
      }
    </div>);

}
