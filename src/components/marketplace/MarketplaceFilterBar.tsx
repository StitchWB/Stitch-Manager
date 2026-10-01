import { Search } from 'lucide-react';
import { ButtonBase } from '@/components/ui/ButtonBase';
import { Input } from '@/components/ui/Input';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { MarketplaceCategory } from '@/lib/backend/modules/marketplace';
import { BADGE_DEFS } from './PluginBadgeChips';
import { CATEGORY_LABEL_KEYS, CATEGORY_ORDER } from './categories';

interface MarketplaceFilterBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  badgeFilter: string[];
  onToggleBadge: (key: string) => void;
  onClearBadges: () => void;
  categoryFilter: MarketplaceCategory[];
  onToggleCategory: (key: MarketplaceCategory) => void;
  onClearCategories: () => void;
  categoryCounts: Map<MarketplaceCategory, number>;
}

export function MarketplaceFilterBar({
  query,
  onQueryChange,
  badgeFilter,
  onToggleBadge,
  onClearBadges,
  categoryFilter,
  onToggleCategory,
  onClearCategories,
  categoryCounts,
}: MarketplaceFilterBarProps) {
  return (
    <div className="p-3 border-b border-white/[0.04] flex flex-col gap-2">
      <Input
        type="text"
        value={query}
        onChange={e => onQueryChange(e.target.value)}
        placeholder={t('marketplace.searchPlaceholder')}
        leftIcon={<Search className="w-4 h-4" />}
      />
      <div className="flex items-center gap-1.5 flex-wrap">
        <ButtonBase
          type="button"
          onClick={onClearBadges}
          aria-pressed={badgeFilter.length === 0}
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
            badgeFilter.length === 0
              ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-500/40'
              : 'bg-white/[0.03] text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]',
          )}
        >
          {t('marketplace.badgeFilterAll')}
        </ButtonBase>
        {BADGE_DEFS.map(d => {
          const Icon = d.icon;
          const active = badgeFilter.includes(d.key);
          return (
            <ButtonBase
              key={d.key}
              type="button"
              onClick={() => onToggleBadge(d.key)}
              aria-pressed={active}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
                active
                  ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-500/40'
                  : 'bg-white/[0.03] text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]',
              )}
            >
              <Icon className="w-3 h-3" aria-hidden="true" />
              {t(d.labelKey)}
            </ButtonBase>
          );
        })}
      </div>
      {categoryCounts.size > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <ButtonBase
            type="button"
            onClick={onClearCategories}
            aria-pressed={categoryFilter.length === 0}
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
              categoryFilter.length === 0
                ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-500/40'
                : 'bg-white/[0.03] text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]',
            )}
          >
            {t('marketplace.categoryFilterAll')}
          </ButtonBase>
          {CATEGORY_ORDER.filter(c => categoryCounts.has(c)).map(c => {
            const active = categoryFilter.includes(c);
            return (
              <ButtonBase
                key={c}
                type="button"
                onClick={() => onToggleCategory(c)}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
                  active
                    ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-inset ring-indigo-500/40'
                    : 'bg-white/[0.03] text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]',
                )}
              >
                {`${t(CATEGORY_LABEL_KEYS[c])} · ${categoryCounts.get(c) ?? 0}`}
              </ButtonBase>
            );
          })}
        </div>
      )}
    </div>
  );
}
