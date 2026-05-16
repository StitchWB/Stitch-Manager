import { useState, useEffect, useCallback, useMemo } from 'react';
import { getSettings, updateSettings, getRegistrationStatus } from '@/lib/tauri';
import { useRegistrationStore } from '../../../stores/registration';
import { useAccountsStore } from '../../../stores/accounts';
import {
  getAiProxyAccounts,
  getProxySettings,
  updateProxySettings,
} from '../../../lib/tauri/modules/aiProxy';
import { RegistrationStatus, ProxySettings, AiProxyAccount, SettingsData } from '../../../types/generated';

export interface AutomationConfig {
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

const DEFAULT_PROXY_SETTINGS: ProxySettings = {
  appMode: 'full',
  proxyPort: 8765,
  autoStart: false,
  routingStrategy: 'round-robin',
  managementKey: '',
};

export const strategyOptions = [
  { value: '33mail', label: '33mail' },
  { value: 'custom-domain', label: 'Свой домен' },
  { value: 'gmail', label: 'Gmail' },
  { value: 'standard', label: 'Стандарт' },
];

export function useAutomationTab() {
  const [regConfig, setRegConfig] = useState<AutomationConfig>(DEFAULT_CONFIG);
  const [isLoading, setIsLoading] = useState(true);
  const { addLog } = useRegistrationStore();
  const { accounts, fetchAccounts } = useAccountsStore();
  const [proxySettings, setProxySettings] = useState<ProxySettings>(DEFAULT_PROXY_SETTINGS);
  const [proxyAccounts, setProxyAccounts] = useState<AiProxyAccount[]>([]);
  const [replenishmentStatus, setReplenishmentStatus] = useState<RegistrationStatus | null>(null);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [allExpanded, setAllExpanded] = useState(false);

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

  const enabledAiHubAccounts = useMemo(
    () => proxyAccounts.filter(acc => acc.enabled).length,
    [proxyAccounts]
  );

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const checkStatus = async () => {
      try {
        const status = await getRegistrationStatus();
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
        minActiveAccounts: typeof (settings as Record<string, unknown>).minActiveAccounts === 'number'
          ? (settings as Record<string, unknown>).minActiveAccounts as number
          : 2,
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
        checkCreditsIntervalSeconds: typeof (settings as Record<string, unknown>).checkCreditsIntervalSeconds === 'number'
          ? (settings as Record<string, unknown>).checkCreditsIntervalSeconds as number
          : 60,
      });

      try {
        const [proxyCfg, aiAccounts] = await Promise.all([
          getProxySettings(),
          getAiProxyAccounts(),
        ]);
        setProxySettings(proxyCfg);
        setProxyAccounts(aiAccounts);
      } catch (proxyError) {
        console.error('Failed to load AI Hub proxy settings:', proxyError);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleRegUpdate = async (updates: Partial<AutomationConfig>) => {
    const newConfig = { ...regConfig, ...updates };
    setRegConfig(newConfig);
    try {
      await updateSettings(newConfig as Partial<SettingsData>);
      addLog({ level: 'info', message: 'Настройки автоматизации обновлены' });
    } catch (error) {
      console.error(error);
    }
  };

  const handleProxyUpdate = async (updates: Partial<ProxySettings>) => {
    const next = { ...proxySettings, ...updates };
    setProxySettings(next);
    try {
      await updateProxySettings(next);
    } catch (error) {
      console.error(error);
    }
  };

  const getProviderStatus = (id: string) => {
    const isRunning =
      replenishmentStatus?.isRunning && replenishmentStatus.provider?.toLowerCase() === id;
    if (isRunning) return 'ready' as const;
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

  const toggleAll = useCallback(() => {
    setAllExpanded(prev => !prev);
  }, []);

  return {
    regConfig,
    proxySettings,
    proxyAccounts,
    replenishmentStatus,
    isLoading,
    activeCounts,
    totalActive,
    totalTarget,
    enabledAiHubAccounts,
    expandedProvider,
    allExpanded,
    setExpandedProvider,
    setAllExpanded,
    toggleAll,
    handleRegUpdate,
    handleProxyUpdate,
    getProviderStatus,
    loadSettings,
  };
}
