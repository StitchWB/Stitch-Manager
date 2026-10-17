import { t } from '@/lib/i18n';
import { resolveI18n } from '@/lib/i18nText';
import { cn } from '@/lib/utils';
import type { MarketplaceFeature, MarketplaceItem } from '@/lib/backend/modules/marketplace';

const FEATURE_DOT_CLASSES: Record<string, string> = {
  stable: 'bg-emerald-400',
  beta: 'bg-amber-400',
  deprecated: 'bg-slate-500',
  planned: 'bg-transparent border border-slate-500',
};

function FeatureStatusDot({ status }: { status: MarketplaceFeature['status'] }) {
  const label = t(`marketplace.status.${status}`);
  return (
    <span className="inline-flex items-center shrink-0" title={label}>
      <span className="sr-only">{label}</span>
      <span
        aria-hidden="true"
        className={cn('h-2 w-2 rounded-full', FEATURE_DOT_CLASSES[status] ?? 'bg-slate-500')}
      />
    </span>
  );
}

interface MarketplaceOverviewTabProps {
  item: MarketplaceItem;
  language: string;
}

export function MarketplaceOverviewTab({ item, language }: MarketplaceOverviewTabProps) {
  const overviewDescription =
    resolveI18n(item.description_i18n, language) || item.description;

  return (
    <div className="flex flex-col gap-5">
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
                  <span className="flex-1 min-w-0 text-sm text-slate-200 py-2.5">
                    {title}
                  </span>
                  <FeatureStatusDot status={feature.status} />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
