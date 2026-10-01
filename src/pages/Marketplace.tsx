import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Package, RefreshCw, Store, Upload } from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/layout/Header';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import { useMarketplaceStore } from '../stores/marketplace';
import type { MarketplaceCategory, MarketplaceItem } from '@/lib/backend/modules/marketplace';
import { MarketplaceFilterBar } from '../components/marketplace/MarketplaceFilterBar';
import { MarketplaceListBody } from '../components/marketplace/MarketplaceListBody';
import { MySubmissionsPanel } from '../components/marketplace/MySubmissionsPanel';
import { PluginDetail } from '../components/marketplace/PluginDetail';
import { SubmitPluginModal } from '../components/marketplace/SubmitPluginModal';

export default function Marketplace() {
  const language = useAppStore(s => s.language);
  void language; // force re-render on locale change (t() is not reactive)

  const user = useAuthStore(s => s.user);
  const setAuthView = useAuthStore(s => s.setAuthView);

  const items = useMarketplaceStore(s => s.items);
  const activated = useMarketplaceStore(s => s.activated);
  const feeds = useMarketplaceStore(s => s.feeds);
  const loading = useMarketplaceStore(s => s.loading);
  const refreshing = useMarketplaceStore(s => s.refreshing);
  const error = useMarketplaceStore(s => s.error);
  const actionInProgress = useMarketplaceStore(s => s.actionInProgress);
  const fetchMarketplace = useMarketplaceStore(s => s.fetchMarketplace);
  const installPlugin = useMarketplaceStore(s => s.installPlugin);
  const uninstallPlugin = useMarketplaceStore(s => s.uninstallPlugin);

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'marketplace' | 'installed' | 'submissions'>('marketplace');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [badgeFilter, setBadgeFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<MarketplaceCategory[]>([]);
  const [submitOpen, setSubmitOpen] = useState(false);

  useEffect(() => {
    void fetchMarketplace(true);
  }, [fetchMarketplace, user]);

  const isGuest = !user;

  const handleRefresh = () => {
    void fetchMarketplace(true);
  };

  const handleLockedClick = () => {
    setAuthView('telegram');
  };

  const handleInstall = (item: MarketplaceItem) => {
    void installPlugin(item.id, item.source).catch(err => {
      toast.error(
        err instanceof Error ? err.message : t('marketplace.errorToast'),
      );
    });
  };

  const handleUninstall = (item: MarketplaceItem) => {
    void uninstallPlugin(item.id, item.source).catch(err => {
      toast.error(
        err instanceof Error ? err.message : t('marketplace.errorToast'),
      );
    });
  };

  // Client-side search filter (name + description, case-insensitive) plus badge and category chip filters (OR semantics); the installed tab narrows the scope first.
  const filtered = useMemo(() => {
    let list = items;
    if (tab === 'installed') list = items.filter(i => i.installed);
    if (badgeFilter.length > 0) {
      list = list.filter(i => (i.badges ?? []).some(b => badgeFilter.includes(b)));
    }
    if (categoryFilter.length > 0) {
      list = list.filter(i => i.category != null && categoryFilter.includes(i.category));
    }
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      item =>
        item.name.toLowerCase().includes(q) ||
        (item.description?.toLowerCase().includes(q) ?? false),
    );
  }, [items, query, tab, badgeFilter, categoryFilter]);

  const toggleBadgeFilter = (key: string) => {
    setBadgeFilter(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key],
    );
  };

  const toggleCategoryFilter = (key: MarketplaceCategory) => {
    setCategoryFilter(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key],
    );
  };

  // Category chips: categories present in the current tab scope, with counts.
  const categoryCounts = useMemo(() => {
    const counts = new Map<MarketplaceCategory, number>();
    const scoped = tab === 'installed' ? items.filter(i => i.installed) : items;
    for (const item of scoped) {
      if (item.category != null) {
        counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
      }
    }
    return counts;
  }, [items, tab]);

  // Auto-select: if the selected id is not in the filtered list, fall back to
  // the first item (IDEA-style). Cleared when the list is empty.
  useEffect(() => {
    if (filtered.length > 0 && !filtered.some(i => i.id === selectedId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-select first item when current selection leaves filtered list
      setSelectedId(filtered[0].id);
    } else if (filtered.length === 0 && selectedId !== null) {
      setSelectedId(null);
    }
  }, [filtered, selectedId]);

  const selectedItem = filtered.find(i => i.id === selectedId) ?? null;

  const installedCount = items.filter(i => i.installed).length;

  // Split into INSTALLED (first) and AVAILABLE sections for the Marketplace tab.
  const installedItems = filtered.filter(i => i.installed);
  const availableItems = filtered.filter(i => !i.installed);

  const isBusy = loading || refreshing;
  const isFirstLoad = loading && items.length === 0;
  const isError = error !== null && items.length === 0;
  const isEmpty = !loading && error === null && filtered.length === 0;
  // Honest empty state: distinguish "feed fetch failed" and "nothing
  // published yet" from "no matches for the current search".
  const hasActiveSearch =
    query.trim() !== '' || badgeFilter.length > 0 || categoryFilter.length > 0;
  const feedError =
    feeds !== null && (feeds.official === 'error' || feeds.community === 'error');

  const tabOptions = [
    { label: t('marketplace.tabMarketplace'), value: 'marketplace' },
    {
      label: `${t('marketplace.tabInstalled')} · ${installedCount}`,
      value: 'installed',
    },
    ...(!isGuest
      ? [{ label: t('marketplace.mySubmissions.tab'), value: 'submissions' }]
      : []),
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('marketplace.title')}
        subtitle={t('marketplace.subtitle')}
        icon={<Store size={18} />}
        actions={
          <div className="flex items-center gap-2">
            {!isGuest && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setSubmitOpen(true)}
                leftIcon={<Upload className="w-3.5 h-3.5" />}
              >
                {t('marketplace.submit.button')}
              </Button>
            )}
            <IconButton
              onClick={handleRefresh}
              size="md"
              variant="ghost"
              aria-label={t('marketplace.refresh')}
              disabled={isBusy}
            >
              <RefreshCw size={16} className={isBusy ? 'animate-spin' : ''} />
            </IconButton>
          </div>
        }
      />

      {/* Toolbar: segmented tab control */}
      <div className="px-4 py-2 border-b border-white/[0.04] flex items-center">
        <SegmentedControl
          options={tabOptions}
          value={tab}
          onChange={v => setTab(v as 'marketplace' | 'installed')}
          size="sm"
          stretch={false}
        />
      </div>

      {/* Activation required banner (full width, above the split) */}
      {!activated && !isFirstLoad && tab !== 'submissions' && (
        <div className="mx-4 mt-3 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/80 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="leading-relaxed">
            {t('marketplace.activationRequired')}
          </span>
        </div>
      )}

      {/* My submissions (authenticated users) */}
      {tab === 'submissions' && <MySubmissionsPanel />}

      {/* Master-detail split */}
      <div className={cn('flex-1 flex min-h-0', tab === 'submissions' && 'hidden')}>
        {/* LEFT pane: search + compact list */}
        <div
          className="w-[380px] shrink-0 border-r border-white/[0.06] flex flex-col"
          data-testid="plugin-list"
        >
          <MarketplaceFilterBar
            query={query}
            onQueryChange={setQuery}
            badgeFilter={badgeFilter}
            onToggleBadge={toggleBadgeFilter}
            onClearBadges={() => setBadgeFilter([])}
            categoryFilter={categoryFilter}
            onToggleCategory={toggleCategoryFilter}
            onClearCategories={() => setCategoryFilter([])}
            categoryCounts={categoryCounts}
          />

          <MarketplaceListBody
            tab={tab}
            isFirstLoad={isFirstLoad}
            isError={isError}
            error={error}
            isEmpty={isEmpty}
            feedError={feedError}
            hasActiveSearch={hasActiveSearch}
            refreshing={refreshing}
            filtered={filtered}
            installedItems={installedItems}
            availableItems={availableItems}
            selectedId={selectedId}
            actionInProgress={actionInProgress}
            isGuest={isGuest}
            onSelect={setSelectedId}
            onInstall={handleInstall}
            onLockedClick={handleLockedClick}
            onRefresh={handleRefresh}
          />
        </div>

        {/* RIGHT pane: detail */}
        <div
          className="flex-1 min-w-0 flex flex-col"
          data-testid="plugin-detail"
        >
          {selectedItem ? (
            <PluginDetail
              item={selectedItem}
              busy={actionInProgress === selectedItem.id}
              isGuest={isGuest}
              onInstall={handleInstall}
              onUninstall={handleUninstall}
              onLockedClick={handleLockedClick}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center p-6">
              <EmptyState
                icon={Package}
                title={t('marketplace.selectPluginTitle')}
                description={t('marketplace.selectPluginText')}
              />
            </div>
          )}
        </div>
      </div>

      <SubmitPluginModal
        isOpen={submitOpen}
        onClose={() => setSubmitOpen(false)}
        onSubmitted={() => setTab('submissions')}
      />
    </div>
  );
}
