import { useCallback, useState } from 'react';
import { Heart, AlertTriangle } from 'lucide-react';
import { t } from '@/lib/i18n';
import { Button, GlassCard, Toggle, NumberInput, Input } from '@/components/ui';

interface HealthCheckSettingsProps {
  enabled: boolean;
  intervalSeconds: number;
  autoDisableUnhealthy: boolean;
  testEndpoint: string;
  cooldownDurationSeconds: number;
  exponentialBackoff: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onIntervalChange: (seconds: number) => void;
  onAutoDisableChange: (enabled: boolean) => void;
  onTestEndpointChange: (endpoint: string) => void;
  onCooldownDurationChange: (seconds: number) => void;
  onExponentialBackoffChange: (enabled: boolean) => void;
  disabled?: boolean;
}

const MIN_INTERVAL = 30;
const MAX_INTERVAL = 3600;
const MIN_COOLDOWN = 60;
const MAX_COOLDOWN = 86400;

export function HealthCheckSettings({
  enabled,
  intervalSeconds,
  autoDisableUnhealthy,
  testEndpoint,
  cooldownDurationSeconds,
  exponentialBackoff,
  onEnabledChange,
  onIntervalChange,
  onAutoDisableChange,
  onTestEndpointChange,
  onCooldownDurationChange,
  onExponentialBackoffChange,
  disabled = false,
}: HealthCheckSettingsProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleIntervalChange = useCallback(
    (value: number) => {
      const clamped = Math.max(MIN_INTERVAL, Math.min(MAX_INTERVAL, value));
      onIntervalChange(clamped);
    },
    [onIntervalChange]
  );

  const handleCooldownChange = useCallback(
    (value: number) => {
      const clamped = Math.max(MIN_COOLDOWN, Math.min(MAX_COOLDOWN, value));
      onCooldownDurationChange(clamped);
    },
    [onCooldownDurationChange]
  );

  return (
    <GlassCard className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Heart
            size={16}
            className={enabled ? 'text-emerald-400 mt-0.5' : 'text-slate-500 mt-0.5'}
          />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white">
              {t('aiHub.healthCheck.title')}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {t('aiHub.healthCheck.description')}
            </p>
          </div>
        </div>
        <Toggle
          label=""
          checked={enabled}
          onChange={onEnabledChange}
          disabled={disabled}
        />
      </div>

      {enabled && (
        <div className="mt-3 space-y-2.5 border-t border-white/[0.06] pt-3">
          {/* Check Interval */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-slate-200">
                {t('aiHub.healthCheck.intervalLabel')}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {t('aiHub.healthCheck.intervalHint')}
              </div>
            </div>
            <div className="w-[140px] shrink-0">
              <NumberInput
                label=""
                value={intervalSeconds}
                onChange={handleIntervalChange}
                min={MIN_INTERVAL}
                max={MAX_INTERVAL}
                step={30}
                unit={t('aiHub.rotation.secondsUnit')}
                disabled={disabled}
              />
            </div>
          </div>

          {/* Auto-disable unhealthy */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-slate-200">
                {t('aiHub.healthCheck.autoDisableLabel')}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {t('aiHub.healthCheck.autoDisableHint')}
              </div>
            </div>
            <Toggle
              label=""
              checked={autoDisableUnhealthy}
              onChange={onAutoDisableChange}
              disabled={disabled}
            />
          </div>

          {/* Advanced Settings Toggle */}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setShowAdvanced(!showAdvanced)}
            disabled={disabled}
            className="px-0 text-vsc-blue hover:text-sky-300"
          >
            {showAdvanced
              ? t('aiHub.healthCheck.hideAdvanced')
              : t('aiHub.healthCheck.showAdvanced')}
          </Button>

          {/* Advanced Settings */}
          {showAdvanced && (
            <div className="space-y-3 pt-3 border-t border-white/[0.06]">
              {/* Test Endpoint */}
              <div>
                <div className="text-xs text-slate-200 mb-1">
                  {t('aiHub.healthCheck.testEndpointLabel')}
                </div>
                <div className="text-[11px] text-slate-500 mb-2">
                  {t('aiHub.healthCheck.testEndpointHint')}
                </div>
                <Input
                  label=""
                  value={testEndpoint}
                  onChange={e => onTestEndpointChange(e.target.value)}
                  placeholder="/v1/models"
                  disabled={disabled}
                />
              </div>

              {/* Cooldown Duration */}
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-slate-200">
                    {t('aiHub.healthCheck.cooldownLabel')}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {t('aiHub.healthCheck.cooldownHint')}
                  </div>
                </div>
                <div className="w-[140px] shrink-0">
                  <NumberInput
                    label=""
                    value={cooldownDurationSeconds}
                    onChange={handleCooldownChange}
                    min={MIN_COOLDOWN}
                    max={MAX_COOLDOWN}
                    step={60}
                    unit={t('aiHub.rotation.secondsUnit')}
                    disabled={disabled}
                  />
                </div>
              </div>

              {/* Exponential Backoff */}
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-slate-200 flex items-center gap-1">
                    {t('aiHub.healthCheck.exponentialBackoffLabel')}
                    <AlertTriangle size={12} className="text-amber-400" />
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {t('aiHub.healthCheck.exponentialBackoffHint')}
                  </div>
                </div>
                <Toggle
                  label=""
                  checked={exponentialBackoff}
                  onChange={onExponentialBackoffChange}
                  disabled={disabled}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}
