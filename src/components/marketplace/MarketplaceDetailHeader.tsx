import { Check, Download, ExternalLink, Lock, Power, ScrollText, Settings, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { CANONICAL_PLUGIN_ROUTES, CORE_PAGE_ROUTES } from '@/components/ai-proxy/corePageRoutes';
import { LEGACY_REDIRECTS } from '@/components/ai-proxy/LegacyRedirects';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TierBadge } from '@/components/ui/TierBadge';
import { Tooltip } from '@/components/ui/Tooltip';
import { useServicePlugins } from '@/hooks/useServicePlugins';
import { t } from '@/lib/i18n';
import { hasPluginUpdate } from '@/lib/backend/modules/marketplace';
import type { MarketplaceItem, MarketplaceStatus } from '@/lib/backend/modules/marketplace';
import { CATEGORY_LABEL_KEYS } from './categories';

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
  onToggleEnabled: (item: MarketplaceItem, enabled: boolean) => void;
  onLockedClick: () => void;
}

export function MarketplaceDetailHeader({
  item,
  busy,
  isGuest,
  sourceLabel,
  onInstall,
  onUninstall,
  onToggleEnabled,
  onLockedClick,
}: MarketplaceDetailHeaderProps) {
  const locked = !item.can_download && !item.installed;
  const hasUpdate = hasPluginUpdate(item) && !item.dev_shadow;

  const navigate = useNavigate();
  const servicePlugins = useServicePlugins();
  const servicePlugin = servicePlugins.find(p => p.id === item.id);
  const contributesPage =
    servicePlugin != null &&
    (servicePlugin.ui?.kind === 'declarative' ||
      (servicePlugin.ui?.tabs?.length ?? 0) > 0);
  const runtimeDisabled = servicePlugin?.enabled === false;

  const legacyEntry = LEGACY_REDIRECTS.find(
    e => e.from === `/ai/plugin/${item.id}`,
  );
  const settingsRoute =
    CANONICAL_PLUGIN_ROUTES[item.id] ??
    CORE_PAGE_ROUTES[item.id] ??
    (typeof legacyEntry?.to === 'string' ? legacyEntry.to : undefined) ??
    (servicePlugin?.ui?.kind === 'declarative'
      ? `/ai/plugin/${item.id}`
      : undefined);

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
          {runtimeDisabled && (
            <Badge variant="slate" size="sm" data-testid="disabled-badge">
              {t('marketplace.disabledBadge')}
            </Badge>
          )}
          {!item.entitled && item.required_tier && (
            <TierBadge tier={item.required_tier} size="sm" />
          )}
        </div>
      </div>

      {/* Meta line */}
      <div className="text-xs text-slate-500 mb-4">
        {[item.author, item.version ? `v${item.version}` : '']
          .filter(Boolean)
          .join(' · ')}
      </div>

      {/* Action row */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
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
          <span
            data-testid="installed-status"
            className="inline-flex items-center gap-1.5 text-xs text-slate-400"
          >
            <Check size={14} aria-hidden="true" />
            {t('marketplace.installed')}
          </span>
        )}

        {contributesPage && (
          <Button
            size="sm"
            variant="secondary"
            onClick={e => {
              e.currentTarget.blur();
              navigate(
                CANONICAL_PLUGIN_ROUTES[item.id] ??
                  CORE_PAGE_ROUTES[item.id] ??
                  `/ai/plugin/${item.id}`,
              );
            }}
            leftIcon={<ExternalLink className="w-3.5 h-3.5" />}
          >
            {t('marketplace.open')}
          </Button>
        )}

        {item.installed &&
          (settingsRoute != null ? (
            <Tooltip content={t('marketplace.settings')}>
              <span>
                <Button
                  size="sm"
                  variant="secondary"
                  className="px-2"
                  onClick={e => {
                    e.currentTarget.blur();
                    navigate(settingsRoute);
                  }}
                  aria-label={t('marketplace.settings')}
                  leftIcon={<Settings className="w-3.5 h-3.5" />}
                />
              </span>
            </Tooltip>
          ) : (
            <Tooltip content={t('marketplace.settingsUnavailable')}>
              <span>
                <Button
                  size="sm"
                  variant="secondary"
                  className="px-2"
                  disabled
                  aria-label={t('marketplace.settings')}
                  leftIcon={<Settings className="w-3.5 h-3.5" />}
                />
              </span>
            </Tooltip>
          ))}

        {item.installed && (
          <Tooltip content={t('marketplace.logsTooltip')}>
            <span>
              <Button
                size="sm"
                variant="secondary"
                className="px-2"
                onClick={e => {
                  e.currentTarget.blur();
                  navigate(`/logs?source=plugin:${item.id}`);
                }}
                aria-label={t('marketplace.logs')}
                leftIcon={<ScrollText className="w-3.5 h-3.5" />}
              />
            </span>
          </Tooltip>
        )}

        <span className="flex-1" />

        {item.installed && servicePlugin != null && (
          <Button
            size="sm"
            variant="ghost"
            data-testid="toggle-enabled"
            onClick={() => onToggleEnabled(item, runtimeDisabled)}
            disabled={busy}
            leftIcon={<Power className="w-3.5 h-3.5" />}
          >
            {runtimeDisabled
              ? t('marketplace.enable')
              : t('marketplace.disable')}
          </Button>
        )}

        {item.installed && (
          <Button
            size="sm"
            variant="ghost"
            className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-transparent"
            onClick={() => onUninstall(item)}
            isLoading={busy}
            disabled={busy}
            leftIcon={!busy ? <Trash2 className="w-3.5 h-3.5" /> : undefined}
          >
            {busy ? t('marketplace.removing') : t('marketplace.remove')}
          </Button>
        )}

        {hasUpdate && (
          <span className="text-xs text-indigo-300 tabular-nums">
            {item.installed_version} → {item.version}
          </span>
        )}
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
