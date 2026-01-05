import { useEffect, useState, useMemo, useCallback } from 'react';
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
} from 'lucide-react';
import Header from '../components/layout/Header';
import { useAppStore } from '../stores/app';
import { useAccountsStore } from '../stores/accounts';
import {
  getServerStatus,
  getRegistrationJobs,
  startRegistration,
  startLLMServer,
} from '../lib/tauri';
import type { ProviderName, RegistrationJob, LLMServerStatus } from '../types';
import { PROVIDER_HEX_COLORS } from '../constants';

// ============================================
// Summary Card Component
// ============================================
interface SummaryCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: { value: string; positive: boolean };
  status?: 'success' | 'warning' | 'error' | 'neutral';
}

function SummaryCard({ title, value, subtitle, icon, trend, status = 'neutral' }: SummaryCardProps) {
  const statusColors = {
    success: 'text-emerald-400',
    warning: 'text-amber-400',
    error: 'text-red-400',
    neutral: 'text-slate-400',
  };

  return (
    <div className="bg-surface-dark border border-border-dark rounded-lg p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-slate-400">{icon}</span>
        {trend && (
          <span className={`text-xs font-medium ${trend.positive ? 'text-emerald-400' : 'text-red-400'}`}>
            {trend.positive ? '↑' : '↓'} {trend.value}
          </span>
        )}
      </div>
      <div>
        <p className={`text-2xl font-bold ${statusColors[status]} text-white`}>{value}</p>
        <p className="text-sm text-slate-400">{title}</p>
        {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
      </div>
    </div>
  );
}

// ============================================
// Activity Item Component
// ============================================
interface ActivityItemProps {
  type: 'registration' | 'token_refresh' | 'error';
  status: 'success' | 'pending' | 'failed';
  title: string;
  description: string;
  timestamp: string;
}

function ActivityItem({ status, title, description, timestamp }: ActivityItemProps) {
  const statusConfig = {
    success: { icon: <CheckCircle size={16} />, color: 'text-emerald-400', border: 'border-emerald-500' },
    pending: { icon: <Loader2 size={16} className="animate-spin" />, color: 'text-amber-400', border: 'border-amber-500' },
    failed: { icon: <XCircle size={16} />, color: 'text-red-400', border: 'border-red-500' },
  };

  const config = statusConfig[status];

  return (
    <div className={`flex items-center gap-3 p-3 rounded hover:bg-white/5 transition-colors border-l-2 ${config.border} bg-white/[0.02]`}>
      <div className="w-8 h-8 rounded bg-slate-700 flex items-center justify-center">
        <span className={config.color}>{config.icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-200 truncate">{title}</p>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      <span className="text-xs text-slate-500 font-mono">{timestamp}</span>
    </div>
  );
}

// ============================================
// Quick Action Button Component
// ============================================
interface QuickActionProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
}

function QuickAction({ icon, label, onClick, variant = 'secondary', disabled, loading }: QuickActionProps) {
  const baseClasses = 'flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-all';
  const variantClasses = {
    primary: 'bg-primary text-white hover:bg-primary/90 disabled:bg-primary/50',
    secondary: 'bg-white/5 text-slate-300 hover:bg-white/10 border border-border-dark disabled:opacity-50',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`${baseClasses} ${variantClasses[variant]}`}
    >
      {loading ? <Loader2 size={18} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

// ============================================
// Provider Breakdown Chart Component (CSS-based)
// ============================================
interface ProviderChartProps {
  data: { provider: ProviderName; count: number; color: string }[];
}

function ProviderBreakdownChart({ data }: ProviderChartProps) {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        <p>No accounts to display</p>
      </div>
    );
  }

  // Calculate percentages and create conic gradient
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
    <div className="flex flex-col lg:flex-row items-center gap-6 h-full">
      {/* Pie Chart */}
      <div className="relative">
        <div
          className="w-32 h-32 rounded-full"
          style={{ background: `conic-gradient(${gradientStops})` }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-20 h-20 bg-surface-dark rounded-full flex flex-col items-center justify-center">
            <span className="text-xl font-bold text-white">{total}</span>
            <span className="text-[10px] text-slate-400">Total</span>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-col gap-2 flex-1">
        {data.filter((item) => item.count > 0).map((item) => (
          <div key={item.provider} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: PROVIDER_HEX_COLORS[item.provider] || '#64748b' }}
            />
            <span className="text-sm text-slate-300 capitalize flex-1">{item.provider}</span>
            <span className="text-sm font-medium text-white">{item.count}</span>
            <span className="text-xs text-slate-500">
              ({((item.count / total) * 100).toFixed(0)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

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

function ProviderCard({ provider, accountCount, isSelected, onSelect }: ProviderCardProps) {
  const statusColors = {
    active: 'text-slate-400',
    down: 'text-red-400 bg-red-400/10',
    maintenance: 'text-amber-400 bg-amber-400/10',
  };

  return (
    <div
      onClick={onSelect}
      className={`group relative bg-surface-dark p-4 rounded-lg border transition-all cursor-pointer ${
        isSelected
          ? 'border-2 border-primary shadow-[0_0_15px_-3px_rgba(56,136,255,0.3)]'
          : 'border-border-dark hover:bg-white/5'
      } ${provider.status === 'down' ? 'opacity-75 hover:opacity-100' : ''}`}
    >
      {/* Selected checkmark */}
      {isSelected && (
        <div className="absolute -top-2 -right-2 w-5 h-5 bg-primary rounded-full flex items-center justify-center border-2 border-surface-dark">
          <CheckCircle className="w-3 h-3 text-white" />
        </div>
      )}

      <div className="flex items-start justify-between mb-2">
        <div
          className={`w-8 h-8 rounded bg-gradient-to-br ${provider.color} flex items-center justify-center text-white font-bold text-xs`}
        >
          {provider.name[0]}
        </div>
        <span
          className={`text-xs font-mono px-1.5 rounded ${
            provider.status === 'active'
              ? isSelected
                ? 'text-primary bg-primary/10'
                : 'text-slate-400'
              : statusColors[provider.status]
          }`}
        >
          {provider.status === 'active'
            ? isSelected
              ? 'Active'
              : provider.version
            : provider.status === 'down'
            ? 'Down'
            : 'Maint.'}
        </span>
      </div>
      <p className={`font-medium ${provider.status === 'down' ? 'text-slate-200' : 'text-white'}`}>
        {provider.name}
      </p>
      <p className={`text-sm ${provider.status === 'down' ? 'text-slate-500' : 'text-slate-400'}`}>
        {accountCount} Account{accountCount !== 1 ? 's' : ''}
      </p>
    </div>
  );
}

// ============================================
// Main Dashboard Component
// ============================================
export default function Dashboard() {
  const { providers, selectedProvider, setSelectedProvider, addNotification } = useAppStore();
  const { accounts, fetchAccounts } = useAccountsStore();
  
  const [serverStatus, setServerStatus] = useState<LLMServerStatus | null>(null);
  const [registrationJobs, setRegistrationJobs] = useState<RegistrationJob[]>([]);
  const [isStartingRegistration, setIsStartingRegistration] = useState(false);
  const [isRefreshingTokens, setIsRefreshingTokens] = useState(false);
  const [isStartingServer, setIsStartingServer] = useState(false);

  // Memoize load functions to prevent infinite loops
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

  // Fetch data on mount
  useEffect(() => {
    fetchAccounts();
    loadServerStatus();
    loadRegistrationJobs();
  }, [fetchAccounts, loadServerStatus, loadRegistrationJobs]);

  // Computed values
  const summaryData = useMemo(() => {
    const totalAccounts = accounts.length;
    const accountsByProvider = providers.map((p) => ({
      provider: p.id,
      count: accounts.filter((a) => a.provider === p.id).length,
      color: p.color,
    }));
    
    const activeTokens = accounts.filter((a) => a.status === 'active').length;
    
    const quotaUsage = accounts.reduce(
      (acc, a) => ({
        used: acc.used + (a.quota?.used || 0),
        limit: acc.limit + (a.quota?.limit || 0),
      }),
      { used: 0, limit: 0 }
    );
    const quotaPercent = quotaUsage.limit > 0 
      ? Math.round((quotaUsage.used / quotaUsage.limit) * 100) 
      : 0;

    return { totalAccounts, accountsByProvider, activeTokens, quotaUsage, quotaPercent };
  }, [accounts, providers]);

  // Recent activity from registration jobs
  const recentActivity = useMemo(() => {
    const activities: ActivityItemProps[] = [];

    // Add registration jobs
    const sortedJobs = [...registrationJobs]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    sortedJobs.forEach((job) => {
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

      activities.push({
        type: 'registration',
        status: statusMap[job.status] || 'pending',
        title: job.email || `Registration ${job.id.slice(0, 8)}`,
        description: job.error || `${job.provider} - ${job.status}`,
        timestamp: formatTimestamp(job.createdAt),
      });
    });

    // Add placeholder if no jobs
    if (activities.length === 0) {
      activities.push(
        {
          type: 'token_refresh',
          status: 'success',
          title: 'System Ready',
          description: 'No recent registration activity',
          timestamp: 'Now',
        }
      );
    }

    return activities;
  }, [registrationJobs]);

  // Format timestamp helper
  function formatTimestamp(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  }

  // Quick action handlers
  const handleStartRegistration = async () => {
    if (!selectedProvider) {
      addNotification({
        type: 'warning',
        title: 'No Provider Selected',
        message: 'Please select a provider first',
      });
      return;
    }
    setIsStartingRegistration(true);
    try {
      await startRegistration({
        provider: selectedProvider,
      });
      addNotification({
        type: 'success',
        title: 'Registration Started',
        message: `Started registration for ${selectedProvider}`,
      });
      await loadRegistrationJobs();
    } catch (error) {
      console.error('Failed to start registration:', error);
      addNotification({
        type: 'error',
        title: 'Registration Failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsStartingRegistration(false);
    }
  };

  const handleRefreshAllTokens = async () => {
    setIsRefreshingTokens(true);
    try {
      await fetchAccounts();
    } catch (error) {
      console.error('Failed to refresh tokens:', error);
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
    } catch (error) {
      console.error('Failed to start LLM server:', error);
    } finally {
      setIsStartingServer(false);
    }
  };

  // Date/time for header
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
    <>
      <Header title="Dashboard Overview" subtitle={`${currentDate} • ${currentTime}`} />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-[1400px] mx-auto flex flex-col gap-6">
          
          {/* 1. Summary Cards Row */}
          <section>
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
              Overview
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <SummaryCard
                title="Total Accounts"
                value={summaryData.totalAccounts}
                subtitle={`Across ${providers.filter((p) => 
                  summaryData.accountsByProvider.find((a) => a.provider === p.id && a.count > 0)
                ).length} providers`}
                icon={<Users size={20} />}
                trend={summaryData.totalAccounts > 0 ? { value: '+5%', positive: true } : undefined}
              />
              <SummaryCard
                title="Active Tokens"
                value={summaryData.activeTokens}
                subtitle={`${summaryData.totalAccounts - summaryData.activeTokens} inactive`}
                icon={<Key size={20} />}
                status={summaryData.activeTokens > 0 ? 'success' : 'warning'}
              />
              <SummaryCard
                title="Quota Usage"
                value={`${summaryData.quotaPercent}%`}
                subtitle={`${summaryData.quotaUsage.used.toLocaleString()} / ${summaryData.quotaUsage.limit.toLocaleString()}`}
                icon={<PieChart size={20} />}
                status={summaryData.quotaPercent > 80 ? 'warning' : summaryData.quotaPercent > 95 ? 'error' : 'neutral'}
              />
              <SummaryCard
                title="LLM Server"
                value={serverStatus?.isRunning ? 'Running' : 'Stopped'}
                subtitle={serverStatus?.isRunning ? `Port ${serverStatus.port}` : 'Click to start'}
                icon={<Server size={20} />}
                status={serverStatus?.isRunning ? 'success' : 'neutral'}
              />
            </div>
          </section>

          {/* 2. Quick Actions Row */}
          <section>
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
              Quick Actions
            </h2>
            <div className="flex flex-wrap gap-3">
              <QuickAction
                icon={<Play size={18} />}
                label="Start Registration"
                onClick={handleStartRegistration}
                variant="primary"
                loading={isStartingRegistration}
                disabled={!selectedProvider}
              />
              <QuickAction
                icon={<RefreshCw size={18} />}
                label="Refresh All Tokens"
                onClick={handleRefreshAllTokens}
                loading={isRefreshingTokens}
              />
              <QuickAction
                icon={<ExternalLink size={18} />}
                label={serverStatus?.isRunning ? 'Open LLM Server' : 'Start LLM Server'}
                onClick={handleOpenLLMServer}
                loading={isStartingServer}
              />
            </div>
            {!selectedProvider && (
              <p className="text-xs text-amber-400 mt-2 flex items-center gap-1">
                <AlertCircle size={12} />
                Select a provider below to enable registration
              </p>
            )}
          </section>

          {/* 3. Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Recent Activity (Span 2) */}
            <div className="col-span-1 lg:col-span-2 bg-surface-dark border border-border-dark rounded-lg p-5 flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-medium text-white">Recent Activity</h3>
                  <p className="text-xs text-slate-400">Last registration attempts and token refreshes</p>
                </div>
                <button 
                  onClick={loadRegistrationJobs}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <RefreshCw size={12} />
                  Refresh
                </button>
              </div>
              
              <div className="flex flex-col gap-2 flex-1">
                {recentActivity.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-slate-500">
                    <p>No recent activity</p>
                  </div>
                ) : (
                  recentActivity.map((activity, index) => (
                    <ActivityItem key={index} {...activity} />
                  ))
                )}
              </div>
              
              <button className="mt-4 w-full py-2 text-xs text-slate-400 hover:text-white border border-dashed border-slate-700 hover:border-slate-500 rounded transition-all">
                View Full Activity Log
              </button>
            </div>

            {/* Provider Breakdown Chart (Span 1) */}
            <div className="col-span-1 bg-surface-dark border border-border-dark rounded-lg p-5 flex flex-col min-h-[280px]">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-medium text-white">Accounts by Provider</h3>
              </div>
              <div className="flex-1">
                <ProviderBreakdownChart data={summaryData.accountsByProvider} />
              </div>
            </div>
          </div>

          {/* 4. Provider Selection Row */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                Provider Selection
              </h2>
              <button className="text-xs text-primary hover:underline">
                Manage Providers
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {providers.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  accountCount={
                    summaryData.accountsByProvider.find((a) => a.provider === provider.id)?.count || 0
                  }
                  isSelected={selectedProvider === provider.id}
                  onSelect={() => setSelectedProvider(provider.id)}
                />
              ))}
            </div>
          </section>

          {/* Footer Spacer */}
          <div className="h-10" />
        </div>
      </div>
    </>
  );
}
