import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Users,
  Key,
  PieChart,
  Server,
  Play,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
  LayoutDashboard,
  TrendingUp,
} from 'lucide-react';
import Header from '../components/layout/Header';
import { useAppStore } from '../stores/app';
import { useAccountsStore } from '../stores/accounts';
import {
  getServerStatus,
  getRegistrationJobs,
  startRegistration,
  startLLMServer,
  getDashboardStats,
} from '../lib/tauri';
import { t } from '../lib/i18n';
import type { ProviderName, RegistrationJob, LLMServerStatus } from '../types';
import { PROVIDER_HEX_COLORS } from '../constants';

// ============================================
// Dashboard Stats Type
// ============================================
interface DashboardStats {
  total_accounts: number;
  active_tokens: number;
  quota_usage: number;
  quota_used: number;
  quota_limit: number;
  accounts_by_provider: Record<string, number>;
}

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
// Stat Card Component (Bento Style)
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
    <div className={`card p-3 flex flex-col gap-2 border border-white/5 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-slate-500">{icon}</span>
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
      <div>
        <p className={`text-2xl font-bold tracking-tight tabular-nums ${isPlaceholder ? 'text-slate-600' : 'text-white'}`}>{displayValue}</p>
        <p className="text-2xs uppercase text-slate-500 mt-0.5">{title}</p>
        {subtitle && <p className="text-2xs text-slate-600 mt-1">{subtitle}</p>}
      </div>
    </div>
  );
});

// ============================================
// Activity Item Component
// ============================================
interface ActivityItemProps {
  status: 'success' | 'pending' | 'failed';
  title: string;
  description: string;
  timestamp: string;
}

const ActivityItem = React.memo(function ActivityItem({ status, title, description, timestamp }: ActivityItemProps) {
  const config = {
    success: { icon: <CheckCircle size={14} />, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    pending: { icon: <Loader2 size={14} className="animate-spin" />, color: 'text-amber-400', bg: 'bg-amber-500/10' },
    failed: { icon: <XCircle size={14} />, color: 'text-red-400', bg: 'bg-red-500/10' },
  }[status];

  return (
    <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.02] transition-colors group">
      <div className={`w-7 h-7 rounded-lg ${config.bg} flex items-center justify-center ${config.color}`}>
        {config.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-200 truncate">{title}</p>
        <p className="text-2xs text-slate-500 truncate">{description}</p>
      </div>
      <span className="text-2xs text-slate-600 font-mono tabular-nums">{timestamp}</span>
    </div>
  );
});

// ============================================
// Provider Card Component
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
      className={`card-interactive p-3 border border-white/5 ${
        isSelected ? 'border-primary/50 gradient-border' : ''
      }`}
    >
      {isSelected && (
        <div className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-primary rounded-full flex items-center justify-center ring-2 ring-ds-bg">
          <CheckCircle className="w-2.5 h-2.5 text-white" />
        </div>
      )}
      <div className="flex items-start justify-between mb-2">
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${provider.color} flex items-center justify-center text-white font-bold text-sm`}>
          {provider.name[0]}
        </div>
        <span className={`text-2xs font-mono px-1.5 py-0.5 rounded ${
          isSelected ? 'text-primary bg-primary/10' : 'text-slate-500'
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
// Provider Breakdown Mini Chart
// ============================================
interface ProviderChartProps {
  data: { provider: ProviderName; count: number }[];
}

function ProviderBreakdownChart({ data }: ProviderChartProps) {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-600 text-sm">
        {t('dashboard.noAccountsToDisplay')}
      </div>
    );
  }

  let cumulativePercent = 0;
  const gradientStops = data
    .filter((item) => item.count > 0)
    .map((item) => {
      const percent = (item.count / total) * 100;
      const start = cumulativePercent;
      cumulativePercent += percent;
      const color = PROVIDER_HEX_COLORS[item.provider] || '#64748b';
      return `${color} ${start}% ${cumulativePercent}%`;
    })
    .join(', ');

  return (
    <div className="flex items-center gap-6 h-full">
      <div className="relative shrink-0">
        <div
          className="w-24 h-24 rounded-full"
          style={{ background: `conic-gradient(${gradientStops})` }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 bg-ds-surface rounded-full flex flex-col items-center justify-center border border-white/10">
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
  
  const [serverStatus, setServerStatus] = useState<LLMServerStatus | null>(null);
  const [registrationJobs, setRegistrationJobs] = useState<RegistrationJob[]>([]);
  const [isStartingRegistration, setIsStartingRegistration] = useState(false);
  const [isRefreshingTokens, setIsRefreshingTokens] = useState(false);
  const [isStartingServer, setIsStartingServer] = useState(false);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  // Force re-render when language changes
  const _ = language;

  const loadServerStatus = useCallback(async () => {
    try {
      const status = await getServerStatus();
      setServerStatus(status);
    } catch (error) {
      console.error('Failed to load server status:', error);
    }
  }, []);

  const loadRegistrationJobs = useCallback(async () => {
    try {
      const jobs = await getRegistrationJobs();
      setRegistrationJobs(jobs);
    } catch (error) {
      console.error('Failed to load registration jobs:', error);
    }
  }, []);

  const loadDashboardStats = useCallback(async () => {
    try {
      setIsLoadingStats(true);
      const stats = await getDashboardStats();
      setDashboardStats(stats);
    } catch (error) {
      console.error('Failed to load dashboard stats:', error);
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
        count: dashboardStats.accounts_by_provider[p.id.toUpperCase()] || 0,
        color: p.color,
      }));
      
      return {
        totalAccounts: dashboardStats.total_accounts,
        accountsByProvider,
        activeTokens: dashboardStats.active_tokens,
        quotaUsage: { used: dashboardStats.quota_used, limit: dashboardStats.quota_limit },
        quotaPercent: Math.round(dashboardStats.quota_usage),
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

    return { totalAccounts, accountsByProvider, activeTokens, quotaUsage, quotaPercent };
  }, [accounts, providers, dashboardStats]);

  const recentActivity = useMemo(() => {
    const activities: ActivityItemProps[] = [];
    const sortedJobs = [...registrationJobs]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    sortedJobs.forEach((job) => {
      const statusMap: Record<string, 'success' | 'pending' | 'failed'> = {
        completed: 'success', processing: 'pending', pending: 'pending',
        initializing: 'pending', creating_email: 'pending', registering: 'pending',
        verifying: 'pending', completing: 'pending', failed: 'failed',
        cancelled: 'failed', idle: 'pending',
      };
      activities.push({
        status: statusMap[job.status] || 'pending',
        title: job.email || `Registration ${job.id.slice(0, 8)}`,
        description: job.error || `${job.provider} - ${job.status}`,
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

  const handleStartRegistration = async () => {
    if (!selectedProvider) {
      addNotification({ type: 'warning', title: t('dashboard.noProviderSelected'), message: t('dashboard.selectProviderFirst') });
      return;
    }
    setIsStartingRegistration(true);
    try {
      await startRegistration({ provider: selectedProvider });
      addNotification({ type: 'success', title: t('dashboard.registrationStarted'), message: `Started registration for ${selectedProvider}` });
      await loadRegistrationJobs();
    } catch (error) {
      addNotification({ type: 'error', title: t('dashboard.registrationFailed'), message: error instanceof Error ? error.message : 'Unknown error' });
    } finally {
      setIsStartingRegistration(false);
    }
  };

  const handleRefreshAllTokens = async () => {
    setIsRefreshingTokens(true);
    try {
      await fetchAccounts();
      await loadDashboardStats();
    } finally {
      setIsRefreshingTokens(false);
    }
  };

  const handleOpenLLMServer = async () => {
    if (serverStatus?.isRunning) {
      window.open(`http://${serverStatus.host}:${serverStatus.port}`, '_blank');
      return;
    }
    setIsStartingServer(true);
    try {
      const status = await startLLMServer();
      setServerStatus(status);
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
            <StatCard
              title={t('dashboard.totalAccounts')}
              value={isLoadingStats ? '—' : summaryData.totalAccounts}
              subtitle={`${t('dashboard.across')} ${providers.filter((p) => summaryData.accountsByProvider.find((a) => a.provider === p.id && a.count > 0)).length} ${t('dashboard.providers')}`}
              icon={<Users size={18} />}
              trend={summaryData.totalAccounts > 0 ? { value: '+5%', positive: true } : undefined}
            />
            <StatCard
              title={t('dashboard.activeTokens')}
              value={isLoadingStats ? '—' : summaryData.activeTokens}
              subtitle={`${summaryData.totalAccounts - summaryData.activeTokens} ${t('dashboard.inactive')}`}
              icon={<Key size={18} />}
            />
            <StatCard
              title={t('dashboard.quotaUsage')}
              value={isLoadingStats ? '—' : `${summaryData.quotaPercent}%`}
              subtitle={`${summaryData.quotaUsage.used.toLocaleString()} / ${summaryData.quotaUsage.limit.toLocaleString()}`}
              icon={<PieChart size={18} />}
            />
            <StatCard
              title={t('dashboard.llmServer')}
              value={serverStatus?.isRunning ? t('status.running') : t('status.stopped')}
              subtitle={serverStatus?.isRunning ? `${t('dashboard.port')} ${serverStatus.port}` : t('dashboard.clickToStart')}
              icon={<Server size={18} />}
            />
          </section>

          {/* Quick Actions */}
          <section className="flex flex-wrap gap-3">
            <button onClick={handleStartRegistration} disabled={!selectedProvider || isStartingRegistration} className="btn-secondary py-1.5 text-xs">
              {isStartingRegistration ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {t('dashboard.startRegistration')}
            </button>
            <button onClick={handleRefreshAllTokens} disabled={isRefreshingTokens} className="btn-secondary py-1.5 text-xs">
              <RefreshCw size={14} className={isRefreshingTokens ? 'animate-spin' : ''} />
              {t('dashboard.refreshAllTokens')}
            </button>
            <button onClick={handleOpenLLMServer} disabled={isStartingServer} className="btn-secondary py-1.5 text-xs">
              {isStartingServer ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
              {serverStatus?.isRunning ? t('dashboard.openLlmServer') : t('dashboard.startLlmServer')}
            </button>
            {!selectedProvider && (
              <span className="flex items-center gap-1.5 text-2xs text-amber-400 ml-2">
                <AlertCircle size={12} />
                {t('dashboard.selectProviderBelow')}
              </span>
            )}
          </section>

          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* Recent Activity */}
            <div className="lg:col-span-2 card p-3 flex flex-col border border-white/5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">{t('dashboard.recentActivity')}</h3>
                  <p className="text-2xs text-slate-500">{t('dashboard.lastRegistrationAttempts')}</p>
                </div>
                <button onClick={loadRegistrationJobs} className="btn-ghost text-xs py-1 px-2">
                  <RefreshCw size={12} /> {t('common.refresh')}
                </button>
              </div>
              <div className="flex flex-col gap-1 flex-1">
                {recentActivity.map((activity, index) => (
                  <ActivityItem key={index} {...activity} />
                ))}
              </div>
              <button className="mt-3 w-full py-2 text-2xs text-slate-500 hover:text-white border border-dashed border-white/10 hover:border-white/20 rounded-lg transition-all">
                {t('dashboard.viewFullActivityLog')}
              </button>
            </div>

            {/* Provider Breakdown */}
            <div className="card p-3 flex flex-col min-h-[220px] border border-white/5">
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
              <button className="text-2xs text-primary hover:underline">{t('dashboard.manageProviders')}</button>
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
