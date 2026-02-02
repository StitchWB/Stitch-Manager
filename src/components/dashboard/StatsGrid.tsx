import React from 'react';
import { Users, Key, PieChart, AlertCircle } from 'lucide-react';
import { StatCard } from './StatCard';
import { StatCardSkeleton } from './StatCardSkeleton';
import { t } from '../../lib/i18n';

interface StatsGridProps {
  isLoading: boolean;
  totalAccounts: number;
  activeTokens: number;
  quotaPercent: number;
  quotaUsed: number;
  quotaLimit: number;
  accountsNearLimit: number;
  activeProviderCount: number;
  onAccountsNearLimitClick?: () => void;
}

export const StatsGrid = React.memo(function StatsGrid({
  isLoading,
  totalAccounts,
  activeTokens,
  quotaPercent,
  quotaUsed,
  quotaLimit,
  accountsNearLimit,
  activeProviderCount,
  onAccountsNearLimitClick,
}: StatsGridProps) {
  if (isLoading) {
    return (
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </section>
    );
  }

  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard
        title={t('dashboard.totalAccounts')}
        value={totalAccounts}
        subtitle={`${t('dashboard.across')} ${activeProviderCount} ${t('dashboard.providers')}`}
        icon={<Users size={18} />}
      />
      <StatCard
        title={t('dashboard.activeTokens')}
        value={activeTokens}
        subtitle={`${totalAccounts - activeTokens} ${t('dashboard.inactive')}`}
        icon={<Key size={18} />}
      />
      <StatCard
        title={t('dashboard.quotaUsage')}
        value={`${quotaPercent}%`}
        subtitle={`${quotaUsed.toLocaleString()} / ${quotaLimit.toLocaleString()}`}
        icon={<PieChart size={18} />}
      />
      <div
        onClick={accountsNearLimit > 0 ? onAccountsNearLimitClick : undefined}
        className={accountsNearLimit > 0 ? 'cursor-pointer' : ''}
      >
        <StatCard
          title={t('dashboard.accountsNearLimit')}
          value={accountsNearLimit}
          subtitle={
            accountsNearLimit > 0
              ? t('dashboard.clickToFilter')
              : t('dashboard.allAccountsHealthy')
          }
          icon={<AlertCircle size={18} />}
          className={
            accountsNearLimit > 0 ? 'border border-amber-500/30' : ''
          }
        />
      </div>
    </section>
  );
});
