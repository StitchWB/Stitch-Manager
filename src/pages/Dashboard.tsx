import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Key,
  PieChart,
  Play,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
  LayoutDashboard,
  TrendingUp,
  Trash2,
} from 'lucide-react';
import Header from '../components/layout/Header';
import { useAppStore } from '../stores/app';
import { useAccountsStore } from '../stores/accounts';
import { useLogsStore } from '../stores/logs';
import {
  getServerStatus,
  getRegistrationJobs,
  clearRegistrationJobs,
  startLLMServer,
  getDashboardStats,
} from '../lib/tauri';
import { t } from '../lib/i18n';
import type { ProviderName, RegistrationJob, LLMServerStatus, DashboardStats } from '../types';
import { PROVIDER_HEX_COLORS } from '../constants';

// ============================================
// Sparkline Component (Mini SVG Chart)
// ============================================
const Sparkline = ({ data = [3, 7, 4, 9, 5, 8, 6] }: { data?: number[] }) => {
  const max = Math.max(...data);
  const points = data.map((v, i) => `${i * 14},${20 - (v / max) * 18}`).join(' ');
  return (
    <svg className="w-20 h-5 opacity-50" viewBox="0 0 84 20">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
    </svg>
  );
};

// ============================================
// Skeleton Loader for Stat Cards
// ============================================
const StatCardSkeleton = () => (
  <div className="relative p-5 flex flex-col gap-4 rounded-xl"
    style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.04), transparent)' }}
  >
    <div className="flex items-center justify-between">
      <div className="w-8 h-8 rounded-lg bg-white/5 animate-pulse" />
      <div className="w-20 h-5 bg-white/5 rounded animate-pulse" />
    </div>
    <div>
      <div className="w-24 h-10 bg-white/5 rounded animate-pulse mb-2" />
      <div className="w-32 h-3 bg-white/5 rounded animate-pulse" />
    </div>
  </div>
);

// ============================================
// Stat Card Component (Deep Space Void Style)
// ============================================
interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: { value: string; positive: boolean };
  className?: string;
}

const StatCard = React.memo(function StatCard({ title, value, subtitle, icon, trend, className = '' }: StatCardProps) {
  // Fix NaN display: if value is 0, NaN, or falsy (except string "0"), show "—" in gray
  const displayValue = value === 0 || value === '0' || !value || (typeof value === 'number' && isNaN(value)) ? '—' : value;
  const isPlaceholder = displayValue === '—';
  
  return (
    <div className={`relative p-5 flex flex-col gap-4 rounded-xl transition-all duration-300 hover:shadow-glow-purple ${className}`}
      style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.04), transparent)' }}
    >
      {/* Large faint icon in top-right */}
      <div className="absolute top-3 right-3 opacity-[0.08]">
        {React.cloneElement(icon as React.ReactElement, { size: 64 })}
      </div>
      
      <div className="flex items-center justify-between relative z-10">
        <span className="w-8 h-8 text-purple-400 flex items-center justify-center rounded-lg bg-purple-500/10">
          {React.cloneElement(icon as React.ReactElement, { size: 20 })}
        </span>
        {trend && !isPlaceholder && (
          <div className="flex items-center gap-2">
            <Sparkline />
            <span className={`text-2xs font-medium flex items-center gap-1 ${trend.positive ? 'text-emerald-400' : 'text-red-400'}`}>
              <TrendingUp size={12} className={!trend.positive ? 'rotate-180' : ''} />
              {trend.value}
            </span>
          </div>
        )}
      </div>
      <div className="relative z-10">
        <p className={`text-4xl font-bold tracking-tight tabular-nums ${isPlaceholder ? 'text-slate-600' : 'text-white'}`}>{displayValue}</p>
        <p className="text-xs uppercase text-slate-500 tracking-wider mt-1.5">{title}</p>
        {subtitle && <p className="text-2xs text-slate-600 mt-1">{subtitle}</p>}
      </div>
    </div>
  );
});

// ============================================
// Activity Item Component (Deep Space Void Style)
// ============================================
interface ActivityItemProps {
  status: 'success' | 'pending' | 'failed';
  title: string;
  description: string;
  timestamp: string;
}

const ActivityItem = React.memo(function ActivityItem({ status, title, description, timestamp }: ActivityItemProps) {
  const config = {
    success: { 
      icon: <CheckCircle size={16} />, 
      color: 'text-emerald-400', 
      bg: 'bg-emerald-500/10', 
      rowBg: '',
      borderColor: '' 
    },
    pending: { 
      icon: <Loader2 size={16} className="animate-spin" />, 
      color: 'text-amber-400', 
      bg: 'bg-amber-500/10', 
      rowBg: '',
      borderColor: '' 
    },
    failed: { 
      icon: <XCircle size={16} />, 
      color: 'text-red-400', 
      bg: 'bg-red-500/10', 
      rowBg: 'bg-red-500/[0.05]',
      borderColor: 'border-l-2 border-red-500' 
    },
  }[status];

  return (
    <div className={`flex items-center gap-3 py-3 px-3 rounded-lg hover:bg-white/[0.02] transition-colors group ${config.rowBg} ${config.borderColor}`}>
      <div className={`w-8 h-8 rounded-lg ${config.bg} flex items-center justify-center ${config.color}`}>
        {config.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-200 truncate">{title}</p>
        <p className={`text-2xs truncate ${status === 'failed' ? 'text-red-400' : 'text-slate-500'}`}>{description}</p>
      </div>
      <span className="text-2xs text-slate-600 font-mono tabular-nums">{timestamp}</span>
    </div>
  );
});

// ============================================
// Provider Card Component (Deep Space Glass Style)
// ============================================
interface ProviderCardProps {
  provider: {
    id: ProviderName;
    name: string;
    version: string;
    status: 'active' | 'down' | 'maintenance';
    color: string;
  };
  accountCount: number;
  isSelected: boolean;
  onSelect: () => void;
}

const ProviderCard = React.memo(function ProviderCard({ provider, accountCount, isSelected, onSelect }: ProviderCardProps) {
  return (
    <div
      onClick={onSelect}
      className={`relative p-3 rounded-xl cursor-pointer transition-all duration-300 bg-white/[0.03] border border-white/[0.08] hover:shadow-[0_0_20px_rgba(139,92,246,0.15)] hover:border-white/[0.12] ${
        isSelected ? 'border-purple-500/50 shadow-[0_0_15px_rgba(139,92,246,0.2)]' : ''
      }`}
    >
      {isSelected && (
        <div className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-purple-500 rounded-full flex items-center justify-center ring-2 ring-vsc-bg">
          <CheckCircle className="w-2.5 h-2.5 text-white" />
        </div>
      )}
      <div className="flex items-start justify-between mb-2">
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${provider.color} flex items-center justify-center text-white font-bold text-sm`}>
          {provider.name[0]}
        </div>
        <span className={`text-2xs font-mono px-1.5 py-0.5 rounded ${
          isSelected ? 'text-purple-400 bg-purple-500/10' : 'text-slate-500'
        }`}>
          {isSelected ? t('status.active') : provider.version}
        </span>
      </div>
      <p className="font-medium text-white text-sm">{provider.name}</p>
      <p className="text-2xs text-slate-500 mt-0.5 tabular-nums">
        {accountCount} {t('accounts.account')}{accountCount !== 1 ? 's' : ''}
      </p>
    </div>
  );
});

// ============================================
// Provider Breakdown Mini Chart (Deep Space Void Style)
// ============================================
interface ProviderChartProps {
  data: { provider: ProviderName; count: number }[];
}

function ProviderBreakdownChart({ data }: ProviderChartProps) {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  
  // Empty state with placeholder chart
  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-6">
        {/* Placeholder donut ring */}
        <div className="relative mb-4">
          <div 
            className="w-20 h-20 rounded-full opacity-10"
            style={{ 
              background: 'conic-gradient(#64748b 0% 100%)',
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-14 h-14 bg-vsc-bg rounded-full" />
          </div>
        </div>
        <p className="text-sm text-slate-600">{t('dashboard.noDataToDisplay')}</p>
        <button className="mt-3 px-4 py-1.5 text-xs font-medium rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
          {t('accounts.addFirstAccount') || 'Add Account'}
        </button>
      </div>
    );
  }

  // Use reduce to calculate gradient stops without mutation
  const gradientStops = data
    .filter((item) => item.count > 0)
    .reduce((acc, item) => {
      const percent = (item.count / total) * 100;
      const start = acc.cumulative;
      const end = start + percent;
      const color = PROVIDER_HEX_COLORS[item.provider] || '#64748b';
      acc.stops.push(`${color} ${start}% ${end}%`);
      acc.cumulative = end;
      return acc;
    }, { stops: [] as string[], cumulative: 0 })
    .stops
    .join(', ');

  return (
    <div className="flex items-center gap-6 h-full">
      <div className="relative shrink-0">
        <div
          className="w-24 h-24 rounded-full"
          style={{ background: `conic-gradient(${gradientStops})` }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 bg-vsc-bg rounded-full flex flex-col items-center justify-center border border-white/[0.08]">
            <span className="text-lg font-bold text-white tabular-nums">{total}</span>
            <span className="text-2xs text-slate-500">{t('common.total')}</span>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 flex-1">
        {data.filter((item) => item.count > 0).map((item) => (
          <div key={item.provider} className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ backgroundColor: PROVIDER_HEX_COLORS[item.provider] || '#64748b' }}
            />
            <span className="text-xs text-slate-400 capitalize flex-1">{item.provider}</span>
            <span className="text-xs font-medium text-white tabular-nums">{item.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// Main Dashboard Component
// ============================================
export default function Dashboard() {
  const { providers, selectedProvider, setSelectedProvider, addNotification, language } = useAppStore();
  const { accounts, fetchAccounts } = useAccountsStore();
  const { addLog } = useLogsStore();
  const navigate = useNavigate();
  
  const [serverStatus, setServerStatus] = useState<LLMServerStatus | null>(null);
  const [registrationJobs, setRegistrationJobs] = useState<RegistrationJob[]>([]);
  const [isRefreshingTokens, setIsRefreshingTokens] = useState(false);
  const [isStartingServer, setIsStartingServer] = useState(false);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  // Force re-render when language changes
  void language; // Force re-render on language change

  const loadServerStatus = useCallback(async () => {
    try {
      const status = await getServerStatus();
      setServerStatus(status);
    } catch (error) {
      console.error('Failed to load server status:', error);
      // Silent fail for background status check - no notification needed
    }
  }, []);

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
      addNotification({ type: 'success', title: t('common.cleared'), message: t('dashboard.activityCleared') });
    } catch (error) {
      console.error('Failed to clear jobs:', error);
      addNotification({ type: 'error', title: t('common.error'), message: t('dashboard.failedToClearActivity') });
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
    loadServerStatus();
    loadRegistrationJobs();
    loadDashboardStats();
  }, [fetchAccounts, loadServerStatus, loadRegistrationJobs, loadDashboardStats]);

  const summaryData = useMemo(() => {
    if (dashboardStats) {
      const accountsByProvider = providers.map((p) => ({
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
    const accountsByProvider = providers.map((p) => ({
      provider: p.id,
      count: accounts.filter((a) => a.provider === p.id).length,
      color: p.color,
    }));
    const activeTokens = accounts.filter((a) => a.status === 'active').length;
    const quotaUsage = accounts.reduce(
      (acc, a) => ({ used: acc.used + (a.quota?.used || 0), limit: acc.limit + (a.quota?.limit || 0) }),
      { used: 0, limit: 0 }
    );
    const quotaPercent = quotaUsage.limit > 0 ? Math.round((quotaUsage.used / quotaUsage.limit) * 100) : 0;
    
    // Calculate accounts near quota limit (>80%)
    const accountsNearLimit = accounts.filter(a => {
      if (!a.quota || a.quota.limit <= 0) return false;
      const percentUsed = (a.quota.used / a.quota.limit) * 100;
      return percentUsed > 80;
    }).length;

    return { totalAccounts, accountsByProvider, activeTokens, quotaUsage, quotaPercent, accountsNearLimit };
  }, [accounts, providers, dashboardStats]);

  const recentActivity = useMemo(() => {
    const activities: ActivityItemProps[] = [];
    const sortedJobs = [...registrationJobs]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    // Helper to clean and truncate error messages
    const cleanErrorMessage = (error: string | undefined, provider: string, status: string): string => {
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

    sortedJobs.forEach((job) => {
      const statusMap: Record<string, 'success' | 'pending' | 'failed'> = {
        completed: 'success', processing: 'pending', pending: 'pending',
        initializing: 'pending', creating_email: 'pending', registering: 'pending',
        verifying: 'pending', completing: 'pending', failed: 'failed',
        cancelled: 'failed', idle: 'pending',
      };
      const jobIdStr = String(job.id);
      activities.push({
        status: statusMap[job.status] || 'pending',
        title: job.email || `Registration ${jobIdStr.slice(0, 8)}`,
        description: job.status === 'failed' 
          ? cleanErrorMessage(job.error, job.provider, job.status)
          : `${job.provider} - ${job.status}`,
        timestamp: formatTimestamp(job.createdAt),
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

  function formatTimestamp(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return t('time.justNow');
    if (diffMins < 60) return t('time.minutesAgo', { count: diffMins });
    if (diffMins < 1440) return t('time.hoursAgo', { count: Math.floor(diffMins / 60) });
    return date.toLocaleDateString();
  }

  const handleStartRegistration = () => {
    // Navigate to AutoReg page instead of calling removed startRegistration
    navigate('/autoreg');
  };

  const handleRefreshAllTokens = async () => {
    setIsRefreshingTokens(true);
    addLog({
      level: 'info',
      message: 'Refreshing all tokens...',
      source: 'accounts',
    });
    try {
      await fetchAccounts();
      await loadDashboardStats();
      addLog({
        level: 'success',
        message: 'Tokens refreshed successfully',
        source: 'accounts',
      });
    } finally {
      setIsRefreshingTokens(false);
    }
  };

  const handleOpenLLMServer = async () => {
    if (serverStatus?.isRunning) {
      window.open(`http://${serverStatus.host}:${serverStatus.port}`, '_blank');
      addLog({
        level: 'info',
        message: `Opened LLM server at ${serverStatus.host}:${serverStatus.port}`,
        source: 'server',
      });
      return;
    }
    setIsStartingServer(true);
    addLog({
      level: 'info',
      message: 'Starting LLM server...',
      source: 'server',
    });
    try {
      const status = await startLLMServer();
      setServerStatus(status);
      addLog({
        level: 'success',
        message: `LLM server started on port ${status.port}`,
        source: 'server',
      });
    } catch (error) {
      addLog({
        level: 'error',
        message: `Failed to start LLM server: ${error instanceof Error ? error.message : 'Unknown error'}`,
        source: 'server',
      });
    } finally {
      setIsStartingServer(false);
    }
  };

  const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' });
  const currentTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header 
        title={t('dashboard.title')} 
        subtitle={`${currentDate} • ${currentTime}`}
        icon={<LayoutDashboard size={18} />}
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1400px] mx-auto flex flex-col gap-3">
          
          {/* Bento Grid - Stats */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {isLoadingStats ? (
              <>
                <StatCardSkeleton />
                <StatCardSkeleton />
                <StatCardSkeleton />
                <StatCardSkeleton />
              </>
            ) : (
              <>
                <StatCard
                  title={t('dashboard.totalAccounts')}
                  value={summaryData.totalAccounts}
                  subtitle={`${t('dashboard.across')} ${providers.filter((p) => summaryData.accountsByProvider.find((a) => a.provider === p.id && a.count > 0)).length} ${t('dashboard.providers')}`}
                  icon={<Users size={18} />}
                />
                <StatCard
                  title={t('dashboard.activeTokens')}
                  value={summaryData.activeTokens}
                  subtitle={`${summaryData.totalAccounts - summaryData.activeTokens} ${t('dashboard.inactive')}`}
                  icon={<Key size={18} />}
                />
                <StatCard
                  title={t('dashboard.quotaUsage')}
                  value={`${summaryData.quotaPercent}%`}
                  subtitle={`${summaryData.quotaUsage.used.toLocaleString()} / ${summaryData.quotaUsage.limit.toLocaleString()}`}
                  icon={<PieChart size={18} />}
                />
                <div 
                  onClick={() => {
                    if (summaryData.accountsNearLimit > 0) {
                      navigate('/accounts');
                      // Set the low quota filter after navigation
                      setTimeout(() => {
                        useAccountsStore.getState().setQuotaFilter('low_quota');
                      }, 100);
                    }
                  }}
                  className={summaryData.accountsNearLimit > 0 ? 'cursor-pointer' : ''}
                >
                  <StatCard
                    title={t('dashboard.accountsNearLimit')}
                    value={summaryData.accountsNearLimit}
                    subtitle={summaryData.accountsNearLimit > 0 ? t('dashboard.clickToFilter') : t('dashboard.allAccountsHealthy')}
                    icon={<AlertCircle size={18} />}
                    className={summaryData.accountsNearLimit > 0 ? 'border border-amber-500/30' : ''}
                  />
                </div>
              </>
            )}
          </section>

          {/* Quick Actions */}
          <section className="flex flex-wrap gap-3">
            <button onClick={handleStartRegistration} className="bg-purple-600 hover:bg-purple-500 text-white py-2 px-4 text-sm rounded-lg flex items-center gap-2 transition-colors">
              <Play size={16} />
              {t('dashboard.startRegistration')}
            </button>
            <button onClick={handleRefreshAllTokens} disabled={isRefreshingTokens} className="btn-secondary py-2 px-4 text-sm">
              <RefreshCw size={16} className={isRefreshingTokens ? 'animate-spin' : ''} />
              {t('dashboard.refreshAllTokens')}
            </button>
            <button onClick={handleOpenLLMServer} disabled={isStartingServer} className="btn-secondary py-2 px-4 text-sm">
              {isStartingServer ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
              {serverStatus?.isRunning ? t('dashboard.openLlmServer') : t('dashboard.startLlmServer')}
            </button>
            {!selectedProvider && (
              <span className="flex items-center gap-1.5 text-xs text-amber-400 ml-2">
                <AlertCircle size={14} />
                {t('dashboard.selectProviderBelow')}
              </span>
            )}
          </section>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* Recent Activity */}
            <div className="lg:col-span-2 p-4 flex flex-col bg-white/[0.03] border border-white/[0.08] rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">{t('dashboard.recentActivity')}</h3>
                  <p className="text-2xs text-slate-500">{t('dashboard.lastRegistrationAttempts')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={handleClearJobs} className="btn-ghost text-xs py-1 px-2 text-red-400 hover:text-red-300" title={t('dashboard.clearActivityLog')}>
                    <Trash2 size={12} />
                  </button>
                  <button onClick={loadRegistrationJobs} className="btn-ghost text-xs py-1 px-2">
                    <RefreshCw size={12} /> {t('common.refresh')}
                  </button>
                </div>
              </div>
              <div className="flex flex-col space-y-2 flex-1">
                {recentActivity.map((activity, index) => (
                  <ActivityItem key={index} {...activity} />
                ))}
              </div>
              <button 
                onClick={() => navigate('/logs')}
                className="mt-3 w-full py-2 text-2xs text-slate-500 hover:text-white border border-dashed border-white/10 hover:border-white/20 rounded-lg transition-all"
              >
                {t('dashboard.viewFullActivityLog')}
              </button>
            </div>

            {/* Provider Breakdown */}
            <div className="p-4 flex flex-col min-h-[220px] bg-white/[0.03] border border-white/[0.08] rounded-xl">
              <h3 className="text-sm font-semibold text-white mb-3">{t('dashboard.accountsByProvider')}</h3>
              <div className="flex-1">
                <ProviderBreakdownChart data={summaryData.accountsByProvider} />
              </div>
            </div>
          </div>

          {/* Provider Selection */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('dashboard.providerSelection')}</h2>
              <button 
                onClick={() => navigate('/settings')}
                className="text-2xs text-primary hover:underline"
              >
                {t('dashboard.manageProviders')}
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {providers.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  accountCount={summaryData.accountsByProvider.find((a) => a.provider === provider.id)?.count || 0}
                  isSelected={selectedProvider === provider.id}
                  onSelect={() => setSelectedProvider(provider.id)}
                />
              ))}
            </div>
          </section>

          <div className="h-6" />
        </div>
      </div>
    </div>
  );
}
