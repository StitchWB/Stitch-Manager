import { useEffect, useMemo, useState } from 'react';
import { Store, RefreshCw, Search, Lock, Package, Download, Trash2, AlertTriangle, Send } from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/layout/Header';
import { GlassCard } from '@/components/ui/GlassCard';
import { IconButton } from '@/components/ui/IconButton';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { TierBadge } from '@/components/ui/TierBadge';
import { Tooltip } from '@/components/ui/Tooltip';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { isDesktopApp } from '@/lib/backend/core/url';
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
// Row component
// ============================================

interface RowProps {
  item: MarketplaceItem;
  busy: boolean;
  browseOnly: boolean;
  onInstall: (item: MarketplaceItem) => void;
  onRemove: (item: MarketplaceItem) => void;
}

function MarketplaceRow({ item, busy, browseOnly, onInstall, onRemove }: RowProps) {
  const locked = !item.can_download && !item.installed;
  const unavailableMsg = t('marketplace.unavailableForRole');
  const desktopOnlyMsg = t('marketplace.desktopOnly');

  const handleLockedClick = () => {
    toast.error(unavailableMsg);
  };

  const versionDiff =
    item.installed_version !== null &&
    item.version !== null &&
    item.installed_version !== item.version;

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] transition-colors',
        locked && 'opacity-50 saturate-50',
        !locked && 'hover:bg-white/[0.02]'
      )}
    >
      {/* Icon block */}
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold text-white/90"
        style={{ backgroundColor: getIconColor(item.id) }}
        aria-hidden="true"
      >
        {getInitials(item.name)}
      </div>

      {/* Name + badges + description */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-100 truncate">
            {item.name}
          </span>
          {locked && (
            <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-label={unavailableMsg} />
          )}
          {!item.entitled && item.required_tier && (
            <TierBadge tier={item.required_tier} size="sm" className="shrink-0" />
          )}
          <Badge
            variant={item.source === 'official' ? 'info' : 'outline'}
            size="sm"
          >
            {item.source === 'official'
              ? t('marketplace.sourceOfficial')
              : t('marketplace.sourceCommunity')}
          </Badge>
          {item.installed && (
            <Badge variant="success" size="sm">
              {t('marketplace.installedVersionLabel')}
            </Badge>
          )}
        </div>
        {item.description && (
          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 leading-relaxed">
            {item.description}
          </p>
        )}
        {/* Version line */}
        {(item.version || item.installed_version) && (
          <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-600 font-mono">
            {item.version && (
              <span>
                {t('marketplace.versionLabel')}: {item.version}
              </span>
            )}
            {versionDiff && item.installed_version && (
              <span className="text-amber-400/70">
                · {t('marketplace.installedVersionLabel')}: {item.installed_version}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Action button */}
      <div className="shrink-0">
        {browseOnly ? (
          <Tooltip content={desktopOnlyMsg} side="left">
            <span>
              <Button
                size="sm"
                variant="secondary"
                disabled
                leftIcon={<Lock className="w-3.5 h-3.5" />}
              >
                {item.installed ? t('marketplace.remove') : t('marketplace.install')}
              </Button>
            </span>
          </Tooltip>
        ) : item.installed ? (
          <Button
            size="sm"
            variant="danger"
            onClick={() => onRemove(item)}
            isLoading={busy}
            disabled={busy}
            leftIcon={!busy ? <Trash2 className="w-3.5 h-3.5" /> : undefined}
          >
            {busy ? t('marketplace.removing') : t('marketplace.remove')}
          </Button>
        ) : locked ? (
          <Tooltip content={unavailableMsg} side="left">
            <span>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleLockedClick}
                disabled
                leftIcon={<Lock className="w-3.5 h-3.5" />}
                title={unavailableMsg}
              >
                {t('marketplace.install')}
              </Button>
            </span>
          </Tooltip>
        ) : (
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

  const browseOnly = !isDesktopApp();

  useEffect(() => {
    if (!user) return;
    void fetchMarketplace(true);
  }, [fetchMarketplace, user]);

  const handleRefresh = () => {
    void fetchMarketplace(true);
  };

  const handleInstall = (item: MarketplaceItem) => {
    void installPlugin(item.id, item.source).catch(err => {
      toast.error(
        err instanceof Error ? err.message : t('marketplace.errorToast'),
      );
    });
  };

  const handleRemove = (item: MarketplaceItem) => {
    void uninstallPlugin(item.id, item.source).catch(err => {
      toast.error(
        err instanceof Error ? err.message : t('marketplace.errorToast'),
      );
    });
  };

  // Client-side search filter (name + description, case-insensitive).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      item =>
        item.name.toLowerCase().includes(q) ||
        (item.description?.toLowerCase().includes(q) ?? false),
    );
  }, [items, query]);

  // Auth gate: unauthenticated visitors (no session user) see a lock screen
  // instead of the plugin list. getMarketplace is not called.
  if (!user) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <Header
          title={t('marketplace.title')}
          subtitle={t('marketplace.subtitle')}
          icon={<Store size={18} />}
        />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md">
            <div className="rounded-2xl border border-white/[0.06] bg-black/40 backdrop-blur-2xl shadow-2xl shadow-indigo-950/40 overflow-hidden">
              {/* Top accent line */}
              <div className="h-px w-full bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent" />
              <div className="px-8 pt-10 pb-8">
                {/* Icon + title + text */}
                <div className="flex flex-col items-center text-center mb-8">
                  <div className="rounded-xl w-12 h-12 flex items-center justify-center mb-4 bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-xl shadow-indigo-900/40">
                    <Lock className="w-6 h-6 text-white" />
                  </div>
                  <h2 className="text-white text-xl font-black tracking-tight uppercase">
                    {t('marketplace.authRequiredTitle')}
                  </h2>
                  <p className="text-slate-400 text-sm mt-1 leading-relaxed px-2">
                    {t('marketplace.authRequiredText')}
                  </p>
                </div>

                {/* Primary: password login */}
                <button
                  type="button"
                  onClick={() => setAuthView('login')}
                  className={cn(
                    'w-full h-10 rounded-lg font-medium text-sm transition-all duration-200 select-none',
                    'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-900/40',
                    'hover:from-indigo-400 hover:to-indigo-500 hover:shadow-indigo-900/60 active:scale-[0.98]',
                    'flex items-center justify-center gap-2'
                  )}
                >
                  {t('auth.guest.login')}
                </button>

                {/* Secondary: Telegram login */}
                <button
                  type="button"
                  onClick={() => setAuthView('telegram')}
                  className={cn(
                    'w-full h-10 mt-3 rounded-lg font-medium text-sm transition-all duration-200 select-none',
                    'bg-white/[0.03] border border-white/[0.06] text-slate-200',
                    'hover:bg-white/[0.05] hover:border-white/[0.10] active:scale-[0.98]',
                    'flex items-center justify-center gap-2'
                  )}
                >
                  <Send className="w-4 h-4" />
                  {t('auth.login.tgLink')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Split into INSTALLED (first) and AVAILABLE sections.
  const installedItems = filtered.filter(i => i.installed);
  const availableItems = filtered.filter(i => !i.installed);

  const isBusy = loading || refreshing;
  const isFirstLoad = loading && items.length === 0;
  const isError = error !== null && items.length === 0;
  const isEmpty = !loading && error === null && filtered.length === 0;

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

      {/* Search bar */}
      <div className="px-4 py-3 border-b border-white/[0.04] flex items-center gap-2">
        <div className="relative flex-1 max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('marketplace.searchPlaceholder')}
            className="w-full h-9 pl-9 pr-3 text-sm text-slate-200 bg-white/[0.03] border border-white/10 rounded-lg placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/40 focus:bg-white/[0.05] transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Activation required banner */}
        {!activated && !isFirstLoad && (
          <div className="mx-4 mt-3 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300/80 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="leading-relaxed">
              {t('marketplace.activationRequired')}
            </span>
          </div>
        )}

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
              <p className="text-sm text-slate-300">{t('marketplace.loadError')}</p>
              <p className="text-xs text-slate-500 max-w-md text-center">{error}</p>
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
              refreshing && 'opacity-60 pointer-events-none'
            )}
          >
            {/* INSTALLED section */}
            {installedItems.length > 0 && (
              <section>
                <h2 className="px-4 pt-4 pb-1 text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                  {t('marketplace.installedSection')} · {installedItems.length}
                </h2>
                {installedItems.map(item => (
                  <MarketplaceRow
                    key={item.id}
                    item={item}
                    busy={actionInProgress === item.id}
                    browseOnly={browseOnly}
                    onInstall={handleInstall}
                    onRemove={handleRemove}
                  />
                ))}
              </section>
            )}

            {/* AVAILABLE section */}
            {availableItems.length > 0 && (
              <section>
                <h2 className="px-4 pt-4 pb-1 text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                  {t('marketplace.availableSection')} · {availableItems.length}
                </h2>
                {availableItems.map(item => (
                  <MarketplaceRow
                    key={item.id}
                    item={item}
                    busy={actionInProgress === item.id}
                    browseOnly={browseOnly}
                    onInstall={handleInstall}
                    onRemove={handleRemove}
                  />
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
