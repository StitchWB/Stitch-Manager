import { useEffect, useRef } from 'react';
import { Check, Download, GitBranch, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TierBadge } from '@/components/ui/TierBadge';
import { Tooltip } from '@/components/ui/Tooltip';
import { useServicePlugins } from '@/hooks/useServicePlugins';
import { t } from '@/lib/i18n';
import { resolveI18n } from '@/lib/i18nText';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app';
import { hasPluginUpdate } from '@/lib/backend/modules/marketplace';
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

/** Readable text chip for the manifest status (no bare color dots). */
function StatusChip({ status }: { status: MarketplaceStatus }) {
  const label = t(`marketplace.status.${status}`);
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide leading-tight',
        status === 'beta'
          ? 'bg-amber-500/10 text-amber-300'
          : status === 'deprecated'
            ? 'bg-red-500/10 text-red-300'
            : 'bg-emerald-500/10 text-emerald-300',
      )}
    >
      {label}
    </span>
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
  const rowRef = useRef<HTMLDivElement>(null);
  const servicePlugins = useServicePlugins();
  const runtimeDisabled = servicePlugins.some(
    p => p.id === item.id && p.enabled === false,
  );

  useEffect(() => {
    if (selected) {
      rowRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [selected]);

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

  const hasUpdate = hasPluginUpdate(item) && !item.dev_shadow;

  // Line 2: localized description, else "version · author", else id.
  const versionAuthor =
    [item.version, item.author].filter(Boolean).join(' · ') || item.id;
  const localizedDesc = resolveI18n(item.description_i18n, language);
  const secondaryLine = localizedDesc !== '' ? localizedDesc : versionAuthor;

  return (
    <div
      ref={rowRef}
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
        'flex items-center gap-3 px-3 py-2 border-b border-white/[0.04] border-l-[3px] border-l-transparent transition-colors cursor-pointer',
        selected
          ? 'bg-white/[0.05] border-l-vsc-blue'
          : 'hover:bg-white/[0.03]',
        locked && 'opacity-50 saturate-50',
        runtimeDisabled && 'opacity-50 saturate-50',
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
          <span className="text-[13px] font-medium text-slate-100 truncate" title={item.name}>
            {item.name}
          </span>
          {locked && (
            <Lock
              className="w-3 h-3 text-slate-500 shrink-0"
              aria-label={lockLabel}
            />
          )}
          {runtimeDisabled && (
            <Badge variant="slate" size="sm" className="shrink-0">
              {t('marketplace.disabledBadge')}
            </Badge>
          )}
          {!item.entitled && item.required_tier && (
            <TierBadge tier={item.required_tier} size="sm" className="shrink-0" />
          )}
          <PluginBadgeChips badges={item.badges} iconOnly className="shrink-0" />
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
          {item.status != null && <StatusChip status={item.status} />}
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
        {hasUpdate && (
          <Badge variant="warning" size="sm">
            {t('marketplace.updateAvailable')}
          </Badge>
        )}
        {(item.dev_shadow || (item.installed && !hasUpdate)) && (
          <span className="flex items-center gap-1.5">
            {item.dev_shadow && (
              <Tooltip content={t('marketplace.devCopyTooltip')} side="top">
                <span className="flex items-center text-slate-500">
                  <GitBranch size={11} className="shrink-0" aria-hidden="true" />
                  <span className="sr-only">{t('marketplace.devCopy')}</span>
                </span>
              </Tooltip>
            )}
            {item.installed && !hasUpdate && (
              <Tooltip
                content={
                  item.installed_version !== null
                    ? t('marketplace.versionChipTooltip', {
                        version: item.installed_version,
                      })
                    : t('marketplace.installed')
                }
                side="top"
              >
                <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.05] px-1.5 py-px text-[10px] font-mono tabular-nums text-slate-400">
                  <Check size={10} className="text-emerald-400" aria-hidden="true" />
                  {item.installed_version !== null && (
                    // eslint-disable-next-line i18next/no-literal-string -- "v" version prefix is non-translatable
                    <span>v{item.installed_version}</span>
                  )}
                  <span className="sr-only">{t('marketplace.installed')}</span>
                </span>
              </Tooltip>
            )}
          </span>
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
        ) : null}
      </div>
    </div>
  );
}
