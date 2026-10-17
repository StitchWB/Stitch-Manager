import { useEffect, useRef, useState } from 'react';
import { Check, Search, SlidersHorizontal } from 'lucide-react';
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

const ROW_CLASS =
  'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/5';

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
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const activeCount = badgeFilter.length + categoryFilter.length;

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="p-3 border-b border-white/[0.04] flex items-center gap-2">
      <Input
        type="text"
        value={query}
        onChange={e => onQueryChange(e.target.value)}
        placeholder={t('marketplace.searchPlaceholder')}
        leftIcon={<Search className="w-4 h-4" />}
        containerClassName="flex-1 min-w-0"
      />
      <div ref={wrapRef} className="relative shrink-0">
        <ButtonBase
          type="button"
          data-testid="marketplace-filters-trigger"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-all duration-200',
            activeCount > 0
              ? 'border-indigo-500/35 bg-indigo-500/12 text-indigo-200'
              : 'border-white/10 bg-white/[0.02] text-slate-300 hover:bg-white/5 hover:text-white',
          )}
        >
          <SlidersHorizontal size={14} aria-hidden="true" />
          {t('marketplace.filters')}
          {activeCount > 0 && (
            <span
              data-testid="filters-active-count"
              className="rounded-full bg-indigo-500/25 px-1.5 text-[10px] font-semibold leading-4 tabular-nums text-indigo-200"
            >
              {activeCount}
            </span>
          )}
        </ButtonBase>
        {open && (
          <div
            data-testid="marketplace-filters-popover"
            role="dialog"
            aria-label={t('marketplace.filters')}
            className="absolute right-0 top-full mt-2 w-72 z-30 rounded-xl border border-white/10 bg-vsc-sidebar-solid shadow-xl shadow-black/50 p-3"
          >
            <div className="flex flex-col gap-0.5">
              <ButtonBase type="button" onClick={onClearBadges} className={ROW_CLASS}>
                <span className="flex items-center gap-1.5">
                  {badgeFilter.length === 0 && (
                    <Check size={14} className="text-indigo-400" aria-hidden="true" />
                  )}
                  {t('marketplace.badgeFilterAll')}
                </span>
              </ButtonBase>
              {BADGE_DEFS.map(d => {
                const active = badgeFilter.includes(d.key);
                return (
                  <ButtonBase
                    key={d.key}
                    type="button"
                    onClick={() => onToggleBadge(d.key)}
                    aria-pressed={active}
                    className={ROW_CLASS}
                  >
                    <span className="flex items-center gap-1.5">
                      {active && (
                        <Check size={14} className="text-indigo-400" aria-hidden="true" />
                      )}
                      {t(d.labelKey)}
                    </span>
                  </ButtonBase>
                );
              })}
            </div>
            <div className="border-t border-white/5 pt-2 mt-2 flex flex-col gap-0.5">
              <ButtonBase type="button" onClick={onClearCategories} className={ROW_CLASS}>
                <span className="flex items-center gap-1.5">
                  {categoryFilter.length === 0 && (
                    <Check size={14} className="text-indigo-400" aria-hidden="true" />
                  )}
                  {t('marketplace.categoryFilterAll')}
                </span>
              </ButtonBase>
              {CATEGORY_ORDER.filter(c => categoryCounts.has(c)).map(c => {
                const active = categoryFilter.includes(c);
                return (
                  <ButtonBase
                    key={c}
                    type="button"
                    onClick={() => onToggleCategory(c)}
                    aria-pressed={active}
                    className={ROW_CLASS}
                  >
                    <span className="flex items-center gap-1.5">
                      {active && (
                        <Check size={14} className="text-indigo-400" aria-hidden="true" />
                      )}
                      {t(CATEGORY_LABEL_KEYS[c])}
                    </span>
                    <span className="text-xs text-slate-500 tabular-nums">
                      {categoryCounts.get(c) ?? 0}
                    </span>
                  </ButtonBase>
                );
              })}
            </div>
            <div className="border-t border-white/5 pt-2 mt-2">
              <ButtonBase
                type="button"
                onClick={() => {
                  onClearBadges();
                  onClearCategories();
                }}
                className="w-full rounded-md px-2 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                {t('marketplace.filtersReset')}
              </ButtonBase>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
