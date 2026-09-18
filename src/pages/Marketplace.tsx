import { useEffect, useMemo, useState } from 'react';
import {
  Store,
  RefreshCw,
  Search,
  Lock,
  Package,
  Download,
  Check,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/layout/Header';
import { GlassCard } from '@/components/ui/GlassCard';
import { IconButton } from '@/components/ui/IconButton';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { ButtonBase } from '@/components/ui/ButtonBase';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { TierBadge } from '@/components/ui/TierBadge';
import { Tooltip } from '@/components/ui/Tooltip';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { KeyValueList } from '@/components/ui/KeyValueList';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import { useMarketplaceStore } from '../stores/marketplace';
import type { MarketplaceItem } from '@/lib/backend/modules/marketplace';

// ============================================
// Helpers
// ============================================

/** Two-letter initials from a plugin name, for the icon block. */
function getInitials(name: string): string {
  const parts = name.trim().split(/[\s_-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Stable color from a string hash, for the icon block background. */
function getIconColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 60% 45%)`;
}

// ============================================
// Compact list row (left pane)
// ============================================

interface ListRowProps {
  item: MarketplaceItem;
  selected: boolean;
  busy: boolean;
  isGuest: boolean;
  onSelect: (id: string) => void;
  onInstall: (item: MarketplaceItem) => void;
  onLockedClick: () => void;
}

function MarketplaceListRow({ item, selected, busy, isGuest, onSelect, onInstall, onLockedClick }: ListRowProps) {
  const locked = !item.can_download && !item.installed;
  const unavailableMsg = t('marketplace.unavailableForRole');
  const lockLabel = isGuest ? t('marketplace.authRequiredTooltip') : unavailableMsg;
  const tooltipMsg = isGuest
    ? lockLabel
    : item.required_tier
      ? t('marketplace.requiresTierNote', { tier: t(`auth.role.${item.required_tier}`) })
      : unavailableMsg;

  const handleLockedClick = () => {
    if (isGuest) {
      onLockedClick();
    } else {
      toast.error(unavailableMsg);
    }
  };

  const hasUpdate =
    item.installed &&
    item.installed_version !== null &&
    item.version !== null &&
    item.installed_version !== item.version;

  // Line 2: "version · author", fallback to item.id when both null.
  const versionAuthor =
    [item.version, item.author].filter(Boolean).join(' · ') || item.id;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(item.id)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(item.id);
        }
      }}
      className={cn(
        'flex items-center gap-3 px-3 py-2 border-b border-white/[0.04] transition-colors cursor-pointer',
        selected
          ? 'bg-indigo-500/[0.12] ring-1 ring-inset ring-indigo-500/30'
          : 'hover:bg-white/[0.03]',
        locked && 'opacity-50 saturate-50',
      )}
    >
      {/* Icon tile */}
      <div
        className="w-9 h-9 rounded-md flex items-center justify-center shrink-0 text-xs font-bold text-white/90"
        style={{ backgroundColor: getIconColor(item.id) }}
        aria-hidden="true"
      >
        {getInitials(item.name)}
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-slate-100 truncate">
            {item.name}
          </span>
          {locked && (
            <Lock
              className="w-3 h-3 text-slate-500 shrink-0"
              aria-label={lockLabel}
            />
          )}
          {!item.entitled && item.required_tier && (
            <TierBadge tier={item.required_tier} size="sm" className="shrink-0" />
          )}
        </div>
        <div className="text-[11px] text-slate-500 truncate mt-0.5">
          {versionAuthor}
        </div>
      </div>

      {/* Action button — stopPropagation so clicking it doesn't select the row */}
      <div className="shrink-0" onClick={e => e.stopPropagation()}>
        {locked ? (
          <Tooltip content={tooltipMsg} side="left">
            <span>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleLockedClick}
                disabled={!isGuest}
                leftIcon={<Lock className="w-3.5 h-3.5" />}
                title={lockLabel}
              >
                {t('marketplace.install')}
              </Button>
            </span>
          </Tooltip>
        ) : !item.installed ? (
          <Button
            size="sm"
            variant="primary"
            onClick={() => onInstall(item)}
            isLoading={busy}
            disabled={busy}
            leftIcon={!busy ? <Download className="w-3.5 h-3.5" /> : undefined}
          >
            {busy ? t('marketplace.installing') : t('marketplace.install')}
          </Button>
        ) : hasUpdate ? (
          <Button
            size="sm"
            variant="purple"
            onClick={() => onInstall(item)}
            isLoading={busy}
            disabled={busy}
            leftIcon={!busy ? <Download className="w-3.5 h-3.5" /> : undefined}
          >
            {busy ? t('marketplace.installing') : t('marketplace.update')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            disabled
            leftIcon={<Check className="w-3.5 h-3.5" />}
          >
            {t('marketplace.installed')}
          </Button>
        )}
      </div>
    </div>
  );
}

// ============================================
// Detail pane (right pane)
// ============================================

interface DetailProps {
  item: MarketplaceItem;
  busy: boolean;
  isGuest: boolean;
  onInstall: (item: MarketplaceItem) => void;
  onUninstall: (item: MarketplaceItem) => void;
  onLockedClick: () => void;
}

function PluginDetail({ item, busy, isGuest, onInstall, onUninstall, onLockedClick }: DetailProps) {
  const [detailTab, setDetailTab] = useState<'overview' | 'info'>('overview');

  const locked = !item.can_download && !item.installed;
  const hasUpdate =
    item.installed &&
    item.installed_version !== null &&
    item.version !== null &&
    item.installed_version !== item.version;

  const sourceLabel =
    item.source === 'official'
      ? t('marketplace.sourceOfficial')
      : t('marketplace.sourceCommunity');

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 max-w-3xl">
        {/* Title row */}
        <div className="flex items-start gap-3 flex-wrap mb-2">
          <h2 className="text-xl font-semibold text-white">{item.name}</h2>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <Badge
              variant={item.source === 'official' ? 'info' : 'outline'}
              size="sm"
            >
              {sourceLabel}
            </Badge>
            {!item.entitled && item.required_tier && (
              <TierBadge tier={item.required_tier} size="sm" />
            )}
            {item.installed && (
              <Badge variant="success" size="sm">
                {t('marketplace.installed')}
              </Badge>
            )}
          </div>
        </div>

        {/* Meta line */}
        <div className="text-xs text-slate-500 mb-4">
          {[item.author, sourceLabel].filter(Boolean).join(' · ')}
        </div>

        {/* Action row */}
        <div className="flex items-center gap-2 mb-6">
          {locked ? (
            isGuest ? (
              <Tooltip content={t('marketplace.authRequiredTooltip')}>
                <span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={onLockedClick}
                    leftIcon={<Lock className="w-3.5 h-3.5" />}
                  >
                    {t('marketplace.install')}
                  </Button>
                </span>
              </Tooltip>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled
                leftIcon={<Lock className="w-3.5 h-3.5" />}
              >
                {t('marketplace.install')}
              </Button>
            )
          ) : !item.installed ? (
            <Button
              size="sm"
              variant="primary"
              onClick={() => onInstall(item)}
              isLoading={busy}
              disabled={busy}
              leftIcon={!busy ? <Download className="w-3.5 h-3.5" /> : undefined}
            >
              {busy ? t('marketplace.installing') : t('marketplace.install')}
            </Button>
          ) : hasUpdate ? (
            <Button
              size="sm"
              variant="purple"
              onClick={() => onInstall(item)}
              isLoading={busy}
              disabled={busy}
              leftIcon={!busy ? <Download className="w-3.5 h-3.5" /> : undefined}
            >
              {busy ? t('marketplace.installing') : t('marketplace.update')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled
              leftIcon={<Check className="w-3.5 h-3.5" />}
            >
              {t('marketplace.installed')}
            </Button>
          )}

          {item.installed && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => onUninstall(item)}
              isLoading={busy}
              disabled={busy}
              leftIcon={!busy ? <Trash2 className="w-3.5 h-3.5" /> : undefined}
            >
              {busy ? t('marketplace.removing') : t('marketplace.remove')}
            </Button>
          )}

          {/* Version text */}
          <div className="ml-auto text-xs">
            {hasUpdate ? (
              <span className="text-indigo-300">
                {item.installed_version} → {item.version}
              </span>
            ) : item.version ? (
              // eslint-disable-next-line i18next/no-literal-string -- "v" version prefix is non-translatable
              <span className="text-slate-500">v{item.version}</span>
            ) : null}
          </div>
        </div>

        {locked && item.required_tier && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/15 text-amber-300/80 text-xs">
            <Lock className="w-3.5 h-3.5 shrink-0" />
            <span className="leading-relaxed">
              {t('marketplace.requiresTierNote', { tier: t(`auth.role.${item.required_tier}`) })}
            </span>
          </div>
        )}

        {/* Underline tabs */}
        <div className="flex items-center gap-1 border-b border-white/[0.06] mb-4">
          <ButtonBase
            type="button"
            onClick={() => setDetailTab('overview')}
            className={cn(
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              detailTab === 'overview'
                ? 'border-indigo-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200',
            )}
          >
            {t('marketplace.overviewTab')}
          </ButtonBase>
          <ButtonBase
            type="button"
            onClick={() => setDetailTab('info')}
            className={cn(
              'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              detailTab === 'info'
                ? 'border-indigo-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200',
            )}
          >
            {t('marketplace.infoTab')}
          </ButtonBase>
        </div>

        {/* Tab content */}
        {detailTab === 'overview' ? (
          <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
            {item.description ?? (
              <span className="text-slate-500 italic">
                {t('marketplace.noDescription')}
              </span>
            )}
          </div>
        ) : (
          <KeyValueList
            density="comfortable"
            rows={[
              {
                id: 'id',
                label: t('marketplace.idLabel'),
                value: item.id,
              },
              {
                id: 'source',
                label: t('marketplace.sourceLabel'),
                value: sourceLabel,
              },
              {
                id: 'author',
                label: t('marketplace.authorLabel'),
                value: item.author ?? '—',
              },
              {
                id: 'version',
                label: t('marketplace.versionLabel'),
                value: item.version ?? '—',
              },
              {
                id: 'installed-version',
                label: t('marketplace.installedVersionLabel'),
                value: item.installed_version ?? '—',
              },
              {
                id: 'access',
                label: t('marketplace.accessLabel'),
                value: item.entitled
                  ? t('marketplace.accessGranted')
                  : t('marketplace.unavailableForRole'),
                tone: item.entitled ? 'success' : 'danger',
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}

// ============================================
// Page
// ============================================

export default function Marketplace() {
  const language = useAppStore(s => s.language);
  void language; // force re-render on locale change (t() is not reactive)

  const user = useAuthStore(s => s.user);
  const setAuthView = useAuthStore(s => s.setAuthView);

  const items = useMarketplaceStore(s => s.items);
  const activated = useMarketplaceStore(s => s.activated);
  const loading = useMarketplaceStore(s => s.loading);
  const refreshing = useMarketplaceStore(s => s.refreshing);
  const error = useMarketplaceStore(s => s.error);
  const actionInProgress = useMarketplaceStore(s => s.actionInProgress);
  const fetchMarketplace = useMarketplaceStore(s => s.fetchMarketplace);
  const installPlugin = useMarketplaceStore(s => s.installPlugin);
  const uninstallPlugin = useMarketplaceStore(s => s.uninstallPlugin);

  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'marketplace' | 'installed'>('marketplace');
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  // Client-side search filter (name + description, case-insensitive).
  // On the "installed" tab, only installed items are considered.
  const filtered = useMemo(() => {
    let list = items;
    if (tab === 'installed') list = items.filter(i => i.installed);
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      item =>
        item.name.toLowerCase().includes(q) ||
        (item.description?.toLowerCase().includes(q) ?? false),
    );
  }, [items, query, tab]);

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

  const tabOptions = [
    { label: t('marketplace.tabMarketplace'), value: 'marketplace' },
    {
      label: `${t('marketplace.tabInstalled')} · ${installedCount}`,
      value: 'installed',
    },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('marketplace.title')}
        subtitle={t('marketplace.subtitle')}
        icon={<Store size={18} />}
        actions={
          <IconButton
            onClick={handleRefresh}
            size="md"
            variant="ghost"
            aria-label={t('marketplace.refresh')}
            disabled={isBusy}
          >
            <RefreshCw size={16} className={isBusy ? 'animate-spin' : ''} />
          </IconButton>
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
      {!activated && !isFirstLoad && (
        <div className="mx-4 mt-3 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/80 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="leading-relaxed">
            {t('marketplace.activationRequired')}
          </span>
        </div>
      )}

      {/* Master-detail split */}
      <div className="flex-1 flex min-h-0">
        {/* LEFT pane: search + compact list */}
        <div
          className="w-[380px] shrink-0 border-r border-white/[0.06] flex flex-col"
          data-testid="plugin-list"
        >
          {/* Search input */}
          <div className="p-3 border-b border-white/[0.04]">
            <Input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('marketplace.searchPlaceholder')}
              leftIcon={<Search className="w-4 h-4" />}
            />
          </div>

          {/* Scrollable list */}
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
                  <Button variant="secondary" size="sm" onClick={handleRefresh}>
                    {t('marketplace.refresh')}
                  </Button>
                </GlassCard>
              </div>
            )}

            {/* Empty state */}
            {isEmpty && (
              <div className="p-6">
                <EmptyState
                  icon={Package}
                  title={t('marketplace.emptyTitle')}
                  description={t('marketplace.emptyDescription')}
                />
              </div>
            )}

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
                            onSelect={setSelectedId}
                            onInstall={handleInstall}
                            onLockedClick={handleLockedClick}
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
                            onSelect={setSelectedId}
                            onInstall={handleInstall}
                            onLockedClick={handleLockedClick}
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
                      onSelect={setSelectedId}
                      onInstall={handleInstall}
                      onLockedClick={handleLockedClick}
                    />
                  ))
                )}
              </div>
            )}
          </div>
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
    </div>
  );
}
