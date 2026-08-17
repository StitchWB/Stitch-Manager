import { useEffect, useRef } from 'react';
import { Radar as RadarIcon, RefreshCw, SearchX } from 'lucide-react';
import Header from '../components/layout/Header';
import { RadarToolbar } from '../components/radar/RadarToolbar';
import { FoundKeysSection } from '../components/radar/FoundKeysSection';
import { OfferRow } from '../components/radar/OfferRow';
import { GlassCard } from '@/components/ui/GlassCard';
import { IconButton } from '@/components/ui/IconButton';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useAppStore } from '../stores/app';
import { useCommunityStore } from '../stores/community';

const SKELETON_ROWS = 12;

export default function Radar() {
  const language = useAppStore(s => s.language);
  void language; // force re-render on locale change (t() is not reactive)

  const filters = useCommunityStore(s => s.filters);
  const offers = useCommunityStore(s => s.offers);
  const totalCount = useCommunityStore(s => s.totalCount);
  const offersLoading = useCommunityStore(s => s.offersLoading);
  const refreshing = useCommunityStore(s => s.refreshing);
  const loadingMore = useCommunityStore(s => s.loadingMore);
  const offersError = useCommunityStore(s => s.offersError);
  const hasMore = useCommunityStore(s => s.hasMore);
  const stats = useCommunityStore(s => s.stats);
  const fetchOffers = useCommunityStore(s => s.fetchOffers);
  const fetchStats = useCommunityStore(s => s.fetchStats);

  // Fetch stats once on mount
  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  // Fetch offers on mount + whenever filters change (resets the feed)
  useEffect(() => {
    void fetchOffers(true);
  }, [filters, fetchOffers]);

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting && !loadingMore && !offersLoading && !refreshing) {
          void fetchOffers(false);
        }
      },
      { rootMargin: '400px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, offersLoading, refreshing, fetchOffers]);

  const subtitle = stats
    ? t('radar.statsLine', { offers: stats.offers, active: stats.active })
    : t('radar.subtitle');

  const handleRefresh = () => {
    void fetchStats();
    void fetchOffers(true);
  };

  const isBusy = offersLoading || refreshing;
  const isFirstLoad = offersLoading && offers.length === 0;
  const isError = offersError !== null && offers.length === 0;
  const isEmpty = !offersLoading && offersError === null && offers.length === 0;
  const hasInlineError = offersError !== null && offers.length > 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('radar.title')}
        subtitle={subtitle}
        icon={<RadarIcon size={18} />}
        actions={
          <IconButton
            onClick={handleRefresh}
            size="md"
            variant="ghost"
            aria-label={t('radar.refresh')}
            disabled={isBusy}
          >
            <RefreshCw size={16} className={isBusy ? 'animate-spin' : ''} />
          </IconButton>
        }
      />

      <RadarToolbar />

      <div className="flex-1 overflow-y-auto">
        <FoundKeysSection />

        {/* Skeleton rows — first load */}
        {isFirstLoad && (
          <div className="px-4 py-1">
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-2.5 h-9 border-b border-white/[0.04] animate-pulse"
              >
                <div className="w-5 h-5 rounded bg-white/5 shrink-0" />
                <div className="h-3 bg-white/5 rounded flex-1 max-w-[12rem]" />
                <div className="h-3 bg-white/5 rounded w-12 shrink-0" />
                <div className="h-1 bg-white/5 rounded w-10 shrink-0" />
              </div>
            ))}
          </div>
        )}

        {/* Error state — no offers loaded */}
        {isError && (
          <div className="p-6">
            <GlassCard className="p-6 flex flex-col items-center gap-3">
              <p className="text-sm text-slate-300">{t('radar.errorTitle')}</p>
              <p className="text-xs text-slate-500 max-w-md text-center">{offersError}</p>
              <Button variant="secondary" size="sm" onClick={() => void fetchOffers(true)}>
                {t('radar.retry')}
              </Button>
            </GlassCard>
          </div>
        )}

        {/* Empty state */}
        {isEmpty && (
          <div className="p-6">
            <EmptyState
              icon={SearchX}
              title={t('radar.emptyTitle')}
              description={t('radar.emptyDescription')}
            />
          </div>
        )}

        {/* Offer feed */}
        {offers.length > 0 && (
          <>
            {hasInlineError && (
              <div className="px-4 py-2">
                <p className="text-2xs text-amber-400/70">
                  {t('radar.refreshError')}: {offersError}
                </p>
              </div>
            )}

            <div
              className={cn(
                'px-4 py-1 transition-opacity',
                refreshing && 'opacity-60 pointer-events-none'
              )}
            >
              {offers.map(offer => (
                <OfferRow key={offer.id} offer={offer} />
              ))}
            </div>

            {/* Infinite scroll sentinel + bottom status */}
            <div ref={sentinelRef} className="h-1" />

            {loadingMore && (
              <div className="flex items-center justify-center py-4">
                <LoadingSpinner size="sm" />
                <span className="ml-2 text-2xs text-slate-500">{t('radar.loadingMore')}</span>
              </div>
            )}

            <div className="flex items-center justify-center py-3">
              <span className="text-2xs text-slate-600">
                {t('radar.loadedOf', { loaded: offers.length, total: totalCount })}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
