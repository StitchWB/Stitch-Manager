import React from 'react';
import { Users, Key, AlertCircle, Target } from 'lucide-react';
import { StatCard } from './StatCard';
import { StatCardSkeleton } from './StatCardSkeleton';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface StatsGridProps {
  isLoading: boolean;
  totalAccounts: number;
  activeTokens: number;
  fleetActive: number;
  fleetTarget: number;
  accountsNearLimit: number;
  activeProviderCount: number;
  onAccountsNearLimitClick?: () => void;
  onFleetClick?: () => void;
}

export const StatsGrid = React.memo(function StatsGrid({
  isLoading,
  totalAccounts,
  activeTokens,
  fleetActive,
  fleetTarget,
  accountsNearLimit,
  activeProviderCount,
  onAccountsNearLimitClick,
  onFleetClick,
}: StatsGridProps) {
  if (isLoading) {
    return (
      <section className="flex flex-wrap gap-3">
        <div className="flex-1 basis-[220px] min-w-[200px]"><StatCardSkeleton /></div>
        <div className="flex-1 basis-[220px] min-w-[200px]"><StatCardSkeleton /></div>
        <div className="flex-1 basis-[220px] min-w-[200px]"><StatCardSkeleton /></div>
        <div className="flex-1 basis-[220px] min-w-[200px]"><StatCardSkeleton /></div>
      </section>
    );
  }

  const fleetGap = Math.max(fleetTarget - fleetActive, 0);
  const fleetSubtitle = fleetTarget === 0
    ? t('dashboard.fleet.noTarget')
    : fleetGap > 0
      ? t('dashboard.fleet.subtitleShort', { gap: fleetGap })
      : t('dashboard.fleet.subtitleFull');

  return (
    <section className="flex flex-wrap gap-3">
      <div className="flex-1 basis-[220px] min-w-[200px]">
        <StatCard
          title={t('dashboard.totalAccounts')}
          value={totalAccounts}
          subtitle={`${t('dashboard.across')} ${activeProviderCount} ${t('dashboard.providers')}`}
          icon={<Users size={18} />}
        />
      </div>
      <div className="flex-1 basis-[220px] min-w-[200px]">
        <StatCard
          title={t('dashboard.activeTokens')}
          value={activeTokens}
          subtitle={`${totalAccounts - activeTokens} ${t('dashboard.inactive')}`}
          icon={<Key size={18} />}
        />
      </div>

      <div
        onClick={onFleetClick}
        className={cn(
          'flex-1 basis-[220px] min-w-[200px]',
          onFleetClick && 'cursor-pointer'
        )}
      >
        <StatCard
          title={t('dashboard.fleet.title')}
          value={`${fleetActive}/${fleetTarget}`}
          subtitle={fleetSubtitle}
          icon={<Target size={18} />}
          className={fleetGap > 0 && fleetTarget > 0 ? 'border border-amber-500/30' : ''}
        />
      </div>

      <div
        onClick={accountsNearLimit > 0 ? onAccountsNearLimitClick : undefined}
        className={cn(
          'flex-1 basis-[220px] min-w-[200px]',
          accountsNearLimit > 0 && 'cursor-pointer'
        )}
      >
        <StatCard
          title={t('dashboard.accountsNearLimit')}
          value={accountsNearLimit}
          subtitle={
            accountsNearLimit > 0 ? t('dashboard.clickToFilter') : t('dashboard.allAccountsHealthy')
          }
          icon={<AlertCircle size={18} />}
          className={accountsNearLimit > 0 ? 'border border-amber-500/30' : ''}
        />
      </div>
    </section>
  );
});
