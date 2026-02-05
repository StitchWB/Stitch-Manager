import { useState, useEffect, useCallback, useMemo } from 'react';
import { GlassCard } from '../ui/GlassCard';
import { Toggle } from '../ui/Toggle';
import { NumberInput } from '../ui/NumberInput';
import { getSettings, updateSettings, getRegistrationStatus } from '../../lib/tauri';
import { useRegistrationStore } from '../../stores/registration';
import { useAccountsStore } from '../../stores/accounts';
import { Select } from '../ui/Select';
import {
  RefreshCw,
  Settings2,
  Shield,
  Activity,
  Cpu,
  PlayCircle,
  Gauge,
  Zap,
  Loader2,
  ArrowRight,
  Target,
} from 'lucide-react';
import { t } from '../../lib/i18n';
import { SettingsData, RegistrationStatus } from '../../types/generated';
import { cn } from '../../lib/utils';
import { useTokenPoolStore } from '../../stores/tokenPool';
import { StatusBadge } from '../ui/StatusBadge';
import { ModuleCard, ModuleStatus } from '../ui/ModuleCard';
import { StatCard } from '../ui/StatCard';
import { SectionHeader } from '../ui/SectionHeader';
import type { PoolConfig } from '../../types';

interface AutomationConfig {
  autoReplenishEnabled: boolean;
  minActiveAccounts: number;
  minActiveKiro: number;
  minActiveWindsurf: number;
  minActiveTrae: number;
  kiroRegStrategy: string;
  windsurfRegStrategy: string;
  traeRegStrategy: string;

  // Legacy fields
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
  minActiveKiro: 2,
  minActiveWindsurf: 2,
  minActiveTrae: 2,
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

const DEFAULT_POOL_CONFIG: PoolConfig = {
  switchStrategy: 'custom',
  customThreshold: 10,
  aggressiveThreshold: 4,
  balancedThreshold: 8,
  conservativeThreshold: 15,
  switchOnError: true,
  switchOnRateLimit: true,
  maxErrorsBeforeBan: 5,
  cooldownMinutes: 5,
  autoRefreshEnabled: true,
  refreshBeforeExpiry: 10,
};

export function AutomationTab({ disabled }: { disabled?: boolean }) {
  // Store 1: Registration/Replenishment Settings (Tauri)
  const [regConfig, setRegConfig] = useState<AutomationConfig>(DEFAULT_CONFIG);
  const [isLoading, setIsLoading] = useState(true);
  const { addLog } = useRegistrationStore();

  // Store 2: Pool Rotation Settings (Zustand)
  const { status: poolStatus, updateConfig: updatePoolConfig, fetchStatus } = useTokenPoolStore();
  const poolConfig = poolStatus?.config;

  // Store 3: Accounts for detailed counts (Zustand)
  const { accounts, fetchAccounts } = useAccountsStore();

  // Local state for pool config form
  const [localPoolConfig, setLocalPoolConfig] = useState<PoolConfig>(DEFAULT_POOL_CONFIG);

  // Dynamic status from backend
  const [replenishmentStatus, setReplenishmentStatus] = useState<RegistrationStatus | null>(null);

  // UI State
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  // Compute active accounts per provider locally
  const activeCounts = useMemo(
    () => ({
      kiro: accounts.filter(
        a => (a.provider === 'kiro' || a.provider === 'aws_builder_id') && a.status === 'active'
      ).length,
      windsurf: accounts.filter(a => a.provider === 'windsurf' && a.status === 'active').length,
      trae: accounts.filter(a => a.provider === 'trae' && a.status === 'active').length,
    }),
    [accounts]
  );

  const totalActive = activeCounts.kiro + activeCounts.windsurf + activeCounts.trae;
  const totalTarget =
    regConfig.minActiveKiro + regConfig.minActiveWindsurf + regConfig.minActiveTrae;

  // Polling for registration status
  useEffect(() => {
    let intervalId: any;

    const checkStatus = async () => {
      try {
        const status = (await getRegistrationStatus()) as any;
        setReplenishmentStatus(status);

        // If registration just finished, refresh accounts list
        if (!status.isRunning && replenishmentStatus?.isRunning) {
          fetchAccounts();
        }
      } catch (err) {
        console.error('Failed to get replenishment status:', err);
      }
    };

    if (regConfig.autoReplenishEnabled) {
      checkStatus();
      intervalId = setInterval(checkStatus, 3000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [regConfig.autoReplenishEnabled, replenishmentStatus?.isRunning, fetchAccounts]);

  // Load Registration Settings
  const loadSettings = useCallback(async () => {
    try {
      const settings = await getSettings();
      setRegConfig({
        autoReplenishEnabled: settings.autoReplenishEnabled === true,
        minActiveAccounts: (settings as any).minActiveAccounts || 2,
        minActiveKiro: settings.minActiveKiro || 2,
        minActiveWindsurf: settings.minActiveWindsurf || 2,
        minActiveTrae: settings.minActiveTrae || 2,
        kiroRegStrategy: settings.kiroRegStrategy || '33mail',
        windsurfRegStrategy: settings.windsurfRegStrategy || 'custom-domain',
        traeRegStrategy: settings.traeRegStrategy || 'standard',
        autoRegisterEnabled: false,
        registerIntervalMinutes: 5,
        minAccountsThreshold: 2,
        autoSwitchEnabled: false,
        switchOnZeroCredits: true,
        checkCreditsIntervalSeconds: (settings as any).checkCreditsIntervalSeconds || 60,
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
    fetchStatus().catch(err => console.error('Failed to fetch pool status:', err));
  }, [loadSettings, fetchStatus]);

  // Sync Pool Config from store
  useEffect(() => {
    if (poolConfig) {
      setLocalPoolConfig({ ...poolConfig, switchStrategy: 'custom' });
    }
  }, [poolConfig]);

  // Handlers for Registration Settings
  const handleRegUpdate = async (updates: Partial<AutomationConfig>) => {
    const newConfig = { ...regConfig, ...updates };
    setRegConfig(newConfig);

    try {
      const settingsUpdate: Partial<SettingsData> & Record<string, any> = {
        autoReplenishEnabled: newConfig.autoReplenishEnabled,
        minActiveAccounts: newConfig.minActiveAccounts,
        minActiveKiro: newConfig.minActiveKiro,
        minActiveWindsurf: newConfig.minActiveWindsurf,
        minActiveTrae: newConfig.minActiveTrae,
        kiroRegStrategy: newConfig.kiroRegStrategy,
        windsurfRegStrategy: newConfig.windsurfRegStrategy,
        traeRegStrategy: newConfig.traeRegStrategy,
        checkCreditsIntervalSeconds: newConfig.checkCreditsIntervalSeconds,
      };

      await updateSettings(settingsUpdate);
      addLog({ level: 'info', message: 'Automation settings updated' });
    } catch (error) {
      console.error('Failed to save automation settings:', error);
      addLog({ level: 'error', message: `Failed to save settings: ${error}` });
    }
  };

  // Handlers for Pool Config
  const handlePoolUpdate = async (updates: Partial<PoolConfig>) => {
    const forcedUpdates = { ...updates, switchStrategy: 'custom' as const };
    const newConfig = { ...localPoolConfig, ...forcedUpdates };
    setLocalPoolConfig(newConfig);
    await updatePoolConfig(forcedUpdates);
  };

  const strategyOptions = [
    { value: '33mail', label: '33mail' },
    { value: 'custom-domain', label: 'Custom Domain' },
    { value: 'gmail', label: 'Gmail' },
    { value: 'standard', label: 'Standard' },
  ];

  const getProviderStatus = (id: string): ModuleStatus => {
    const isRunning =
      replenishmentStatus?.isRunning && replenishmentStatus.provider?.toLowerCase() === id;
    if (isRunning) return 'ready';

    const provider =
      id === 'kiro'
        ? activeCounts.kiro
        : id === 'windsurf'
          ? activeCounts.windsurf
          : activeCounts.trae;
    const target =
      id === 'kiro'
        ? regConfig.minActiveKiro
        : id === 'windsurf'
          ? regConfig.minActiveWindsurf
          : regConfig.minActiveTrae;

    if (provider < target) return 'warning';
    return 'idle';
  };

  if (isLoading) {
    return (
      <div className="p-4 text-center text-slate-300 font-mono text-xs animate-pulse">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-12">
      {/* 1. OVERVIEW & CONTROL */}
      <div className="grid grid-cols-12 gap-6">
        <GlassCard
          className={cn(
            'col-span-12 p-6 flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden transition-all duration-500',
            regConfig.autoReplenishEnabled
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-white/10'
          )}
          glow={regConfig.autoReplenishEnabled ? 'blue' : 'none'}
        >
          <div
            className={cn(
              'absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-emerald-500/10 to-transparent transition-opacity duration-500 pointer-events-none',
              regConfig.autoReplenishEnabled ? 'opacity-100' : 'opacity-0'
            )}
          />

          <div className="flex items-center gap-5 z-10">
            <div
              className={cn(
                'p-4 rounded-2xl border transition-all duration-300 shadow-lg',
                regConfig.autoReplenishEnabled
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400 shadow-emerald-500/20'
                  : 'bg-white/5 border-white/10 text-slate-400'
              )}
            >
              <Activity className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-bold text-white tracking-tight">
                  {t('automation.title')}
                </h3>
                <StatusBadge
                  status={regConfig.autoReplenishEnabled ? 'active' : 'inactive'}
                  size="sm"
                  withDot
                />
              </div>
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
                    Total Status:
                  </span>
                  <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
                    <span
                      className={cn(
                        'text-sm font-mono font-bold tabular-nums',
                        totalActive < totalTarget ? 'text-amber-400' : 'text-emerald-400'
                      )}
                    >
                      {totalActive}
                    </span>
                    <ArrowRight className="w-3 h-3 text-slate-600" />
                    <span className="text-sm font-mono font-bold text-white/40 tabular-nums">
                      {totalTarget}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row items-center gap-6 z-10">
            {/* Live Engine Status Badge */}
            {replenishmentStatus?.isRunning && (
              <div className="flex items-center gap-3 px-4 py-2.5 bg-indigo-500/10 border border-indigo-500/30 rounded-xl animate-pulse">
                <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-[0.1em] leading-none">
                    Engine Active
                  </span>
                  <span className="text-[11px] text-white/70 truncate max-w-[180px] mt-1 font-medium">
                    {replenishmentStatus.step}: {replenishmentStatus.provider}
                  </span>
                </div>
              </div>
            )}

            <div className="h-10 w-px bg-white/10 hidden md:block" />

            <Toggle
              label={t('status.active')}
              checked={regConfig.autoReplenishEnabled}
              onChange={val => handleRegUpdate({ autoReplenishEnabled: val })}
              disabled={disabled}
              className="scale-110"
            />
          </div>
        </GlassCard>

        <div className="col-span-12 grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard
            icon={<Shield className="w-4 h-4" />}
            label="Kiro Active"
            value={activeCounts.kiro}
            className={
              activeCounts.kiro < regConfig.minActiveKiro
                ? 'border-amber-500/30 bg-amber-500/5'
                : ''
            }
          />
          <StatCard
            icon={<PlayCircle className="w-4 h-4" />}
            label="Windsurf Active"
            value={activeCounts.windsurf}
            className={
              activeCounts.windsurf < regConfig.minActiveWindsurf
                ? 'border-amber-500/30 bg-amber-500/5'
                : ''
            }
          />
          <StatCard
            icon={<Cpu className="w-4 h-4" />}
            label="Trae Active"
            value={activeCounts.trae}
            className={
              activeCounts.trae < regConfig.minActiveTrae
                ? 'border-amber-500/30 bg-amber-500/5'
                : ''
            }
          />
          <StatCard
            icon={<Target className="w-4 h-4" />}
            label="Total Target"
            value={totalTarget}
            gradient="from-indigo-500/10 to-purple-500/10"
          />
        </div>
      </div>

      <div className="grid grid-cols-12 gap-8">
        {/* 2. REPLENISHMENT CONFIG (Left Column) */}
        <div className="col-span-12 lg:col-span-7 space-y-6">
          <SectionHeader
            title={t('automation.replenishment')}
            description={t('automation.registrationStrategiesDesc')}
            icon={<RefreshCw className="w-4 h-4 text-cyan-400" />}
          >
            <div className="space-y-4">
              {[
                {
                  id: 'kiro',
                  icon: <Shield className="w-4 h-4" />,
                  color: 'text-indigo-400',
                  label: 'Kiro',
                  value: regConfig.kiroRegStrategy,
                  update: 'kiroRegStrategy',
                  minActive: regConfig.minActiveKiro,
                  updateMin: 'minActiveKiro',
                  currentActive: activeCounts.kiro,
                },
                {
                  id: 'windsurf',
                  icon: <PlayCircle className="w-4 h-4" />,
                  color: 'text-cyan-400',
                  label: 'Windsurf',
                  value: regConfig.windsurfRegStrategy,
                  update: 'windsurfRegStrategy',
                  minActive: regConfig.minActiveWindsurf,
                  updateMin: 'minActiveWindsurf',
                  currentActive: activeCounts.windsurf,
                },
                {
                  id: 'trae',
                  icon: <Cpu className="w-4 h-4" />,
                  color: 'text-amber-400',
                  label: 'Trae',
                  value: regConfig.traeRegStrategy,
                  update: 'traeRegStrategy',
                  minActive: regConfig.minActiveTrae,
                  updateMin: 'minActiveTrae',
                  currentActive: activeCounts.trae,
                },
              ].map(provider => (
                <ModuleCard
                  key={provider.id}
                  id={provider.id}
                  title={provider.label}
                  icon={provider.icon}
                  status={getProviderStatus(provider.id)}
                  isExpanded={expandedProvider === provider.id}
                  onToggle={() =>
                    setExpandedProvider(expandedProvider === provider.id ? null : provider.id)
                  }
                  summary={`${provider.currentActive} / ${provider.minActive} Active • Strategy: ${provider.value}`}
                  disabled={disabled}
                >
                  <div className="grid grid-cols-2 gap-4 p-1">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">
                        Registration Strategy
                      </label>
                      <Select
                        value={provider.value}
                        onChange={e => handleRegUpdate({ [provider.update]: e.target.value })}
                        options={strategyOptions}
                        disabled={disabled}
                        className="h-9 text-xs font-bold w-full bg-white/5 border-white/10"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">
                        Min Spare Accounts
                      </label>
                      <NumberInput
                        label=""
                        value={provider.minActive}
                        onChange={val => handleRegUpdate({ [provider.updateMin]: val })}
                        min={1}
                        max={20}
                        unit="acc"
                        className="w-full"
                      />
                    </div>
                  </div>
                </ModuleCard>
              ))}
            </div>
          </SectionHeader>
        </div>

        {/* 3. ROTATION LOGIC (Right Column) */}
        <div className="col-span-12 lg:col-span-5 space-y-6">
          <SectionHeader
            title={t('automation.rotationRules')}
            description={t('automation.rotationRulesDesc')}
            icon={<Gauge className="w-4 h-4 text-indigo-400" />}
          >
            <GlassCard className="p-6 border-white/10 space-y-6">
              <div className="grid grid-cols-1 gap-5">
                <NumberInput
                  label={t('automation.switchThreshold')}
                  value={localPoolConfig.customThreshold}
                  onChange={val => handlePoolUpdate({ customThreshold: val })}
                  min={1}
                  max={500}
                  unit="req"
                />
                <NumberInput
                  label={t('automation.checkInterval')}
                  value={regConfig.checkCreditsIntervalSeconds}
                  onChange={val => handleRegUpdate({ checkCreditsIntervalSeconds: val })}
                  min={10}
                  max={3600}
                  step={10}
                  unit="sec"
                />

                <div className="grid grid-cols-2 gap-4">
                  <NumberInput
                    label={t('automation.maxErrors')}
                    value={localPoolConfig.maxErrorsBeforeBan}
                    onChange={val => handlePoolUpdate({ maxErrorsBeforeBan: val })}
                    min={1}
                    max={50}
                    unit="err"
                  />
                  <NumberInput
                    label={t('automation.cooldown')}
                    value={localPoolConfig.cooldownMinutes}
                    onChange={val => handlePoolUpdate({ cooldownMinutes: val })}
                    min={0}
                    max={120}
                    unit="min"
                  />
                </div>

                <div className="h-px bg-white/5 my-2" />

                <div className="flex items-center justify-between bg-white/[0.03] p-4 rounded-xl border border-white/10 transition-colors hover:bg-white/[0.05]">
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      <Zap className="w-4 h-4" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[11px] font-bold text-slate-200 uppercase tracking-wider">
                        {t('automation.rateLimitTrigger')}
                      </span>
                      <span className="text-[10px] text-slate-500 mt-0.5">
                        {t('automation.rateLimitTriggerDesc')}
                      </span>
                    </div>
                  </div>
                  <Toggle
                    label=""
                    checked={localPoolConfig.switchOnRateLimit}
                    onChange={val => handlePoolUpdate({ switchOnRateLimit: val })}
                    className="scale-90"
                  />
                </div>
              </div>
            </GlassCard>
          </SectionHeader>
        </div>
      </div>

      {/* 4. TELEMETRY STRIP (Bottom) */}
      <div className="pt-8">
        <div className="flex items-center gap-4 opacity-50 hover:opacity-100 transition-all duration-500">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          <div className="flex items-center gap-8 font-mono text-[9px] font-bold tracking-[0.2em] text-slate-400">
            <div className="flex items-center gap-2.5">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]" />
              LATENCY: <span className="text-indigo-300">0.024ms</span>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
              API: <span className="text-emerald-300">v3.0.4</span>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]" />
              LAST_EVENT:{' '}
              <span className="text-amber-300">
                {replenishmentStatus?.isRunning
                  ? `REGISTERING ${replenishmentStatus.provider?.toUpperCase()}...`
                  : 'READY'}
              </span>
            </div>
          </div>
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        </div>
      </div>

      {/* LEGACY / DEPRECATED (Bottom, Low Opacity) */}
      <section className="opacity-20 hover:opacity-50 transition-all duration-300 pt-8 border-t border-white/5">
        <div className="flex items-center justify-between p-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.01]">
          <div className="flex items-center gap-4">
            <div className="p-2 rounded-lg bg-slate-500/10 text-slate-500">
              <Settings2 className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                {t('automation.legacyAutoSwitching')} ({t('common.none')})
              </div>
              <span className="text-[9px] text-slate-600 mt-0.5 uppercase tracking-tighter">
                DEPRECATED MODULE
              </span>
            </div>
          </div>
          <Toggle
            label=""
            checked={regConfig.autoSwitchEnabled}
            onChange={val => handleRegUpdate({ autoSwitchEnabled: val })}
            disabled={disabled}
            className="opacity-50"
          />
        </div>
      </section>
    </div>
  );
}
