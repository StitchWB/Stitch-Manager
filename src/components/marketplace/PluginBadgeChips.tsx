import { Check, ShieldCheck, Star, XCircle } from 'lucide-react';
import { Tooltip } from '@/components/ui/Tooltip';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export interface BadgeDef {
  key: string;
  icon: typeof Star;
  chipClass: string;
  labelKey: string;
  tooltipKey?: string;
}

export const BADGE_DEFS: BadgeDef[] = [
  {
    key: 'recommended',
    icon: Star,
    chipClass: 'bg-amber-500/10 text-amber-300',
    labelKey: 'marketplace.badgeRecommended',
  },
  {
    key: 'verified',
    icon: ShieldCheck,
    chipClass: 'bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-500/30',
    labelKey: 'marketplace.badgeVerified',
    tooltipKey: 'marketplace.badgeVerifiedTooltip',
  },
  {
    key: 'works',
    icon: Check,
    chipClass: 'bg-emerald-500/10 text-emerald-300',
    labelKey: 'marketplace.badgeWorks',
  },
  {
    key: 'not_works',
    icon: XCircle,
    chipClass: 'bg-red-500/10 text-red-300',
    labelKey: 'marketplace.badgeNotWorks',
  },
];

interface PluginBadgeChipsProps {
  badges: string[] | undefined;
  /** Icon-only chips with tooltips (compact list rows). */
  iconOnly?: boolean;
  className?: string;
}

export function PluginBadgeChips({ badges, iconOnly = false, className }: PluginBadgeChipsProps) {
  const known = BADGE_DEFS.filter(d => (badges ?? []).includes(d.key));
  if (known.length === 0) return null;
  return (
    <span className={cn('inline-flex items-center gap-1 min-w-0', className)}>
      {known.map(d => {
        const Icon = d.icon;
        const chip = (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide leading-none shrink-0',
              d.chipClass,
            )}
          >
            <Icon className="w-2.5 h-2.5" aria-hidden="true" />
            {!iconOnly && t(d.labelKey)}
          </span>
        );
        const tooltip = d.tooltipKey ? t(d.tooltipKey) : iconOnly ? t(d.labelKey) : null;
        return tooltip ? (
          <Tooltip key={d.key} content={tooltip} side="top">
            <span className="inline-flex shrink-0">{chip}</span>
          </Tooltip>
        ) : (
          <span key={d.key} className="inline-flex shrink-0">{chip}</span>
        );
      })}
    </span>
  );
}
