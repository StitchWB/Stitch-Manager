import { Package } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { GlassCard } from '@/components/ui/GlassCard';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { MarketplaceItem } from '@/lib/backend/modules/marketplace';
import { MarketplaceListRow } from './MarketplaceListRow';

interface MarketplaceListBodyProps {
  tab: 'marketplace' | 'installed' | 'submissions';
  isFirstLoad: boolean;
  isError: boolean;
  error: string | null;
  isEmpty: boolean;
  feedError: boolean;
  hasActiveSearch: boolean;
  refreshing: boolean;
  filtered: MarketplaceItem[];
  installedItems: MarketplaceItem[];
  availableItems: MarketplaceItem[];
  selectedId: string | null;
  actionInProgress: string | null;
  isGuest: boolean;
  onSelect: (id: string) => void;
  onInstall: (item: MarketplaceItem) => void;
  onLockedClick: () => void;
  onRefresh: () => void;
}

export function MarketplaceListBody({
  tab,
  isFirstLoad,
  isError,
  error,
  isEmpty,
  feedError,
  hasActiveSearch,
  refreshing,
  filtered,
  installedItems,
  availableItems,
  selectedId,
  actionInProgress,
  isGuest,
  onSelect,
  onInstall,
  onLockedClick,
  onRefresh,
}: MarketplaceListBodyProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      {/* First load skeleton */}
      {isFirstLoad && (
        <div className="p-6 flex items-center justify-center">
          <LoadingSpinner size="md" />
          <span className="ml-2 text-sm text-slate-500">
            {t('common.loading')}
          </span>
        </div>
      )}

      {/* Error state — no items loaded */}
      {isError && (
        <div className="p-6">
          <GlassCard className="p-6 flex flex-col items-center gap-3">
            <p className="text-sm text-slate-300">
              {t('marketplace.loadError')}
            </p>
            <p className="text-xs text-slate-500 max-w-md text-center">
              {error}
            </p>
            <Button variant="secondary" size="sm" onClick={onRefresh}>
              {t('marketplace.refresh')}
            </Button>
          </GlassCard>
        </div>
      )}

      {/* Empty state */}
      {isEmpty &&
        (feedError && !hasActiveSearch ? (
          <div className="p-6">
            <GlassCard className="p-6 flex flex-col items-center gap-3">
              <p className="text-sm text-slate-300">
                {t('marketplace.feedUnavailableTitle')}
              </p>
              <p className="text-xs text-slate-500 max-w-md text-center">
                {t('marketplace.feedUnavailableDesc')}
              </p>
              <Button variant="secondary" size="sm" onClick={onRefresh}>
                {t('marketplace.refresh')}
              </Button>
            </GlassCard>
          </div>
        ) : (
          <div className="p-6">
            <EmptyState
              icon={Package}
              title={
                hasActiveSearch
                  ? t('marketplace.emptyTitle')
                  : t('marketplace.noPluginsTitle')
              }
              description={
                hasActiveSearch
                  ? t('marketplace.emptyDescription')
                  : t('marketplace.noPluginsDesc')
              }
            />
          </div>
        ))}

      {/* Plugin list */}
      {filtered.length > 0 && (
        <div
          className={cn(
            'transition-opacity',
            refreshing && 'opacity-60 pointer-events-none',
          )}
        >
          {tab === 'marketplace' ? (
            <>
              {/* INSTALLED section */}
              {installedItems.length > 0 && (
                <section>
                  <h2 className="px-3 pt-3 pb-1 text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                    {t('marketplace.installedSection')} ·{' '}
                    {installedItems.length}
                  </h2>
                  {installedItems.map(item => (
                    <MarketplaceListRow
                      key={item.id}
                      item={item}
                      selected={item.id === selectedId}
                      busy={actionInProgress === item.id}
                      isGuest={isGuest}
                      onSelect={onSelect}
                      onInstall={onInstall}
                      onLockedClick={onLockedClick}
                    />
                  ))}
                </section>
              )}

              {/* AVAILABLE section */}
              {availableItems.length > 0 && (
                <section>
                  <h2 className="px-3 pt-3 pb-1 text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                    {t('marketplace.availableSection')} ·{' '}
                    {availableItems.length}
                  </h2>
                  {availableItems.map(item => (
                    <MarketplaceListRow
                      key={item.id}
                      item={item}
                      selected={item.id === selectedId}
                      busy={actionInProgress === item.id}
                      isGuest={isGuest}
                      onSelect={onSelect}
                      onInstall={onInstall}
                      onLockedClick={onLockedClick}
                    />
                  ))}
                </section>
              )}
            </>
          ) : (
            /* Installed tab: flat list (all installed) */
            filtered.map(item => (
              <MarketplaceListRow
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                busy={actionInProgress === item.id}
                isGuest={isGuest}
                onSelect={onSelect}
                onInstall={onInstall}
                onLockedClick={onLockedClick}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
