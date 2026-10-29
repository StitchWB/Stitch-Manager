import { ExternalLink } from 'lucide-react';
import { t } from '@/lib/i18n';
import { resolveI18n } from '@/lib/i18nText';
import { cn } from '@/lib/utils';
import type { MarketplaceItem, MarketplaceFeatureStatus } from '@/lib/backend/modules/marketplace';
import { PluginMetaGrid } from './PluginMetaGrid';

function ExternalLinkRow({ href, label }: { href: string; label: string }) {
  return (
    // eslint-disable-next-line react/forbid-elements -- external URL; react-router Link is internal-only
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 w-fit text-sm text-indigo-300 hover:text-indigo-200 transition-colors"
    >
      <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </a>
  );
}

const FEATURE_DOT_CLASSES: Record<MarketplaceFeatureStatus, string> = {
  stable: 'bg-emerald-400',
  beta: 'bg-amber-400',
  planned: 'bg-transparent border border-slate-500',
};

const FEATURE_TEXT_CLASSES: Record<MarketplaceFeatureStatus, string> = {
  stable: 'text-slate-500',
  beta: 'text-amber-300',
  planned: 'text-slate-500',
};

function FeatureStatus({ status }: { status: MarketplaceFeatureStatus }) {
  return (
    <span className="flex items-center gap-1.5 shrink-0">
      <span
        className={cn(
          'w-2 h-2 rounded-full',
          FEATURE_DOT_CLASSES[status] ?? 'bg-slate-500',
        )}
      />
      <span className={cn('text-[11px]', FEATURE_TEXT_CLASSES[status] ?? 'text-slate-500')}>
        {t(`marketplace.featureStatus.${status}`)}
      </span>
    </span>
  );
}

interface MarketplaceOverviewTabProps {
  item: MarketplaceItem;
  language: string;
  sourceLabel: string;
}

export function MarketplaceOverviewTab({ item, language, sourceLabel }: MarketplaceOverviewTabProps) {
  const overviewDescription =
    resolveI18n(item.description_i18n, language) || item.description;

  return (
    <div className="flex flex-col xl:flex-row gap-8 xl:gap-10">
      <div className="flex flex-col gap-5 min-w-0 flex-1">
        <div className="max-w-3xl text-sm text-slate-300 leading-relaxed whitespace-pre-line">
          {overviewDescription ? (
            overviewDescription
          ) : (
            <span className="text-slate-500 italic">
              {t('marketplace.noDescription')}
            </span>
          )}
        </div>

        {item.features != null && item.features.length > 0 && (
          <section className="w-full max-w-3xl">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              {t('marketplace.featuresTitle')}
            </h3>
            <ul className="w-full flex flex-col divide-y divide-white/5">
              {item.features.map(feature => {
                const title = resolveI18n(feature.title, language);
                return (
                  <li
                    key={`${feature.status}:${title}`}
                    className="w-full flex items-center justify-between gap-3"
                  >
                    <span className="min-w-0 text-sm text-slate-200 py-2.5">
                      {title}
                    </span>
                    <FeatureStatus status={feature.status} />
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {item.changelog != null && item.changelog.length > 0 && (
          <section className="w-full max-w-3xl">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              {t('marketplace.changelogTitle')}
            </h3>
            <ol className="flex flex-col gap-4 border-l border-white/[0.06] pl-3">
              {item.changelog.map(entry => (
                <li key={`${entry.version}:${entry.date}`}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-slate-200">
                      {entry.version}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {entry.date}
                    </span>
                  </div>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5">
                    {entry.changes.map(change => {
                      const text = resolveI18n(change, language);
                      return (
                        <li
                          key={text}
                          className="text-xs text-slate-400 leading-relaxed"
                        >
                          {text}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          </section>
        )}

        {(Boolean(item.homepage) || Boolean(item.repository)) && (
          <section className="w-full max-w-3xl">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              {t('marketplace.linksTitle')}
            </h3>
            <div className="flex flex-col gap-1.5">
              {item.homepage ? (
                <ExternalLinkRow
                  href={item.homepage}
                  label={t('marketplace.linkHomepage')}
                />
              ) : null}
              {item.repository ? (
                <ExternalLinkRow
                  href={item.repository}
                  label={t('marketplace.linkRepository')}
                />
              ) : null}
            </div>
          </section>
        )}
      </div>

      <aside className="xl:w-[320px] shrink-0">
        <PluginMetaGrid item={item} sourceLabel={sourceLabel} />
      </aside>
    </div>
  );
}
