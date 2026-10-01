import { Check, Download, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TierBadge } from '@/components/ui/TierBadge';
import { Tooltip } from '@/components/ui/Tooltip';
import { t } from '@/lib/i18n';
import { resolveI18n } from '@/lib/i18nText';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app';
import type { MarketplaceItem, MarketplaceStatus } from '@/lib/backend/modules/marketplace';
import { PluginBadgeChips } from './PluginBadgeChips';

/** Two-letter initials from a plugin name, for the icon block. */
function getInitials(name: string): string {
  const parts = name.trim().split(/[\s_-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Stable color from a string hash, for the icon block background. */
function getIconColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 60% 45%)`;
}

/** Small colored status dot for compact list rows; full label in a tooltip. */
function StatusDot({ status }: { status: MarketplaceStatus }) {
  const label = t(`marketplace.status.${status}`);
  return (
    <Tooltip content={label} side="top" wrapperClassName="shrink-0">
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full inline-block',
          status === 'beta'
            ? 'bg-amber-400'
            : status === 'deprecated'
              ? 'bg-red-400'
              : 'bg-emerald-400',
        )}
        aria-label={label}
      />
    </Tooltip>
  );
}

interface ListRowProps {
  item: MarketplaceItem;
  selected: boolean;
  busy: boolean;
  isGuest: boolean;
  onSelect: (id: string) => void;
  onInstall: (item: MarketplaceItem) => void;
  onLockedClick: () => void;
}

export function MarketplaceListRow({ item, selected, busy, isGuest, onSelect, onInstall, onLockedClick }: ListRowProps) {
  const language = useAppStore(s => s.language);

  const locked = !item.can_download && !item.installed;
  const unavailableMsg = t('marketplace.unavailableForRole');
  const lockLabel = isGuest ? t('marketplace.authRequiredTooltip') : unavailableMsg;
  const tooltipMsg = isGuest
    ? lockLabel
    : item.required_tier
      ? t('marketplace.requiresTierNote', { tier: t(`auth.role.${item.required_tier}`) })
      : unavailableMsg;

  const handleLockedClick = () => {
    if (isGuest) {
      onLockedClick();
    } else {
      toast.error(unavailableMsg);
    }
  };

  const hasUpdate =
    item.installed &&
    item.installed_version !== null &&
    item.version !== null &&
    item.installed_version !== item.version;

  // Line 2: localized description, else "version · author", else id.
  const versionAuthor =
    [item.version, item.author].filter(Boolean).join(' · ') || item.id;
  const localizedDesc = resolveI18n(item.description_i18n, language);
  const secondaryLine = localizedDesc !== '' ? localizedDesc : versionAuthor;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(item.id)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(item.id);
        }
      }}
      className={cn(
        'flex items-center gap-3 px-3 py-2 border-b border-white/[0.04] transition-colors cursor-pointer',
        selected
          ? 'bg-indigo-500/[0.12] ring-1 ring-inset ring-indigo-500/30'
          : 'hover:bg-white/[0.03]',
        locked && 'opacity-50 saturate-50',
        !locked && (item.badges ?? []).includes('not_works') && 'opacity-60 saturate-[0.6]',
      )}
    >
      <div
        className="w-9 h-9 rounded-md flex items-center justify-center shrink-0 text-xs font-bold text-white/90"
        style={{ backgroundColor: getIconColor(item.id) }}
        aria-hidden="true"
      >
        {item.icon ? (
          <span className="text-base leading-none">{item.icon}</span>
        ) : (
          getInitials(item.name)
        )}
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] font-medium text-slate-100 truncate">
            {item.name}
          </span>
          {locked && (
            <Lock
              className="w-3 h-3 text-slate-500 shrink-0"
              aria-label={lockLabel}
            />
          )}
          {!item.entitled && item.required_tier && (
            <TierBadge tier={item.required_tier} size="sm" className="shrink-0" />
          )}
          <PluginBadgeChips badges={item.badges} iconOnly className="shrink-0" />
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
          {item.status != null && <StatusDot status={item.status} />}
          <span className="text-[11px] text-slate-500 truncate">
            {secondaryLine}
          </span>
        </div>
      </div>

      {/* stopPropagation: clicks here must not select the row */}
      <div
        className="shrink-0 flex flex-col items-end gap-1"
        onClick={e => e.stopPropagation()}
      >
        {item.installed && item.installed_version !== null && (
          <div className="flex items-center gap-1.5">
            {/* eslint-disable-next-line i18next/no-literal-string -- "v" version prefix is non-translatable */}
            <span className="text-[10px] text-slate-500 tabular-nums">
              v{item.installed_version}
            </span>
            {hasUpdate && (
              <Badge variant="warning" size="sm">
                {t('marketplace.updateAvailable')}
              </Badge>
            )}
          </div>
        )}
        {locked ? (
          <Tooltip content={tooltipMsg} side="left">
            <span>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleLockedClick}
                disabled={!isGuest}
                leftIcon={<Lock className="w-3.5 h-3.5" />}
                title={lockLabel}
              >
                {t('marketplace.install')}
              </Button>
            </span>
          </Tooltip>
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
      </div>
    </div>
  );
}
