/**
 * Public plugin catalog — /store.
 *
 * Rendered standalone for logged-out web visitors (the App auth gate
 * mounts it instead of the Landing / TelegramLogin root) and inside the
 * app Layout for logged-in users (`authenticated`). Data comes from the
 * same-origin /catalog proxy — the distribution server's public listing
 * (metadata only); downloads stay gated, so the card CTA routes to the
 * in-app marketplace or the login surface.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Github,
  Globe,
  Loader2,
  LogIn,
  Package,
  Search,
  Store,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { ButtonBase } from '@/components/ui/ButtonBase';
import { EmptyState } from '@/components/ui/EmptyState';
import { GlassCard } from '@/components/ui/GlassCard';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ToolbarSearchField } from '@/components/ui/ToolbarSearchField';
import { Tooltip } from '@/components/ui/Tooltip';
import { PluginBadgeChips } from '@/components/marketplace/PluginBadgeChips';
import { CATEGORY_LABEL_KEYS } from '@/components/marketplace/categories';
import type { MarketplaceCategory } from '@/lib/backend/modules/marketplace';
import { getCatalog } from '@/lib/backend/modules/catalog';
import type { CatalogEntry, CatalogI18nText } from '@/lib/backend/modules/catalog';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';

const GRADIENT_CTA =
  'flex items-center justify-center gap-2 rounded-lg font-semibold text-white bg-gradient-to-r from-indigo-500 to-indigo-600 shadow-lg shadow-indigo-900/40 hover:from-indigo-400 hover:to-indigo-500 active:scale-[0.98] transition-all';

const NAV_ITEM =
  'flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-medium transition-colors';

type SourceFilter = 'all' | 'official' | 'community';

const GHOST_FOOTER_BUTTON =
  'inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium text-slate-400 hover:text-indigo-300 hover:bg-indigo-500/10 active:scale-[0.98] transition-all';

function localizedText(
  value: string | CatalogI18nText | null | undefined,
  language: string
): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  const primary = language === 'ru' ? value.ru : value.en;
  const secondary = language === 'ru' ? value.en : value.ru;
  return primary || secondary || '';
}

function localizedDescription(entry: CatalogEntry, language: string): string {
  return localizedText(entry.description_i18n, language) || entry.description || '';
}

function categoryLabel(category: string): string {
  const key = CATEGORY_LABEL_KEYS[category as MarketplaceCategory];
  return key === undefined ? category : t(key);
}

function statusLabel(status: string): string {
  switch (status) {
    case 'stable':
      return t('catalog.status.stable');
    case 'beta':
      return t('catalog.status.beta');
    case 'deprecated':
      return t('catalog.status.deprecated');
    case 'planned':
      return t('catalog.status.planned');
    default:
      return status;
  }
}

interface CardLinkProps {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** External homepage/repository link styled like an IconButton. Plain <a>
 * because the public page must not depend on the desktop shell. */
function CardLink({ href, label, icon: Icon }: CardLinkProps) {
  return (
    <Tooltip content={label} side="top">
      {/* eslint-disable-next-line react/forbid-elements -- external URL; react-router Link is internal-only */}
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-label={label}
        onClick={e => e.stopPropagation()}
        className="inline-flex items-center justify-center w-8 h-8 p-2 rounded transition-colors duration-200 text-slate-500 hover:text-white hover:bg-white/10 shrink-0"
      >
        <Icon className="w-4 h-4" aria-hidden="true" />
      </a>
    </Tooltip>
  );
}

interface CatalogCardProps {
  entry: CatalogEntry;
  language: string;
  ctaLabel: string;
  ctaIcon: LucideIcon;
  onCta: () => void;
}

function CatalogCard({ entry, language, ctaLabel, ctaIcon, onCta }: CatalogCardProps) {
  const [expanded, setExpanded] = useState(false);
  const description = localizedDescription(entry, language) || t('catalog.noDescription');
  const isCommunity = entry.source !== undefined;
  const latest = entry.changelog?.[0];
  const features = entry.features ?? [];
  const hasDetails = features.length > 0 || latest !== undefined;
  const CtaIcon = ctaIcon;

  return (
    <GlassCard
      gradient
      className="rounded-2xl p-6 flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-500/25 hover:shadow-[0_10px_30px_rgba(99,102,241,0.12)]"
    >
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-indigo-500/25 to-violet-500/10 ring-1 ring-inset ring-white/10">
          {entry.icon ? (
            <span aria-hidden className="text-xl leading-none">
              {entry.icon}
            </span>
          ) : (
            <Package className="w-5 h-5 text-indigo-300" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-base font-bold text-white truncate" title={entry.name}>
                {entry.name}
              </div>
              <div className="text-xs text-slate-500 mt-0.5" title={t('marketplace.versionLabel')}>
                {`v${entry.version}`}
              </div>
            </div>
            {(entry.homepage !== null || entry.repository !== null) && (
              <div className="flex items-center gap-0.5 shrink-0 -my-1">
                {entry.homepage !== null && (
                  <CardLink
                    href={entry.homepage}
                    label={t('catalog.linkHomepage')}
                    icon={Globe}
                  />
                )}
                {entry.repository !== null && (
                  <CardLink
                    href={entry.repository}
                    label={t('catalog.linkRepository')}
                    icon={Github}
                  />
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <Badge
              variant={isCommunity ? 'success' : 'indigo'}
              size="sm"
              className="normal-case tracking-normal text-[11px]"
            >
              {isCommunity ? t('catalog.sourceCommunity') : t('catalog.sourceOfficial')}
            </Badge>
            {entry.status !== null && (
              <Badge variant="slate" size="sm" className="normal-case tracking-normal text-[11px]">
                {statusLabel(entry.status)}
              </Badge>
            )}
            {entry.category !== null && (
              <Badge variant="slate" size="sm" className="normal-case tracking-normal text-[11px]">
                {categoryLabel(entry.category)}
              </Badge>
            )}
            <PluginBadgeChips badges={entry.badges} />
          </div>
        </div>
      </div>
      <p
        className="text-sm text-slate-400 mt-3 leading-relaxed line-clamp-3"
        title={description}
      >
        {description}
      </p>
      {(entry.author !== '' || latest?.date) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          {entry.author !== '' && (
            <span className="truncate">{`${t('marketplace.authorLabel')}: ${entry.author}`}</span>
          )}
          {latest?.date && <span>{`${t('logs.lastUpdated')}: ${latest.date}`}</span>}
        </div>
      )}
      <div className="mt-auto pt-4 flex items-center justify-end gap-2">
        {hasDetails && (
          <ButtonBase
            onClick={() => setExpanded(value => !value)}
            aria-expanded={expanded}
            className={cn(GHOST_FOOTER_BUTTON, 'mr-auto')}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {t('catalog.detailsToggle')}
          </ButtonBase>
        )}
        <ButtonBase onClick={onCta} className={GHOST_FOOTER_BUTTON}>
          <CtaIcon className="w-4 h-4" />
          {ctaLabel}
        </ButtonBase>
      </div>
      {expanded && hasDetails && (
        <div className="mt-3 pt-3 border-t border-white/[0.06] flex flex-col gap-4">
          {features.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                {t('marketplace.featuresTitle')}
              </h4>
              <ul className="flex flex-col divide-y divide-white/[0.04]">
                {features.map(feature => {
                  const title = localizedText(feature.title, language);
                  return (
                    <li
                      key={`${feature.status}:${title}`}
                      className="flex items-center gap-3 py-1.5"
                    >
                      <span className="flex-1 min-w-0 text-xs text-slate-300">{title}</span>
                      <Badge
                        variant={feature.status === 'planned' ? 'outline' : feature.status === 'beta' ? 'warning' : 'success'}
                        size="sm"
                        className={cn(
                          'shrink-0',
                          feature.status === 'planned' &&
                            'border-dashed border-slate-500/50 text-slate-400'
                        )}
                      >
                        {statusLabel(feature.status)}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {latest !== undefined && (
            <section>
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                {t('catalog.changelogTitle')}
              </h4>
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-slate-200">{latest.version}</span>
                <span className="text-[11px] text-slate-500">{latest.date}</span>
              </div>
              {latest.changes.length > 0 && (
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {latest.changes.slice(0, 4).map(change => (
                    <li key={change} className="text-xs text-slate-400 leading-relaxed">
                      {change}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </GlassCard>
  );
}

interface CatalogPageProps {
  /** True when mounted inside the app Layout (logged-in): the element is
   * the scroll container. Default false = standalone public page. */
  authenticated?: boolean;
}

export default function CatalogPage({ authenticated = false }: CatalogPageProps) {
  const language = useAppStore(s => s.language);
  const user = useAuthStore(s => s.user);
  const setAuthView = useAuthStore(s => s.setAuthView);
  const navigate = useNavigate();

  const [entries, setEntries] = useState<CatalogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getCatalog()
      .then(items => {
        setEntries(items);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t('catalog.errorTitle'));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCta = () => {
    if (user) {
      navigate('/marketplace');
    } else {
      setAuthView('login');
    }
  };

  const ctaLabel = user ? t('catalog.ctaLoggedIn') : t('catalog.ctaLoggedOut');
  const CtaIcon = user ? ArrowRight : LogIn;

  const visible = useMemo(() => {
    if (entries === null) return [];
    const q = query.trim().toLowerCase();
    return entries.filter(entry => {
      const isCommunity = entry.source !== undefined;
      if (sourceFilter === 'official' && isCommunity) return false;
      if (sourceFilter === 'community' && !isCommunity) return false;
      if (q === '') return true;
      return (
        entry.name.toLowerCase().includes(q) ||
        localizedDescription(entry, language).toLowerCase().includes(q)
      );
    });
  }, [entries, query, sourceFilter, language]);

  const hasEntries = !loading && error === null && entries !== null && entries.length > 0;

  return (
    <div
      className={cn(
        'relative w-full bg-vsc-bg text-slate-200',
        authenticated ? 'h-full overflow-y-auto' : 'min-h-screen'
      )}
    >
      <div
        className="absolute inset-x-0 top-0 h-[640px] pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 80% 55% at 50% 0%, rgba(99,102,241,0.18), transparent 60%), radial-gradient(ellipse 55% 45% at 15% 35%, rgba(139,92,246,0.11), transparent 60%), radial-gradient(ellipse 55% 45% at 85% 30%, rgba(59,130,246,0.09), transparent 60%)',
          maskImage: 'linear-gradient(to bottom, black 45%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 45%, transparent 100%)',
        }}
      />

      <div className="relative">
        <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-black/40 backdrop-blur-xl">
          <div className="mx-auto w-full max-w-7xl 2xl:max-w-[90rem] px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
            <Link to="/" className="flex items-center gap-3 min-w-0">
              <img
                src="/stitchwb-mark.png"
                alt="StitchWB"
                className="w-9 h-9 object-contain drop-shadow-[0_4px_12px_rgba(99,102,241,0.35)]"
              />
              <span className="text-white font-black tracking-tight uppercase text-base truncate">
                Stitch Manager
              </span>
            </Link>
            <nav className="flex items-center gap-1.5">
              <span
                aria-current="page"
                className={cn(
                  NAV_ITEM,
                  'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20'
                )}
              >
                <Store className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">{t('catalog.navMarketplace')}</span>
              </span>
              <Link
                to="/"
                className={cn(NAV_ITEM, 'text-slate-400 hover:text-white hover:bg-white/[0.06]')}
              >
                {t('catalog.backHome')}
              </Link>
            </nav>
          </div>
        </header>

        <div className="mx-auto w-full max-w-7xl 2xl:max-w-[90rem] px-6 lg:px-8 pt-8 pb-6">
          <h1 className="text-2xl md:text-3xl font-black tracking-tight text-white">
            {t('catalog.title')}
          </h1>
          <p className="text-slate-400 mt-1.5 text-sm md:text-base">{t('catalog.subtitle')}</p>
        </div>

        {hasEntries && (
          <div className="mx-auto w-full max-w-7xl 2xl:max-w-[90rem] px-6 lg:px-8 pb-6 flex flex-wrap items-center gap-3">
            <p className="text-xs text-slate-500 tabular-nums mr-auto">
              {t('catalog.resultCount', { count: visible.length })}
            </p>
            <ToolbarSearchField
              value={query}
              onValueChange={setQuery}
              placeholder={t('catalog.searchPlaceholder')}
              aria-label={t('catalog.searchPlaceholder')}
              containerClassName="w-full sm:w-64"
            />
            <SegmentedControl
              size="sm"
              stretch={false}
              value={sourceFilter}
              onChange={value => setSourceFilter(value as SourceFilter)}
              options={[
                { value: 'all', label: t('catalog.filterAll') },
                { value: 'official', label: t('catalog.filterOfficial') },
                { value: 'community', label: t('catalog.filterCommunity') },
              ]}
            />
          </div>
        )}

        <section className="mx-auto w-full max-w-7xl 2xl:max-w-[90rem] px-6 lg:px-8 pb-16">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
              <p className="text-sm">{t('catalog.loading')}</p>
            </div>
          )}

          {!loading && error !== null && (
            <EmptyState
              icon={AlertTriangle}
              title={t('catalog.errorTitle')}
              description={error}
              action={
                <ButtonBase onClick={load} className={cn(GRADIENT_CTA, 'h-10 px-5 text-sm')}>
                  {t('catalog.retry')}
                </ButtonBase>
              }
            />
          )}

          {!loading && error === null && entries !== null && entries.length === 0 && (
            <EmptyState
              icon={Package}
              title={t('catalog.emptyTitle')}
              description={t('catalog.emptyDesc')}
            />
          )}

          {hasEntries && visible.length === 0 && (
            <EmptyState
              icon={Search}
              title={t('catalog.noResultsTitle')}
              description={t('catalog.noResultsDesc')}
            />
          )}

          {hasEntries && visible.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-5">
              {visible.map(entry => (
                <CatalogCard
                  key={entry.id}
                  entry={entry}
                  language={language}
                  ctaLabel={ctaLabel}
                  ctaIcon={CtaIcon}
                  onCta={handleCta}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
