import { Badge } from '@/components/ui/Badge';
import { t } from '@/lib/i18n';
import { resolveI18n } from '@/lib/i18nText';
import type { MarketplaceFeature, MarketplaceItem } from '@/lib/backend/modules/marketplace';

const FEATURE_BADGE_VARIANTS: Record<
  string,
  'success' | 'warning' | 'danger' | 'slate'
> = {
  stable: 'success',
  beta: 'warning',
  deprecated: 'danger',
  planned: 'slate',
};

function FeatureStatusBadge({ status }: { status: MarketplaceFeature['status'] }) {
  return (
    <Badge
      variant={FEATURE_BADGE_VARIANTS[status] ?? 'slate'}
      size="sm"
      className="shrink-0"
    >
      {t(`marketplace.featureStatus.${status}`)}
    </Badge>
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
                  className="w-full flex items-center gap-2.5"
                >
                  <span className="min-w-0 text-sm text-slate-200 py-2.5">
                    {title}
                  </span>
                  <FeatureStatusBadge status={feature.status} />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
