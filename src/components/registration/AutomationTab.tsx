import { useState, useEffect, useCallback } from 'react';
import { GlassCard } from '../ui/GlassCard';
import { Toggle } from '../ui/Toggle';
import { NumberInput } from '../ui/NumberInput';
import { getSettings, updateSettings } from '../../lib/tauri';
import { useRegistrationStore } from '../../stores/registration';
import { Select } from '../ui/Select';
import { RefreshCw, Repeat, Settings2, Shield } from 'lucide-react';
import PoolSettingsPanel from '../settings/PoolSettingsPanel';
import { t } from '../../lib/i18n';

interface AutomationConfig {
  autoReplenishEnabled: boolean;
  minActiveAccounts: number;
  kiroRegStrategy: string;
  windsurfRegStrategy: string;
  traeRegStrategy: string;

  // Legacy fields (kept for compatibility if needed, or remove if fully replaced)
  autoRegisterEnabled: boolean;
  registerIntervalMinutes: number;
  minAccountsThreshold: number;
  autoSwitchEnabled: boolean;
  switchOnZeroCredits: boolean;
  checkCreditsIntervalSeconds: number;
}

const DEFAULT_CONFIG: AutomationConfig = {
  autoReplenishEnabled: false,
  minActiveAccounts: 2,
  kiroRegStrategy: '33mail',
  windsurfRegStrategy: 'custom-domain',
  traeRegStrategy: 'standard',

  autoRegisterEnabled: false,
  registerIntervalMinutes: 5,
  minAccountsThreshold: 2,
  autoSwitchEnabled: false,
  switchOnZeroCredits: true,
  checkCreditsIntervalSeconds: 60,
};

export function AutomationTab({ disabled }: { disabled?: boolean }) {
  const [config, setConfig] = useState<AutomationConfig>(DEFAULT_CONFIG);
  const [isLoading, setIsLoading] = useState(true);
  const { addLog } = useRegistrationStore();

  const loadSettings = useCallback(async () => {
    try {
      const settings = await getSettings();
      setConfig({
        // New settings
        autoReplenishEnabled: settings.autoReplenishEnabled === true,
        minActiveAccounts: settings.minActiveAccounts || 2,
        kiroRegStrategy: settings.kiroRegStrategy || '33mail',
        windsurfRegStrategy: settings.windsurfRegStrategy || 'custom-domain',
        traeRegStrategy: settings.traeRegStrategy || 'standard',

        // Legacy settings
        autoRegisterEnabled: settings.bg_auto_register_enabled === 'true',
        registerIntervalMinutes: parseInt(settings.bg_register_interval_minutes || '5', 10),
        minAccountsThreshold: parseInt(settings.bg_min_accounts_threshold || '2', 10),
        autoSwitchEnabled: settings.bg_auto_switch_enabled === 'true',
        switchOnZeroCredits: settings.bg_switch_on_zero_credits === 'true',
        checkCreditsIntervalSeconds: parseInt(
          settings.bg_check_credits_interval_seconds || '60',
          10
        ),
      });
    } catch (error) {
      console.error('Failed to load automation settings:', error);
      addLog({ level: 'error', message: `Failed to load automation settings: ${error}` });
    } finally {
      setIsLoading(false);
    }
  }, [addLog]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleUpdate = async (updates: Partial<AutomationConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);

    try {
      await updateSettings({
        // New settings
        autoReplenishEnabled: newConfig.autoReplenishEnabled,
        minActiveAccounts: newConfig.minActiveAccounts,
        kiroRegStrategy: newConfig.kiroRegStrategy,
        windsurfRegStrategy: newConfig.windsurfRegStrategy,
        traeRegStrategy: newConfig.traeRegStrategy,

        // Legacy settings mappings
        bg_auto_register_enabled: String(newConfig.autoRegisterEnabled),
        bg_register_interval_minutes: String(newConfig.registerIntervalMinutes),
        bg_min_accounts_threshold: String(newConfig.minAccountsThreshold),
        bg_auto_switch_enabled: String(newConfig.autoSwitchEnabled),
        bg_switch_on_zero_credits: String(newConfig.switchOnZeroCredits),
        bg_check_credits_interval_seconds: String(newConfig.checkCreditsIntervalSeconds),
      });
      addLog({ level: 'info', message: 'Automation settings updated' });
    } catch (error) {
      console.error('Failed to save automation settings:', error);
      addLog({ level: 'error', message: `Failed to save settings: ${error}` });
    }
  };

  const strategyOptions = [
    { value: '33mail', label: '33mail' },
    { value: 'custom-domain', label: 'Custom Domain' },
    { value: 'gmail', label: 'Gmail' },
    { value: 'standard', label: 'Standard' },
  ];

  const getAnimationStyle = (index: number) => ({
    animationDelay: `${index * 100}ms`,
  });

  if (isLoading) {
    return <div className="p-4 text-center text-slate-500">{t('common.loading')}</div>;
  }

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-8">
      {/* 1. Health & Replenishment (Input) */}
      <section>
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-emerald-400" />
            {t('automation.healthReplenishment')}
          </h3>
          <p className="text-slate-400 text-sm max-w-2xl">
            {t('automation.healthReplenishmentDesc')}
          </p>
        </div>

        <GlassCard className="p-6 space-y-6 rounded-xl border border-white/10" glow="none">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div
                className={`p-3 rounded-xl transition-colors ${config.autoReplenishEnabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-slate-400'}`}
              >
                <Repeat className="w-6 h-6" />
              </div>
              <div>
                <div className="text-base font-medium text-slate-200">
                  {t('automation.enableReplenishment')}
                </div>
                <div className="text-sm text-slate-500">
                  {t('automation.enableReplenishmentDesc')}
                </div>
              </div>
            </div>
            <Toggle
              label={
                config.autoReplenishEnabled ? t('settings.general.on') : t('settings.general.off')
              }
              checked={config.autoReplenishEnabled}
              onChange={(val: boolean) => handleUpdate({ autoReplenishEnabled: val })}
              disabled={disabled}
            />
          </div>

          {config.autoReplenishEnabled && (
            <div className="pt-6 border-t border-white/5 animate-in slide-in-from-top-2 fade-in duration-300">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <NumberInput
                  label={t('automation.minActiveAccounts')}
                  value={config.minActiveAccounts}
                  onChange={(val: number) => handleUpdate({ minActiveAccounts: val })}
                  min={1}
                  max={10}
                  unit="acc"
                  disabled={disabled}
                  tooltip={t('automation.minActiveAccountsTooltip')}
                />
              </div>
            </div>
          )}
        </GlassCard>
      </section>

      {/* 2. Registration Strategies */}
      <section>
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-400" />
            {t('automation.registrationStrategies')}
          </h3>
          <p className="text-slate-400 text-sm max-w-2xl">
            {t('automation.registrationStrategiesDesc')}
          </p>
        </div>

        <GlassCard className="p-6 rounded-xl border border-white/10" glow="none">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Select
              label={t('automation.kiroStrategy')}
              value={config.kiroRegStrategy}
              onChange={e => handleUpdate({ kiroRegStrategy: e.target.value })}
              options={strategyOptions}
              disabled={disabled}
            />

            <Select
              label={t('automation.windsurfStrategy')}
              value={config.windsurfRegStrategy}
              onChange={e => handleUpdate({ windsurfRegStrategy: e.target.value })}
              options={strategyOptions}
              disabled={disabled}
            />

            <Select
              label={t('automation.traeStrategy')}
              value={config.traeRegStrategy}
              onChange={e => handleUpdate({ traeRegStrategy: e.target.value })}
              options={strategyOptions}
              disabled={disabled}
            />
          </div>
        </GlassCard>
      </section>

      {/* 3. Rotation Rules (Output - formerly Token Pool) */}
      <section>
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
            <RefreshCw className="w-5 h-5 text-amber-400" />
            {t('automation.rotationRules')}
          </h3>
          <p className="text-slate-400 text-sm max-w-2xl">{t('automation.rotationRulesDesc')}</p>
        </div>

        {/* Embedded PoolSettingsPanel */}
        <PoolSettingsPanel getAnimationStyle={getAnimationStyle} />
      </section>

      {/* 4. Legacy / Advanced */}
      <section className="opacity-60 hover:opacity-100 transition-opacity">
        <div className="mb-4 flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-slate-500" />
          <h4 className="text-sm font-medium text-slate-500">{t('automation.legacySettings')}</h4>
        </div>

        <GlassCard className="p-4 rounded-lg border border-white/5 bg-black/20" glow="none">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-sm font-medium text-slate-400">
                {t('automation.legacyAutoSwitching')}
              </div>
            </div>
            <Toggle
              label={
                config.autoSwitchEnabled ? t('settings.general.on') : t('settings.general.off')
              }
              checked={config.autoSwitchEnabled}
              onChange={(val: boolean) => handleUpdate({ autoSwitchEnabled: val })}
              disabled={disabled}
            />
          </div>

          {config.autoSwitchEnabled && (
            <div className="mt-4 pt-4 border-t border-white/5">
              <NumberInput
                label={t('automation.checkInterval')}
                value={config.checkCreditsIntervalSeconds}
                onChange={(val: number) => handleUpdate({ checkCreditsIntervalSeconds: val })}
                min={10}
                max={3600}
                unit="s"
                disabled={disabled}
              />
            </div>
          )}
        </GlassCard>
      </section>
    </div>
  );
}
