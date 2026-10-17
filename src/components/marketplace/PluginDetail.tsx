import { useState } from 'react';
import { ButtonBase } from '@/components/ui/ButtonBase';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app';
import type { MarketplaceItem } from '@/lib/backend/modules/marketplace';
import { MarketplaceDetailHeader } from './MarketplaceDetailHeader';
import { MarketplaceInfoTab } from './MarketplaceInfoTab';
import { MarketplaceOverviewTab } from './MarketplaceOverviewTab';

interface DetailProps {
  item: MarketplaceItem;
  busy: boolean;
  isGuest: boolean;
  onInstall: (item: MarketplaceItem) => void;
  onUninstall: (item: MarketplaceItem) => void;
  onLockedClick: () => void;
}

export function PluginDetail({ item, busy, isGuest, onInstall, onUninstall, onLockedClick }: DetailProps) {
  const [detailTab, setDetailTab] = useState<'overview' | 'info'>('overview');
  const language = useAppStore(s => s.language);

  const sourceLabel =
    item.source === 'official'
      ? t('marketplace.sourceOfficial')
      : item.source === 'local'
        ? t('marketplace.sourceLocal')
        : t('marketplace.sourceCommunity');

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 max-w-3xl">
        <MarketplaceDetailHeader
          item={item}
          busy={busy}
          isGuest={isGuest}
          sourceLabel={sourceLabel}
          onInstall={onInstall}
          onUninstall={onUninstall}
          onLockedClick={onLockedClick}
        />

        {/* Underline tabs */}
        <div className="flex items-center gap-0 border-b border-white/[0.06] mb-4">
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
          <MarketplaceOverviewTab item={item} language={language} />
        ) : (
          <MarketplaceInfoTab item={item} language={language} sourceLabel={sourceLabel} />
        )}
      </div>
    </div>
  );
}
