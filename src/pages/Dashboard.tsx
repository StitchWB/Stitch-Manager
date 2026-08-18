import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import Header from '../components/layout/Header';
import { useAppStore } from '../stores/app';
import { useAccountsStore } from '../stores/accounts';
import { useLogsStore } from '../stores/logs';
import { useSettingsStore } from '../stores/settings';
import { useBulkRefresh } from '../hooks/useBulkRefresh';
import { t } from '../lib/i18n';
import {
  StatsGrid,
  QuickActionsPanel,
} from '../components/dashboard';
import { SystemStatusStrip } from '../components/dashboard/SystemStatusStrip';
import { ProviderFleetGrid } from '../components/dashboard/ProviderFleetGrid';
import { UnifiedActivityFeed } from '../components/dashboard/UnifiedActivityFeed';

// ============================================
// Main Dashboard Component
// ============================================
export default function Dashboard() {
  const { providers, selectedProvider, language, addNotification } = useAppStore();
  const accounts = useAccountsStore(state => state.accounts);
  const { addLog } = useLogsStore();
  const settings = useSettingsStore(state => state.settings);
  const navigate = useNavigate();

  const [refreshingProvider, setRefreshingProvider] = useState<string | null>(null);

  // Bulk refresh hook for refreshing all tokens
  const { startBulkRefresh, isRefreshing: isBulkRefreshing } = useBulkRefresh({
    concurrency: 3,
    delayMs: 500,
  });

  // Force re-render when language changes
  void language; // Force re-render on language change

  // Derive fleet target from settings store (no API call needed)
  const fleetTarget = useMemo(() => {
    if (!settings) return 0;
    return (
      (settings.minActiveKiro || 0) +
      (settings.minActiveWindsurf || 0) +
      (settings.minActiveTrae || 0)
    );
  }, [settings]);

  // Derive all stats from accounts already in store (no API call needed)
  const summaryData = useMemo(() => {
    const totalAccounts = accounts.length;
    const accountsByProvider = providers.map(p => ({
      provider: p.id,
      count: accounts.filter(a => a.provider === p.id).length,
      color: p.color,
    }));
    const activeTokens = accounts.filter(a => a.status === 'active').length;

    // Calculate accounts near quota limit (>80%)
    const accountsNearLimit = accounts.filter(a => {
      if (!a.quota || a.quota.limit <= 0) return false;
      const percentUsed = (a.quota.used / a.quota.limit) * 100;
      return percentUsed > 80;
    }).length;

    return {
      totalAccounts,
      accountsByProvider,
      activeTokens,
      accountsNearLimit,
    };
  }, [accounts, providers]);

  const fleetActive = useMemo(() => {
    const isActive = (provider: string) =>
      accounts.filter(a => a.provider === provider && a.status === 'active').length;
    return isActive('kiro') + isActive('aws_builder_id') + isActive('windsurf') + isActive('trae');
  }, [accounts]);

  const handleStartRegistration = () => {
    // Navigate to AutoReg page instead of calling removed startRegistration
    navigate('/autoreg');
  };

  const handleRefreshAllTokens = async () => {
    const allAccountIds = accounts.map(a => a.id);

    if (allAccountIds.length === 0) {
      addNotification({
        type: 'info',
        title: t('common.info'),
        message: t('dashboard.noAccountsToRefresh') || 'No accounts to refresh',
      });
      return;
    }

    addLog({
      level: 'info',
      message: `Starting bulk refresh for ${allAccountIds.length} accounts...`,
      source: 'accounts',
    });

    try {
      await startBulkRefresh(allAccountIds);
      addLog({
        level: 'success',
        message: 'Bulk refresh completed',
        source: 'accounts',
      });
    } catch (error) {
      addLog({
        level: 'error',
        message: `Bulk refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        source: 'accounts',
      });
    }
  };

  const handleRefreshProvider = useCallback(
    async (ids: number[], providerName: string) => {
      if (!ids.length) return;
      setRefreshingProvider(providerName);
      addLog({
        level: 'info',
        message: `Refreshing ${ids.length} ${providerName} accounts...`,
        source: 'accounts',
      });
      try {
        await startBulkRefresh(ids);
        addLog({
          level: 'success',
          message: `Refreshed ${ids.length} ${providerName} accounts`,
          source: 'accounts',
        });
      } catch (error) {
        addLog({
          level: 'error',
          message: `Bulk refresh failed (${providerName}): ${error instanceof Error ? error.message : 'Unknown error'}`,
          source: 'accounts',
        });
      } finally {
        setRefreshingProvider(null);
      }
    },
    [addLog, startBulkRefresh]
  );

  const handleAccountsNearLimitClick = () => {
    navigate('/accounts');
    // Set the low quota filter after navigation
    setTimeout(() => {
      useAccountsStore.getState().setQuotaFilter('low_quota');
    }, 100);
  };

  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
  const currentTime = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('dashboard.title')}
        subtitle={`${currentDate} • ${currentTime}`}
        icon={<LayoutDashboard size={18} />}
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1400px] min-[2000px]:max-w-[1900px] min-[2560px]:max-w-[2200px] mx-auto flex flex-col gap-4">
          {/* System Status Strip */}
          <SystemStatusStrip />

          {/* Stats Grid */}
          <StatsGrid
            isLoading={false}
            totalAccounts={summaryData.totalAccounts}
            activeTokens={summaryData.activeTokens}
            fleetActive={fleetActive}
            fleetTarget={fleetTarget}
            accountsNearLimit={summaryData.accountsNearLimit}
            activeProviderCount={
              providers.filter(p =>
                summaryData.accountsByProvider.find(a => a.provider === p.id && a.count > 0)
              ).length
            }
            onAccountsNearLimitClick={handleAccountsNearLimitClick}
            onFleetClick={() => navigate('/settings?category=automation')}
          />

          {/* Quick Actions */}
          <QuickActionsPanel
            onStartRegistration={handleStartRegistration}
            onRefreshAllTokens={handleRefreshAllTokens}
            isRefreshing={isBulkRefreshing}
            showProviderWarning={!selectedProvider}
          />

          {/* Provider Fleet Cards */}
          <ProviderFleetGrid
            accounts={accounts}
            onRefreshProvider={handleRefreshProvider}
            isRefreshing={isBulkRefreshing}
            refreshingProvider={refreshingProvider}
          />

          {/* Unified Activity Feed */}
          <UnifiedActivityFeed />

          <div className="h-6" />
        </div>
      </div>
    </div>
  );
}
