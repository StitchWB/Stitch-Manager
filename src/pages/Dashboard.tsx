import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import Header from '../components/layout/Header';
import { useAppStore } from '../stores/app';
import { useAccountsStore } from '../stores/accounts';
import { useLogsStore } from '../stores/logs';
import { useBulkRefresh } from '../hooks/useBulkRefresh';
import { getRegistrationJobs, clearRegistrationJobs, getDashboardStats } from '../lib/tauri';
import { t } from '../lib/i18n';
import type { RegistrationJob, DashboardStats } from '../types';
import {
  StatsGrid,
  QuickActionsPanel,
  ActivityFeed,
  ProviderBreakdownChart,
  ProviderSelectionGrid,
} from '../components/dashboard';

function formatActivityTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return t('time.justNow');
  if (diffMins < 60) return t('time.minutesAgo', { count: diffMins });
  if (diffMins < 1440) return t('time.hoursAgo', { count: Math.floor(diffMins / 60) });
  return date.toLocaleDateString();
}

// ============================================
// Main Dashboard Component
// ============================================
export default function Dashboard() {
  const { providers, selectedProvider, setSelectedProvider, addNotification, language } =
    useAppStore();
  const { accounts, fetchAccounts } = useAccountsStore();
  const { addLog } = useLogsStore();
  const navigate = useNavigate();

  const [registrationJobs, setRegistrationJobs] = useState<RegistrationJob[]>([]);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  // Bulk refresh hook for refreshing all tokens
  const { startBulkRefresh, isRefreshing: isBulkRefreshing } = useBulkRefresh({
    concurrency: 3,
    delayMs: 500,
  });

  // Force re-render when language changes
  void language; // Force re-render on language change

  const loadRegistrationJobs = useCallback(async () => {
    try {
      const jobs = await getRegistrationJobs();
      setRegistrationJobs(jobs);
    } catch (error) {
      console.error('Failed to load registration jobs:', error);
      // Silent fail for background job loading - no notification needed
    }
  }, []);

  const handleClearJobs = useCallback(async () => {
    try {
      await clearRegistrationJobs();
      setRegistrationJobs([]);
      addNotification({
        type: 'success',
        title: t('common.cleared'),
        message: t('dashboard.activityCleared'),
      });
    } catch (error) {
      console.error('Failed to clear jobs:', error);
      addNotification({
        type: 'error',
        title: t('common.error'),
        message: t('dashboard.failedToClearActivity'),
      });
    }
  }, [addNotification]);

  const loadDashboardStats = useCallback(async () => {
    try {
      setIsLoadingStats(true);
      const stats = await getDashboardStats();
      setDashboardStats(stats);
    } catch (error) {
      console.error('Failed to load dashboard stats:', error);
      // Silent fail for background stats loading - no notification needed
    } finally {
      setIsLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
    loadRegistrationJobs();
    loadDashboardStats();
  }, [fetchAccounts, loadRegistrationJobs, loadDashboardStats]);

  const summaryData = useMemo(() => {
    if (dashboardStats) {
      const accountsByProvider = providers.map(p => ({
        provider: p.id,
        count: dashboardStats.accountsByProvider[p.id] || 0,
        color: p.color,
      }));

      // Calculate accounts near quota limit (>80%)
      const accountsNearLimit = accounts.filter(a => {
        if (!a.quota || a.quota.limit <= 0) return false;
        const percentUsed = (a.quota.used / a.quota.limit) * 100;
        return percentUsed > 80;
      }).length;

      return {
        totalAccounts: dashboardStats.totalAccounts,
        accountsByProvider,
        activeTokens: dashboardStats.activeTokens,
        quotaUsage: { used: dashboardStats.quotaUsed, limit: dashboardStats.quotaLimit },
        quotaPercent: Math.round(dashboardStats.quotaUsage),
        accountsNearLimit,
      };
    }

    const totalAccounts = accounts.length;
    const accountsByProvider = providers.map(p => ({
      provider: p.id,
      count: accounts.filter(a => a.provider === p.id).length,
      color: p.color,
    }));
    const activeTokens = accounts.filter(a => a.status === 'active').length;
    const quotaUsage = accounts.reduce(
      (acc, a) => ({
        used: acc.used + (a.quota?.used || 0),
        limit: acc.limit + (a.quota?.limit || 0),
      }),
      { used: 0, limit: 0 }
    );
    const quotaPercent =
      quotaUsage.limit > 0 ? Math.round((quotaUsage.used / quotaUsage.limit) * 100) : 0;

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
      quotaUsage,
      quotaPercent,
      accountsNearLimit,
    };
  }, [accounts, providers, dashboardStats]);

  const recentActivity = useMemo(() => {
    const activities: Array<{
      status: 'success' | 'pending' | 'failed';
      title: string;
      description: string;
      timestamp: string;
    }> = [];
    const sortedJobs = [...registrationJobs]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    // Helper to clean and truncate error messages
    const cleanErrorMessage = (
      error: string | undefined,
      provider: string,
      status: string
    ): string => {
      if (!error) return `${provider} - ${status}`;

      // Remove technical details, Chinese characters, and truncate
      let cleaned = error
        .replace(/[\u4e00-\u9fff]/g, '') // Remove Chinese characters
        .replace(/\{[^}]*\}/g, '') // Remove JSON-like objects
        .replace(/\[[^\]]*\]/g, '') // Remove arrays
        .replace(/['"][^'"]*['"]/g, '') // Remove quoted strings
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();

      // Extract meaningful part or use generic message
      if (cleaned.includes('Browser worker failed')) {
        cleaned = 'Browser automation failed';
      } else if (cleaned.includes('timeout')) {
        cleaned = 'Operation timed out';
      } else if (cleaned.length > 50) {
        cleaned = cleaned.substring(0, 47) + '...';
      }

      return cleaned || `${provider} - ${status}`;
    };

    sortedJobs.forEach(job => {
      const statusMap: Record<string, 'success' | 'pending' | 'failed'> = {
        completed: 'success',
        processing: 'pending',
        pending: 'pending',
        initializing: 'pending',
        creating_email: 'pending',
        registering: 'pending',
        verifying: 'pending',
        completing: 'pending',
        failed: 'failed',
        cancelled: 'failed',
        idle: 'pending',
      };
      const jobIdStr = String(job.id);
      activities.push({
        status: statusMap[job.status] || 'pending',
        title: job.email || `Registration ${jobIdStr.slice(0, 8)}`,
        description:
          job.status === 'failed'
            ? cleanErrorMessage(job.error, job.provider, job.status)
            : `${job.provider} - ${job.status}`,
        timestamp: formatActivityTimestamp(job.createdAt),
      });
    });

    if (activities.length === 0) {
      activities.push({
        status: 'success',
        title: t('dashboard.systemReady'),
        description: t('dashboard.noRecentActivity'),
        timestamp: t('time.now'),
      });
    }
    return activities;
  }, [registrationJobs]);

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
      await loadDashboardStats();
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

  const handleOpenAiHub = () => {
    navigate('/ai');
  };

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
        <div className="max-w-[1400px] mx-auto flex flex-col gap-3">
          {/* Stats Grid */}
          <StatsGrid
            isLoading={isLoadingStats}
            totalAccounts={summaryData.totalAccounts}
            activeTokens={summaryData.activeTokens}
            quotaPercent={summaryData.quotaPercent}
            quotaUsed={summaryData.quotaUsage.used}
            quotaLimit={summaryData.quotaUsage.limit}
            accountsNearLimit={summaryData.accountsNearLimit}
            activeProviderCount={
              providers.filter(p =>
                summaryData.accountsByProvider.find(a => a.provider === p.id && a.count > 0)
              ).length
            }
            onAccountsNearLimitClick={handleAccountsNearLimitClick}
          />

          {/* Quick Actions */}
          <QuickActionsPanel
            onStartRegistration={handleStartRegistration}
            onRefreshAllTokens={handleRefreshAllTokens}
            onOpenAiHub={handleOpenAiHub}
            isRefreshing={isBulkRefreshing}
            showProviderWarning={!selectedProvider}
          />

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* Recent Activity */}
            <ActivityFeed
              activities={recentActivity}
              onRefresh={loadRegistrationJobs}
              onClear={handleClearJobs}
              onViewFullLog={() => navigate('/logs')}
            />

            {/* Provider Breakdown */}
            <div className="p-4 flex flex-col min-h-[220px] bg-white/[0.03] border border-white/[0.08] rounded-xl">
              <h3 className="text-sm font-semibold text-white mb-3">
                {t('dashboard.accountsByProvider')}
              </h3>
              <div className="flex-1">
                <ProviderBreakdownChart data={summaryData.accountsByProvider} />
              </div>
            </div>
          </div>

          {/* Provider Selection */}
          <ProviderSelectionGrid
            providers={providers}
            accountsByProvider={summaryData.accountsByProvider}
            selectedProvider={selectedProvider}
            onProviderSelect={setSelectedProvider}
            onManageProviders={() => navigate('/settings')}
          />

          <div className="h-6" />
        </div>
      </div>
    </div>
  );
}
