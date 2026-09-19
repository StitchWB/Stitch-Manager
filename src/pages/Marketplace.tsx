import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Star,
  ShieldCheck,
  XCircle,
  Upload,
  Inbox,
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
import { Modal } from '@/components/ui/Modal';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { openFileDialog } from '@/lib/fileDialog';
import { isDesktopApp } from '@/lib/backend/core/url';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import { useMarketplaceStore } from '../stores/marketplace';
import type { MarketplaceItem } from '@/lib/backend/modules/marketplace';
import {
  submitPlugin,
  mySubmissions,
  type GateReport,
  type PluginSubmissionSummary,
} from '@/lib/backend/modules/submissions';

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
// Plugin badges
// ============================================

interface BadgeDef {
  key: string;
  icon: typeof Star;
  chipClass: string;
  labelKey: string;
  tooltipKey?: string;
}

const BADGE_DEFS: BadgeDef[] = [
  {
    key: 'recommended',
    icon: Star,
    chipClass: 'bg-amber-500/10 text-amber-300',
    labelKey: 'marketplace.badgeRecommended',
  },
  {
    key: 'verified',
    icon: ShieldCheck,
    chipClass: 'bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-500/30',
    labelKey: 'marketplace.badgeVerified',
    tooltipKey: 'marketplace.badgeVerifiedTooltip',
  },
  {
    key: 'works',
    icon: Check,
    chipClass: 'bg-emerald-500/10 text-emerald-300',
    labelKey: 'marketplace.badgeWorks',
  },
  {
    key: 'not_works',
    icon: XCircle,
    chipClass: 'bg-red-500/10 text-red-300',
    labelKey: 'marketplace.badgeNotWorks',
  },
];

interface PluginBadgeChipsProps {
  badges: string[] | undefined;
  /** Icon-only chips with tooltips (compact list rows). */
  iconOnly?: boolean;
  className?: string;
}

function PluginBadgeChips({ badges, iconOnly = false, className }: PluginBadgeChipsProps) {
  const known = BADGE_DEFS.filter(d => (badges ?? []).includes(d.key));
  if (known.length === 0) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 min-w-0', className)}>
      {known.map(d => {
        const Icon = d.icon;
        const chip = (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide leading-none shrink-0',
              d.chipClass,
            )}
          >
            <Icon className="w-2.5 h-2.5" aria-hidden="true" />
            {!iconOnly && t(d.labelKey)}
          </span>
        );
        const tooltip = d.tooltipKey ? t(d.tooltipKey) : iconOnly ? t(d.labelKey) : null;
        return tooltip ? (
          <Tooltip key={d.key} content={tooltip} side="top">
            <span className="inline-flex shrink-0">{chip}</span>
          </Tooltip>
        ) : (
          <span key={d.key} className="inline-flex shrink-0">{chip}</span>
        );
      })}
    </span>
  );
}

/** Submission review-status chip; rejected carries the reason in a tooltip. */
function SubmissionStatusChip({ status, reason }: { status: string; reason?: string | null }) {
  const map: Record<string, { variant: 'success' | 'warning' | 'danger' | 'slate'; labelKey: string }> = {
    pending: { variant: 'warning', labelKey: 'marketplace.mySubmissions.statusPending' },
    approved: { variant: 'success', labelKey: 'marketplace.mySubmissions.statusApproved' },
    rejected: { variant: 'danger', labelKey: 'marketplace.mySubmissions.statusRejected' },
    delisted: { variant: 'slate', labelKey: 'marketplace.mySubmissions.statusDelisted' },
  };
  const entry = map[status];
  const chip = (
    <Badge variant={entry?.variant ?? 'default'} size="sm">
      {entry ? t(entry.labelKey) : status}
    </Badge>
  );
  if (status === 'rejected' && reason) {
    return (
      <Tooltip content={`${t('marketplace.mySubmissions.rejectionReason')}: ${reason}`} side="top">
        <span className="inline-flex">{chip}</span>
      </Tooltip>
    );
  }
  return chip;
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
        !locked && (item.badges ?? []).includes('not_works') && 'opacity-60 saturate-[0.6]',
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
          <PluginBadgeChips badges={item.badges} iconOnly className="shrink-0" />
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
            <PluginBadgeChips badges={item.badges} />
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
  const [tab, setTab] = useState<'marketplace' | 'installed' | 'submissions'>('marketplace');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [badgeFilter, setBadgeFilter] = useState<string[]>([]);
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

  // Client-side search filter (name + description, case-insensitive) plus
  // the badge chip filter (OR semantics: item matches any active badge).
  // On the "installed" tab, only installed items are considered.
  const filtered = useMemo(() => {
    let list = items;
    if (tab === 'installed') list = items.filter(i => i.installed);
    if (badgeFilter.length > 0) {
      list = list.filter(i => (i.badges ?? []).some(b => badgeFilter.includes(b)));
    }
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      item =>
        item.name.toLowerCase().includes(q) ||
        (item.description?.toLowerCase().includes(q) ?? false),
    );
  }, [items, query, tab, badgeFilter]);

  const toggleBadgeFilter = (key: string) => {
    setBadgeFilter(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key],
    );
  };

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
          {/* Search input + badge filter chips */}
          <div className="p-3 border-b border-white/[0.04] flex flex-col gap-2">
            <Input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('marketplace.searchPlaceholder')}
              leftIcon={<Search className="w-4 h-4" />}
            />
            <div className="flex items-center gap-1.5 flex-wrap">
              <ButtonBase
                type="button"
                onClick={() => setBadgeFilter([])}
                aria-pressed={badgeFilter.length === 0}
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
                  badgeFilter.length === 0
                    ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-500/40'
                    : 'bg-white/[0.03] text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]',
                )}
              >
                {t('marketplace.badgeFilterAll')}
              </ButtonBase>
              {BADGE_DEFS.map(d => {
                const Icon = d.icon;
                const active = badgeFilter.includes(d.key);
                return (
                  <ButtonBase
                    key={d.key}
                    type="button"
                    onClick={() => toggleBadgeFilter(d.key)}
                    aria-pressed={active}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
                      active
                        ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-500/40'
                        : 'bg-white/[0.03] text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]',
                    )}
                  >
                    <Icon className="w-3 h-3" aria-hidden="true" />
                    {t(d.labelKey)}
                  </ButtonBase>
                );
              })}
            </div>
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

      <SubmitPluginModal
        isOpen={submitOpen}
        onClose={() => setSubmitOpen(false)}
        onSubmitted={() => setTab('submissions')}
      />
    </div>
  );
}

// ============================================
// Submit plugin modal
// ============================================

type SubmitTab = 'release' | 'upload';

const SHA256_RE = /^[0-9a-fA-F]{64}$/;

interface SubmitPluginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitted: () => void;
}

function SubmitPluginModal({ isOpen, onClose, onSubmitted }: SubmitPluginModalProps) {
  const [tab, setTab] = useState<SubmitTab>('release');
  const [pluginId, setPluginId] = useState('');
  const [version, setVersion] = useState('');
  const [domains, setDomains] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sha256, setSha256] = useState('');
  const [zipPath, setZipPath] = useState('');
  const [zipError, setZipError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [gateReport, setGateReport] = useState<GateReport | null>(null);

  const desktop = isDesktopApp();

  const reset = useCallback(() => {
    setTab('release');
    setPluginId('');
    setVersion('');
    setDomains('');
    setSourceUrl('');
    setSha256('');
    setZipPath('');
    setZipError(null);
    setFormError(null);
    setGateReport(null);
  }, []);

  const handleClose = useCallback(() => {
    if (submitting) return;
    reset();
    onClose();
  }, [submitting, reset, onClose]);

  const handlePickZip = useCallback(async () => {
    setZipError(null);
    try {
      const selected = await openFileDialog({
        title: t('marketplace.submit.pickZip'),
        filters: [{ name: 'Zip', extensions: ['zip'] }],
      });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (path) setZipPath(path);
    } catch (err) {
      setZipError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    setFormError(null);
    setGateReport(null);
    const pid = pluginId.trim();
    const ver = version.trim();
    if (!pid || !ver) {
      setFormError(t('marketplace.submit.requiredFields'));
      return;
    }
    if (tab === 'release') {
      if (!sourceUrl.trim() || !sha256.trim()) {
        setFormError(t('marketplace.submit.requiredRelease'));
        return;
      }
      if (!SHA256_RE.test(sha256.trim())) {
        setFormError(t('marketplace.submit.invalidSha'));
        return;
      }
    } else if (!zipPath) {
      setFormError(t('marketplace.submit.requiredZip'));
      return;
    }

    const declaredDomains = domains
      .split(/[\s,]+/)
      .map(d => d.trim())
      .filter(Boolean);

    setSubmitting(true);
    try {
      const result = await submitPlugin({
        source_type: tab,
        plugin_id: pid,
        version: ver,
        declared_domains: declaredDomains,
        ...(tab === 'release'
          ? { source_url: sourceUrl.trim(), sha256: sha256.trim() }
          : { zip_path: zipPath }),
      });
      if (result.success) {
        toast.success(
          t('marketplace.submit.success', { id: result.submission_id ?? '—' }),
        );
        reset();
        onClose();
        onSubmitted();
      } else {
        // The picker convention (backend dialog → local path) exposes no file
        // size to JS, so the 5 MB cap is enforced by submit_plugin; map its
        // error to the localized oversize message.
        const errText = result.error ?? '';
        if (tab === 'upload' && /5\s*MB/i.test(errText)) {
          setFormError(t('marketplace.submit.zipTooLarge'));
        } else {
          setFormError(errText || t('marketplace.submit.failed'));
        }
        const gates = result.gate_report?.gates;
        if (gates) setGateReport(gates);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('marketplace.submit.failed'));
    } finally {
      setSubmitting(false);
    }
  }, [pluginId, version, tab, sourceUrl, sha256, zipPath, domains, reset, onClose, onSubmitted]);

  const failedGates = useMemo(
    () => Object.entries(gateReport ?? {}).filter(([, g]) => !g?.pass),
    [gateReport],
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('marketplace.submit.title')}
      icon={<Upload size={18} />}
      size="md"
      isLoading={submitting}
      loadingMessage={t('marketplace.submit.submitting')}
      footer={
        <div className="flex items-center justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={handleClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={submitting}
          >
            {submitting ? t('marketplace.submit.submitting') : t('marketplace.submit.submit')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <SegmentedControl
          options={[
            { label: t('marketplace.submit.tabRelease'), value: 'release' },
            { label: t('marketplace.submit.tabUpload'), value: 'upload' },
          ]}
          value={tab}
          onChange={v => setTab(v as SubmitTab)}
          size="sm"
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label={t('marketplace.submit.pluginId')}
            value={pluginId}
            onChange={e => setPluginId(e.target.value)}
            placeholder={t('marketplace.submit.pluginIdPh')}
            disabled={submitting}
          />
          <Input
            label={t('marketplace.submit.version')}
            value={version}
            onChange={e => setVersion(e.target.value)}
            placeholder={t('marketplace.submit.versionPh')}
            disabled={submitting}
          />
        </div>

        {tab === 'release' ? (
          <>
            <Input
              label={t('marketplace.submit.releaseUrl')}
              value={sourceUrl}
              onChange={e => setSourceUrl(e.target.value)}
              placeholder={t('marketplace.submit.releaseUrlPh')}
              disabled={submitting}
            />
            <Input
              label={t('marketplace.submit.sha256')}
              value={sha256}
              onChange={e => setSha256(e.target.value)}
              placeholder={t('marketplace.submit.sha256Ph')}
              disabled={submitting}
              className="font-mono"
            />
          </>
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-400">
              {t('marketplace.submit.zip')}
            </span>
            <div className="flex items-center gap-2">
              <Input
                value={zipPath}
                readOnly
                placeholder={desktop ? '' : t('marketplace.submit.zipDesktopOnly')}
                containerClassName="flex-1"
                className="font-mono text-xs"
                disabled={submitting}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handlePickZip()}
                disabled={submitting || !desktop}
              >
                {t('marketplace.submit.pickZip')}
              </Button>
            </div>
            {!desktop && (
              <p className="text-xs text-amber-300/80">
                {t('marketplace.submit.zipDesktopOnly')}
              </p>
            )}
            {zipError && <p className="text-xs text-red-300">{zipError}</p>}
          </div>
        )}

        <Input
          label={t('marketplace.submit.domains')}
          value={domains}
          onChange={e => setDomains(e.target.value)}
          placeholder={t('marketplace.submit.domainsPh')}
          hint={t('marketplace.submit.domainsHint')}
          disabled={submitting}
        />

        {formError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300 leading-relaxed break-words">{formError}</p>
          </div>
        )}

        {failedGates.length > 0 && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5">
            <p className="text-xs font-semibold text-red-300 mb-1.5">
              {t('marketplace.submit.gateFailures')}
            </p>
            <ul className="space-y-1">
              {failedGates.map(([name, gate]) => (
                <li key={name} className="text-xs text-red-300/90 leading-relaxed">
                  {/* eslint-disable-next-line i18next/no-literal-string -- gate name is a non-translatable backend token */}
                  <span className="font-mono text-red-400">{name}</span>: {gate?.detail}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ============================================
// My submissions panel
// ============================================

function MySubmissionsPanel() {
  const [submissions, setSubmissions] = useState<PluginSubmissionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await mySubmissions();
      if (result.success) {
        setSubmissions(result.submissions ?? []);
      } else {
        setSubmissions(null);
        setError(result.error ?? t('marketplace.mySubmissions.loadError'));
      }
    } catch (err) {
      setSubmissions(null);
      setError(err instanceof Error ? err.message : t('marketplace.mySubmissions.loadError'));
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount; loading flag starts true for immediate spinner
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex-1 overflow-y-auto min-h-0">
      <div className="p-4 max-w-3xl mx-auto w-full">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-white">
            {t('marketplace.mySubmissions.title')}
          </h2>
          <IconButton
            onClick={() => void load()}
            size="md"
            variant="ghost"
            aria-label={t('marketplace.mySubmissions.refresh')}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </IconButton>
        </div>

        {loading && submissions === null ? (
          <div className="p-6 flex items-center justify-center">
            <LoadingSpinner size="md" />
            <span className="ml-2 text-sm text-slate-500">{t('common.loading')}</span>
          </div>
        ) : error !== null ? (
          <GlassCard className="p-6 flex flex-col items-center gap-3">
            <p className="text-sm text-slate-300">
              {t('marketplace.mySubmissions.loadError')}
            </p>
            <p className="text-xs text-slate-500 max-w-md text-center break-words">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              {t('marketplace.mySubmissions.refresh')}
            </Button>
          </GlassCard>
        ) : submissions !== null && submissions.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title={t('marketplace.mySubmissions.empty')}
            description={t('marketplace.mySubmissions.emptyDesc')}
          />
        ) : (
          <div
            className={cn(
              'rounded-xl border border-white/[0.06] bg-black/40 backdrop-blur-sm overflow-hidden transition-opacity',
              loading && 'opacity-60 pointer-events-none',
            )}
          >
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-2 border-b border-white/[0.06] text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              <span>{t('marketplace.mySubmissions.colPlugin')}</span>
              <span>{t('marketplace.mySubmissions.colStatus')}</span>
              <span>{t('marketplace.mySubmissions.colDate')}</span>
            </div>
            {(submissions ?? []).map(s => (
              <div
                key={s.id}
                className="grid grid-cols-[1fr_auto_auto] gap-3 items-center px-4 py-2.5 border-b border-white/[0.04] last:border-0"
              >
                <div className="min-w-0">
                  {/* eslint-disable-next-line i18next/no-literal-string -- non-translatable plugin id/version token */}
                  <span className="text-[13px] text-slate-200 font-mono truncate block">
                    {s.plugin_id}@{s.version}
                  </span>
                  {/* eslint-disable-next-line i18next/no-literal-string -- non-translatable submission id token */}
                  <span className="text-[11px] text-slate-500">#{s.id}</span>
                </div>
                <SubmissionStatusChip status={s.review_status} reason={s.rejection_reason} />
                <span className="text-xs text-slate-500 tabular-nums">
                  {s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
