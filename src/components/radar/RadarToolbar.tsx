import { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { t } from '@/lib/i18n';
import { useCommunityStore } from '@/stores/community';
import type { RadarTab, RadarSort, RadarPeriod } from '@/stores/community';

/**
 * Sticky filter toolbar for the radar feed.
 *
 * Reads/writes filters directly to the community store. Any change resets the
 * feed (offset 0) via the page's filter effect — the toolbar itself only
 * updates filter state, it does not fetch.
 */
export function RadarToolbar() {
  const filters = useCommunityStore(s => s.filters);
  const setFilter = useCommunityStore(s => s.setFilter);
  const [search, setSearch] = useState(filters.q);

  // Recomputed each render so labels follow the current i18n language.
  const TAB_OPTIONS = [
    { label: t('radar.tabAll'), value: 'all' },
    { label: t('radar.tabEasy'), value: 'easy' },
    { label: t('radar.tabMedium'), value: 'medium' },
    { label: t('radar.tabHard'), value: 'hard' },
    { label: t('radar.tabDead'), value: 'dead' },
  ];

  const SORT_OPTIONS = [
    { label: t('radar.sortTop'), value: 'top' },
    { label: t('radar.sortNew'), value: 'new' },
    { label: t('radar.sortAmount'), value: 'amount' },
  ];

  const PERIOD_OPTIONS = [
    { value: 'all', label: t('radar.periodAll') },
    { value: '24h', label: t('radar.period24h') },
    { value: '7d', label: t('radar.period7d') },
    { value: '30d', label: t('radar.period30d') },
  ];

  // Debounce search input → q filter (300ms)
  useEffect(() => {
    const handle = setTimeout(() => {
      if (search !== filters.q) {
        setFilter({ q: search });
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [search, filters.q, setFilter]);

  return (
    <div className="shrink-0 bg-black/40 backdrop-blur-md border-b border-white/[0.06] px-4 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <SegmentedControl
          options={TAB_OPTIONS}
          value={filters.tab}
          onChange={v => setFilter({ tab: v as RadarTab })}
          size="sm"
          stretch={false}
        />

        <div className="w-44 min-w-0">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('radar.searchPlaceholder')}
            leftIcon={<Search size={14} />}
            containerClassName="w-full"
          />
        </div>

        <SegmentedControl
          options={SORT_OPTIONS}
          value={filters.sort}
          onChange={v => setFilter({ sort: v as RadarSort })}
          size="sm"
          stretch={false}
        />

        <Select
          options={PERIOD_OPTIONS}
          value={filters.period}
          onValueChange={v => setFilter({ period: v as RadarPeriod })}
          containerClassName="w-28"
        />
      </div>
    </div>
  );
}
