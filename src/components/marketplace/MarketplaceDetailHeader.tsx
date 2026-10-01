import { Check, Download, Lock, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TierBadge } from '@/components/ui/TierBadge';
import { Tooltip } from '@/components/ui/Tooltip';
import { t } from '@/lib/i18n';
import type { MarketplaceItem, MarketplaceStatus } from '@/lib/backend/modules/marketplace';
import { CATEGORY_LABEL_KEYS } from './categories';
import { PluginBadgeChips } from './PluginBadgeChips';

function statusBadgeVariant(status: MarketplaceStatus): 'success' | 'warning' | 'danger' {
  return status === 'beta' ? 'warning' : status === 'deprecated' ? 'danger' : 'success';
}

interface MarketplaceDetailHeaderProps {
  item: MarketplaceItem;
  busy: boolean;
  isGuest: boolean;
  sourceLabel: string;
  onInstall: (item: MarketplaceItem) => void;
  onUninstall: (item: MarketplaceItem) => void;
  onLockedClick: () => void;
}

export function MarketplaceDetailHeader({
  item,
  busy,
  isGuest,
  sourceLabel,
  onInstall,
  onUninstall,
  onLockedClick,
}: MarketplaceDetailHeaderProps) {
  const locked = !item.can_download && !item.installed;
  const hasUpdate =
    item.installed &&
    item.installed_version !== null &&
    item.version !== null &&
    item.installed_version !== item.version;

  return (
    <>
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
          {item.category != null && (
            <Badge variant="slate" size="sm">
              {t(CATEGORY_LABEL_KEYS[item.category])}
            </Badge>
          )}
          {item.status != null && (
            <Badge variant={statusBadgeVariant(item.status)} size="sm" withDot>
              {t(`marketplace.status.${item.status}`)}
            </Badge>
          )}
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
    </>
  );
}
