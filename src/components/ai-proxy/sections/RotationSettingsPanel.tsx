import { useCallback, useEffect, useState } from 'react';
import { Activity, ChevronRight, Gauge, HeartPulse, Repeat, Route } from 'lucide-react';
import { toast } from 'sonner';

import { GlassCard, NumberInput, StatusBadge, Toggle } from '@/components/ui';
import { t } from '@/lib/i18n';
import {
  getBackgroundManagerConfig,
  updateBackgroundManagerConfig,
  type BackgroundManagerConfig,
} from '@/lib/backend/modules/backgroundManager';
import type { ProviderCapability } from '@/lib/backend/modules/aiProxy';
import { useAppStore } from '@/stores/app';
import { HealthCheckSettings } from './HealthCheckSettings';
import { ProviderPriorityList } from './ProviderPriorityList';
import { RateLimitPoliciesEditor } from './RateLimitPoliciesEditor';
import { RotationStrategySelector, type RotationStrategy } from './RotationStrategySelector';

interface RotationSettingsPanelProps {
  capabilities: ProviderCapability[];
  visible?: boolean;
}

const MIN_INTERVAL_SECONDS = 10;
const MAX_INTERVAL_SECONDS = 3600;

export function RotationSettingsPanel({
  capabilities,
  visible = true,
}: RotationSettingsPanelProps) {
  const language = useAppStore(state => state.language);
  const isRu = language === 'ru';
  const copy = isRu
    ? {
      eyebrow: 'Умная маршрутизация',
      title: 'Как выбирается следующий аккаунт',
      description:
        'Сначала проверяется доступная ёмкость RPM/TPM, затем применяется стратегия, после ошибки — cooldown.',
      capacity: '1. Ёмкость',
      capacityHint: 'RPM и TPM',
      strategy: '2. Выбор',
      strategyHint: 'Алгоритм ротации',
      health: '3. Защита',
      healthHint: 'Health и cooldown',
      rotation: 'Ротация между аккаунтами',
      rotationHint:
        'Выбирает другой доступный ключ или аккаунт. Лимиты RPM/TPM работают независимо от этого переключателя.',
      saving: 'Сохранение…',
      saved: 'Автосохранение',
    }
    : {
      eyebrow: 'Smart routing',
      title: 'How the next account is selected',
      description:
        'Capacity is checked against RPM/TPM first, then the strategy is applied, followed by failure cooldown.',
      capacity: '1. Capacity',
      capacityHint: 'RPM and TPM',
      strategy: '2. Selection',
      strategyHint: 'Rotation algorithm',
      health: '3. Protection',
      healthHint: 'Health and cooldown',
      rotation: 'Rotate between accounts',
      rotationHint:
        'Selects another eligible key or account. RPM/TPM limits work independently from this switch.',
      saving: 'Saving…',
      saved: 'Auto-save',
    };
  const [config, setConfig] = useState<BackgroundManagerConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loadedConfig = await getBackgroundManagerConfig();
        if (!cancelled) setConfig(loadedConfig);
      } catch (error) {
        console.error('[RotationSettingsPanel] Failed to load config:', error);
        if (!cancelled) toast.error(t('aiHub.rotation.toasts.saveFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (next: BackgroundManagerConfig) => {
    setSaving(true);
    try {
      await updateBackgroundManagerConfig(next);
    } catch (error) {
      console.error('[RotationSettingsPanel] Failed to save config:', error);
      toast.error(t('aiHub.rotation.toasts.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, []);

  const update = useCallback(
    (patch: Partial<BackgroundManagerConfig>) => {
      if (!config) return;
      const next = { ...config, ...patch };
      setConfig(next);
      void persist(next);
    },
    [config, persist]
  );

  const handleStrategyChange = useCallback(
    (rotationStrategy: RotationStrategy) => {
      update({ rotationStrategy });
      toast.success(t('aiHub.rotation.toasts.strategySaved'));
    },
    [update]
  );

  if (!visible) return null;

  return (
    <div className="space-y-2.5">
      <GlassCard className="overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] p-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-300 ring-1 ring-inset ring-violet-400/15">
              <Route size={17} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-violet-300/70">
                {copy.eyebrow}
              </div>
              <h3 className="mt-0.5 text-sm font-semibold text-white">{copy.title}</h3>
              <p className="sr-only">{copy.description}</p>
            </div>
          </div>
          <StatusBadge status={saving ? 'pending' : 'idle'} size="sm" withDot={saving}>
            {saving ? copy.saving : copy.saved}
          </StatusBadge>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-white/[0.06] px-3 py-2">
          <div className="flex shrink-0 items-center gap-1.5 text-[10px]">
            <Gauge size={12} className="text-sky-300" />
            <span className="font-medium text-slate-200">{copy.capacity}</span>
            <span className="hidden text-slate-500 min-[560px]:inline">{copy.capacityHint}</span>
          </div>
          <ChevronRight size={12} className="shrink-0 text-slate-600" />
          <div className="flex shrink-0 items-center gap-1.5 text-[10px]">
            <Repeat size={12} className="text-violet-300" />
            <span className="font-medium text-slate-200">{copy.strategy}</span>
            <span className="hidden text-slate-500 min-[560px]:inline">{copy.strategyHint}</span>
          </div>
          <ChevronRight size={12} className="shrink-0 text-slate-600" />
          <div className="flex shrink-0 items-center gap-1.5 text-[10px]">
            <HeartPulse size={12} className="text-emerald-300" />
            <span className="font-medium text-slate-200">{copy.health}</span>
            <span className="hidden text-slate-500 min-[560px]:inline">{copy.healthHint}</span>
          </div>
        </div>

        <div className="px-3 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <Activity
                size={15}
                className={config?.autoSwitchEnabled ? 'mt-0.5 text-emerald-300' : 'mt-0.5 text-slate-500'}
              />
              <div>
                <div className="text-xs font-medium text-slate-200">{copy.rotation}</div>
                <div className="mt-0.5 text-[11px] leading-4 text-slate-500">
                  {copy.rotationHint}
                </div>
              </div>
            </div>
            <Toggle
              label=""
              checked={config?.autoSwitchEnabled ?? false}
              onChange={autoSwitchEnabled => update({ autoSwitchEnabled })}
              disabled={loading || saving || !config}
              tooltip={copy.rotationHint}
            />
          </div>

          {config?.autoSwitchEnabled ? (
            <div className="mt-3 grid gap-3 border-t border-white/[0.06] pt-3 sm:grid-cols-[minmax(0,1fr)_150px] sm:items-end">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-slate-200">
                    {t('aiHub.rotation.switchOnZeroLabel')}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {t('aiHub.rotation.switchOnZeroHint')}
                  </div>
                </div>
                <Toggle
                  label=""
                  checked={config.switchOnZeroCredits}
                  onChange={switchOnZeroCredits => update({ switchOnZeroCredits })}
                  disabled={loading || saving}
                />
              </div>
              <NumberInput
                label={t('aiHub.rotation.checkIntervalLabel')}
                value={config.checkCreditsIntervalSeconds}
                onChange={checkCreditsIntervalSeconds =>
                  update({
                    checkCreditsIntervalSeconds: Math.max(
                      MIN_INTERVAL_SECONDS,
                      Math.min(MAX_INTERVAL_SECONDS, checkCreditsIntervalSeconds)
                    ),
                  })
                }
                min={MIN_INTERVAL_SECONDS}
                max={MAX_INTERVAL_SECONDS}
                step={10}
                unit={t('aiHub.rotation.secondsUnit')}
                disabled={loading || saving}
              />
            </div>
          ) : null}
        </div>
      </GlassCard>

      <RateLimitPoliciesEditor
        enabled={config?.rateLimitEnabled ?? false}
        reservePercent={config?.rateLimitReservePercent ?? 0}
        policies={config?.rateLimitPolicies ?? []}
        capabilities={capabilities}
        disabled={loading || saving || !config}
        onEnabledChange={rateLimitEnabled => update({ rateLimitEnabled })}
        onReservePercentChange={rateLimitReservePercent => update({ rateLimitReservePercent })}
        onPoliciesChange={rateLimitPolicies => update({ rateLimitPolicies })}
      />

      <RotationStrategySelector
        value={config?.rotationStrategy ?? 'round-robin'}
        onChange={handleStrategyChange}
        disabled={loading || saving || !config?.autoSwitchEnabled}
      />

      {config?.autoSwitchEnabled && config.rotationStrategy === 'priority' ? (
        <ProviderPriorityList
          capabilities={capabilities}
          priority={config.providerPriority}
          onChange={providerPriority => update({ providerPriority })}
          disabled={loading || saving}
        />
      ) : null}

      <HealthCheckSettings
        enabled={config?.healthCheckEnabled ?? false}
        intervalSeconds={config?.healthCheckIntervalSeconds ?? 300}
        autoDisableUnhealthy={config?.healthCheckAutoDisable ?? true}
        testEndpoint={config?.healthCheckTestEndpoint ?? '/v1/models'}
        cooldownDurationSeconds={config?.healthCheckCooldownSeconds ?? 3600}
        exponentialBackoff={config?.healthCheckExponentialBackoff ?? false}
        onEnabledChange={healthCheckEnabled => update({ healthCheckEnabled })}
        onIntervalChange={healthCheckIntervalSeconds => update({ healthCheckIntervalSeconds })}
        onAutoDisableChange={healthCheckAutoDisable => update({ healthCheckAutoDisable })}
        onTestEndpointChange={healthCheckTestEndpoint => update({ healthCheckTestEndpoint })}
        onCooldownDurationChange={healthCheckCooldownSeconds =>
          update({ healthCheckCooldownSeconds })
        }
        onExponentialBackoffChange={healthCheckExponentialBackoff =>
          update({ healthCheckExponentialBackoff })
        }
        disabled={loading || saving || !config}
      />
    </div>
  );
}
