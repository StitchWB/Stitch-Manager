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
import { AlertTriangle, ArrowRight, Loader2, LogIn, Package, Search, Store } from 'lucide-react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { ButtonBase } from '@/components/ui/ButtonBase';
import { EmptyState } from '@/components/ui/EmptyState';
import { GlassCard } from '@/components/ui/GlassCard';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ToolbarSearchField } from '@/components/ui/ToolbarSearchField';
import { getCatalog } from '@/lib/backend/modules/catalog';
import type { CatalogEntry } from '@/lib/backend/modules/catalog';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';

const GRADIENT_CTA =
  'flex items-center justify-center gap-2 rounded-lg font-semibold text-white bg-gradient-to-r from-indigo-500 to-indigo-600 shadow-lg shadow-indigo-900/40 hover:from-indigo-400 hover:to-indigo-500 active:scale-[0.98] transition-all';

const NAV_ITEM =
  'flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-medium transition-colors';

type SourceFilter = 'all' | 'official' | 'community';

function localizedDescription(entry: CatalogEntry, language: string): string {
  const localized = language === 'ru' ? entry.description_i18n?.ru : entry.description_i18n?.en;
  return localized || entry.description || '';
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
              {visible.map(entry => {
                const description =
                  localizedDescription(entry, language) || t('catalog.noDescription');
                const isCommunity = entry.source !== undefined;
                return (
                  <GlassCard
                    key={entry.id}
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
                        <div className="text-base font-bold text-white truncate" title={entry.name}>
                          {entry.name}
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
                            <Badge
                              variant="slate"
                              size="sm"
                              className="normal-case tracking-normal text-[11px]"
                            >
                              {statusLabel(entry.status)}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <p
                      className="text-sm text-slate-400 mt-3 leading-relaxed line-clamp-3"
                      title={description}
                    >
                      {description}
                    </p>
                    <div className="mt-auto pt-4 flex justify-end">
                      <ButtonBase
                        onClick={handleCta}
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium text-slate-400 hover:text-indigo-300 hover:bg-indigo-500/10 active:scale-[0.98] transition-all"
                      >
                        <CtaIcon className="w-4 h-4" />
                        {ctaLabel}
                      </ButtonBase>
                    </div>
                  </GlassCard>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
