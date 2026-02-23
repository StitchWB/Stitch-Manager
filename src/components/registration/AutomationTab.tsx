import { useState, useEffect, useCallback, useMemo } from 'react';
import { GlassCard } from '../ui/GlassCard';
import { Toggle } from '../ui/Toggle';
import { NumberInput } from '../ui/NumberInput';
import { getSettings, updateSettings, getRegistrationStatus } from '@/lib/tauri';
import { useRegistrationStore } from '../../stores/registration';
import { useAccountsStore } from '../../stores/accounts';
import { Select } from '../ui/Select';
import {
  RefreshCw,
  Shield,
  Activity,
  Cpu,
  PlayCircle,
  Gauge,
  Zap,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import { t } from '../../lib/i18n';
import { RegistrationStatus } from '../../types/generated';
import { cn } from '../../lib/utils';
import { useTokenPoolStore } from '../../stores/tokenPool';
import { StatusBadge } from '../ui/StatusBadge';
import { ModuleCard, ModuleStatus } from '../ui/ModuleCard';
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
  const [regConfig, setRegConfig] = useState<AutomationConfig>(DEFAULT_CONFIG);
  const [isLoading, setIsLoading] = useState(true);
  const { addLog } = useRegistrationStore();
  const { status: poolStatus, updateConfig: updatePoolConfig, fetchStatus } = useTokenPoolStore();
  const poolConfig = poolStatus?.config;
  const { accounts, fetchAccounts } = useAccountsStore();
  const [localPoolConfig, setLocalPoolConfig] = useState<PoolConfig>(DEFAULT_POOL_CONFIG);
  const [replenishmentStatus, setReplenishmentStatus] = useState<RegistrationStatus | null>(null);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

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

  useEffect(() => {
    let intervalId: any;
    const checkStatus = async () => {
      try {
        const status = (await getRegistrationStatus()) as any;
        setReplenishmentStatus(status);
        if (!status.isRunning && replenishmentStatus?.isRunning) fetchAccounts();
      } catch (err) {
        console.error(err);
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
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
    fetchStatus();
  }, [loadSettings, fetchStatus]);
  useEffect(() => {
    if (poolConfig) setLocalPoolConfig({ ...poolConfig, switchStrategy: 'custom' });
  }, [poolConfig]);

  const handleRegUpdate = async (updates: Partial<AutomationConfig>) => {
    const newConfig = { ...regConfig, ...updates };
    setRegConfig(newConfig);
    try {
      await updateSettings(newConfig as any);
      addLog({ level: 'info', message: 'Automation settings updated' });
    } catch (error) {
      console.error(error);
    }
  };

  const handlePoolUpdate = async (updates: Partial<PoolConfig>) => {
    const forcedUpdates = { ...updates, switchStrategy: 'custom' as const };
    setLocalPoolConfig(prev => ({ ...prev, ...forcedUpdates }));
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
    return provider < target ? 'warning' : 'idle';
  };

  if (isLoading)
    return (
      <div className="p-4 text-center text-slate-300 font-mono text-xs animate-pulse">
        {t('common.loading')}
      </div>
    );

  return (
    <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500 pt-1 pb-4">
      {/* 1. HEADER CONTROL */}
      <GlassCard
        className={cn(
          'p-4 flex items-center justify-between gap-4 border-white/10 relative overflow-hidden transition-all duration-500',
          regConfig.autoReplenishEnabled && 'border-emerald-500/30 bg-emerald-500/5'
        )}
      >
        <div className="flex items-center gap-4 z-10">
          <div
            className={cn(
              'p-2.5 rounded-xl border bg-white/5 border-white/10 text-slate-400 shadow-lg transition-colors',
              regConfig.autoReplenishEnabled &&
                'bg-emerald-500/20 border-emerald-500/40 text-emerald-400 shadow-emerald-500/20'
            )}
          >
            <Activity className="w-5 h-5" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2.5">
              <h3 className="text-base font-bold text-white tracking-tight leading-none">
                Автоматизация
              </h3>
              <StatusBadge
                status={regConfig.autoReplenishEnabled ? 'active' : 'inactive'}
                size="sm"
                withDot
              />
            </div>
            <div className="flex items-center gap-2.5 mt-1.5">
              <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest leading-none">
                Status:
              </span>
              <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-black/30 border border-white/5 font-mono">
                <span
                  className={cn(
                    'text-xs font-bold tabular-nums',
                    totalActive < totalTarget ? 'text-amber-400' : 'text-emerald-400'
                  )}
                >
                  {totalActive}
                </span>
                <ArrowRight className="w-2.5 h-2.5 text-slate-700" />
                <span className="text-xs font-bold text-white/20">{totalTarget}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {replenishmentStatus?.isRunning && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-[10px] text-white/80 animate-pulse font-bold">
              <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
              <span className="uppercase truncate max-w-[80px]">
                {replenishmentStatus.provider}
              </span>
            </div>
          )}
          <Toggle
            label=""
            checked={regConfig.autoReplenishEnabled}
            onChange={val => handleRegUpdate({ autoReplenishEnabled: val })}
            disabled={disabled}
            className="scale-110"
          />
        </div>
      </GlassCard>

      {/* 2. REPLENISHMENT */}
      <div className="space-y-3">
        <SectionHeader
          title={t('automation.replenishment')}
          className="px-1"
          children={<></>}
          icon={<RefreshCw className="w-4 h-4 text-cyan-400" />}
        />
        <div className="flex flex-col gap-2">
          {[
            {
              id: 'kiro',
              icon: <Shield className="w-4 h-4" />,
              label: 'Kiro',
              value: regConfig.kiroRegStrategy,
              update: 'kiroRegStrategy',
              minActive: regConfig.minActiveKiro,
              updateMin: 'minActiveKiro',
              current: activeCounts.kiro,
            },
            {
              id: 'windsurf',
              icon: <PlayCircle className="w-4 h-4" />,
              label: 'Windsurf',
              value: regConfig.windsurfRegStrategy,
              update: 'windsurfRegStrategy',
              minActive: regConfig.minActiveWindsurf,
              updateMin: 'minActiveWindsurf',
              current: activeCounts.windsurf,
            },
            {
              id: 'trae',
              icon: <Cpu className="w-4 h-4" />,
              label: 'Trae',
              value: regConfig.traeRegStrategy,
              update: 'traeRegStrategy',
              minActive: regConfig.minActiveTrae,
              updateMin: 'minActiveTrae',
              current: activeCounts.trae,
            },
          ].map(p => (
            <ModuleCard
              key={p.id}
              id={p.id}
              title={p.label}
              icon={p.icon}
              status={getProviderStatus(p.id)}
              isExpanded={expandedProvider === p.id}
              onToggle={() => setExpandedProvider(expandedProvider === p.id ? null : p.id)}
              summary={`${p.current} / ${p.minActive} Active`}
              disabled={disabled}
            >
              <div className="flex flex-col gap-3 p-1">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">
                    Strategy
                  </span>
                  <div className="w-[140px]">
                    <Select
                      value={p.value}
                      onChange={e => handleRegUpdate({ [p.update]: e.target.value })}
                      options={strategyOptions}
                      disabled={disabled}
                      className="h-9 text-xs font-bold bg-white/5 border-white/10"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">
                    Min Spare
                  </span>
                  <div className="w-[140px]">
                    <NumberInput
                      label=""
                      value={p.minActive}
                      onChange={val => handleRegUpdate({ [p.updateMin]: val })}
                      min={1}
                      max={20}
                      unit="acc"
                      className="w-full"
                    />
                  </div>
                </div>
              </div>
            </ModuleCard>
          ))}
        </div>
      </div>

      {/* 3. ROTATION RULES */}
      <div className="space-y-3">
        <SectionHeader
          title={t('automation.rotationRules')}
          className="px-1"
          children={<></>}
          icon={<Gauge className="w-4 h-4 text-indigo-400" />}
        />
        <GlassCard className="p-4 border-white/10 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
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
          <div className="h-px bg-white/5" />
          <div className="flex items-center justify-between bg-white/[0.03] p-4 rounded-xl border border-white/10 transition-colors hover:bg-white/[0.05]">
            <div className="flex items-center gap-4">
              <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Zap className="w-4 h-4" />
              </div>
              <div className="flex flex-col">
                <span className="text-[11px] font-bold text-slate-200 uppercase tracking-widest">
                  Триггер 429
                </span>
                <span className="text-[10px] text-slate-500 mt-1 truncate max-w-[140px]">
                  Auto-switch on rate limit
                </span>
              </div>
            </div>
            <Toggle
              label=""
              checked={localPoolConfig.switchOnRateLimit}
              onChange={val => handlePoolUpdate({ switchOnRateLimit: val })}
              className="scale-100 shrink-0"
            />
          </div>
        </GlassCard>
      </div>

      {/* 4. TELEMETRY STRIP */}
      <div className="mt-2 py-3 border-t border-white/5 flex items-center justify-between px-1">
        <div className="flex items-center gap-6 font-mono text-[10px] font-bold tracking-tight text-slate-500 uppercase">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.4)]" />
            LATENCY: <span className="text-indigo-300">0.02ms</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
            API: <span className="text-emerald-300">v3.0.4</span>
          </div>
        </div>
        <div className="flex items-center gap-2 px-2 py-1 bg-white/[0.02] border border-white/5 rounded-md text-[9px] font-black text-slate-400 tracking-tighter uppercase">
          <div className="w-1 h-1 rounded-full bg-slate-600" />
          IDLE
        </div>
      </div>
    </div>
  );
}
