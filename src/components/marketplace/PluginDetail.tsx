import { t } from '@/lib/i18n';
import { useAppStore } from '@/stores/app';
import type { MarketplaceItem } from '@/lib/backend/modules/marketplace';
import { MarketplaceDetailHeader } from './MarketplaceDetailHeader';
import { MarketplaceOverviewTab } from './MarketplaceOverviewTab';

interface DetailProps {
  item: MarketplaceItem;
  busy: boolean;
  isGuest: boolean;
  onInstall: (item: MarketplaceItem) => void;
  onUninstall: (item: MarketplaceItem) => void;
  onToggleEnabled: (item: MarketplaceItem, enabled: boolean) => void;
  onLockedClick: () => void;
}

export function PluginDetail({ item, busy, isGuest, onInstall, onUninstall, onToggleEnabled, onLockedClick }: DetailProps) {
  const language = useAppStore(s => s.language);

  const sourceLabel =
    item.source === 'official'
      ? t('marketplace.sourceOfficial')
      : item.source === 'local'
        ? t('marketplace.sourceLocal')
        : t('marketplace.sourceCommunity');

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 w-full">
        <MarketplaceDetailHeader
          item={item}
          busy={busy}
          isGuest={isGuest}
          sourceLabel={sourceLabel}
          onInstall={onInstall}
          onUninstall={onUninstall}
          onToggleEnabled={onToggleEnabled}
          onLockedClick={onLockedClick}
        />

        <MarketplaceOverviewTab item={item} language={language} sourceLabel={sourceLabel} />
      </div>
    </div>
  );
}
