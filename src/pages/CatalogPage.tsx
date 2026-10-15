/**
 * Public plugin catalog — /catalog.
 *
 * Rendered standalone for logged-out web visitors (the App auth gate
 * mounts it instead of the Landing / TelegramLogin root) and inside the
 * app Layout for logged-in users (`authenticated`). Data comes from the
 * same-origin /catalog proxy — the distribution server's public listing
 * (metadata only); downloads stay gated, so the card CTA routes to the
 * in-app marketplace or the login surface.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Loader2, LogIn, Package } from 'lucide-react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/Badge';
import { ButtonBase } from '@/components/ui/ButtonBase';
import { EmptyState } from '@/components/ui/EmptyState';
import { GlassCard } from '@/components/ui/GlassCard';
import { getCatalog } from '@/lib/backend/modules/catalog';
import type { CatalogEntry } from '@/lib/backend/modules/catalog';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';

const GRADIENT_CTA =
  'flex items-center justify-center gap-2 rounded-lg font-semibold text-white bg-gradient-to-r from-indigo-500 to-indigo-600 shadow-lg shadow-indigo-900/40 hover:from-indigo-400 hover:to-indigo-500 active:scale-[0.98] transition-all';

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

  return (
    <div
      className={cn(
        'relative w-full bg-vsc-bg text-slate-200',
        authenticated ? 'h-full overflow-y-auto' : 'min-h-screen'
      )}
    >
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(99,102,241,0.18), transparent 60%), radial-gradient(ellipse 60% 50% at 20% 100%, rgba(139,92,246,0.12), transparent 60%), radial-gradient(ellipse 60% 50% at 80% 100%, rgba(59,130,246,0.10), transparent 60%)',
          }}
        />
        <div className="relative mx-auto w-full max-w-7xl 2xl:max-w-[90rem] px-6 lg:px-8 pb-10 md:pb-14">
          <header className="flex items-center justify-between py-5">
            <Link to="/" className="flex items-center gap-3">
              <img
                src="/stitchwb-mark.png"
                alt="StitchWB"
                className="w-10 h-10 object-contain drop-shadow-[0_4px_12px_rgba(99,102,241,0.35)]"
              />
              <span className="text-white font-black tracking-tight uppercase text-lg">Stitch Manager</span>
            </Link>
            <Link
              to="/"
              className="flex items-center gap-2 h-10 px-4 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/[0.05] transition-colors"
            >
              {t('catalog.backHome')}
            </Link>
          </header>

          <div className="text-center pt-4 pb-10 md:pb-12">
            <h1 className="text-3xl md:text-4xl font-black tracking-tight text-white">
              {t('catalog.title')}
            </h1>
            <p className="text-slate-400 mt-3 max-w-2xl mx-auto text-sm md:text-base leading-relaxed">
              {t('catalog.subtitle')}
            </p>
          </div>
        </div>
      </section>

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

        {!loading && error === null && entries !== null && entries.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-5">
            {entries.map(entry => {
              const localized =
                language === 'ru' ? entry.description_i18n?.ru : entry.description_i18n?.en;
              const description = localized || entry.description || t('catalog.noDescription');
              const isCommunity = entry.source !== undefined;
              return (
                <GlassCard key={entry.id} gradient className="rounded-2xl p-6 flex flex-col">
                  <div className="flex items-start gap-4">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-indigo-500/15 text-indigo-300 text-xl leading-none">
                      {entry.icon ? (
                        <span aria-hidden>{entry.icon}</span>
                      ) : (
                        <Package className="w-5 h-5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-bold text-white truncate" title={entry.name}>
                        {entry.name}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <Badge variant={isCommunity ? 'info' : 'indigo'} size="sm">
                          {isCommunity ? t('catalog.sourceCommunity') : t('catalog.sourceOfficial')}
                        </Badge>
                        {entry.status !== null && (
                          <Badge variant="slate" size="sm">
                            {statusLabel(entry.status)}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-slate-400 mt-3 leading-relaxed">{description}</p>
                  <div className="mt-auto pt-5">
                    <ButtonBase
                      onClick={handleCta}
                      className={cn(GRADIENT_CTA, 'h-10 w-full px-5 text-sm')}
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
  );
}
