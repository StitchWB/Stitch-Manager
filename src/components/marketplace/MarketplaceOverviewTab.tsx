import { Badge } from '@/components/ui/Badge';
import { t } from '@/lib/i18n';
import { resolveI18n } from '@/lib/i18nText';
import type { MarketplaceFeature, MarketplaceItem } from '@/lib/backend/modules/marketplace';

/** Feature maturity chip; "planned" is dashed grey to read as not-yet-built. */
function FeatureStatusChip({ status }: { status: MarketplaceFeature['status'] }) {
  if (status === 'planned') {
    return (
      <Badge
        variant="outline"
        size="sm"
        className="border-dashed border-slate-500/50 text-slate-400 shrink-0"
      >
        {t('marketplace.status.planned')}
      </Badge>
    );
  }
  return (
    <Badge
      variant={status === 'beta' ? 'warning' : 'success'}
      size="sm"
      className="shrink-0"
    >
      {t(`marketplace.status.${status}`)}
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
      <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
        {overviewDescription ? (
          overviewDescription
        ) : (
          <span className="text-slate-500 italic">
            {t('marketplace.noDescription')}
          </span>
        )}
      </div>

      {item.features != null && item.features.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            {t('marketplace.featuresTitle')}
          </h3>
          <ul className="flex flex-col divide-y divide-white/[0.04]">
            {item.features.map(feature => {
              const title = resolveI18n(feature.title, language);
              return (
                <li
                  key={`${feature.status}:${title}`}
                  className="flex items-center gap-3 py-1.5"
                >
                  <span className="flex-1 min-w-0 text-sm text-slate-300">
                    {title}
                  </span>
                  <FeatureStatusChip status={feature.status} />
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
