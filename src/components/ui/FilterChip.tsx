import { Filter, PieChart } from 'lucide-react';
import { t } from '../../lib/i18n';
import { FilterDropdown, type FilterOption } from './FilterDropdown';

// ============================================
// Status Filter Chip
// ============================================

interface StatusFilterChipProps {
  value: string | null;
  onChange: (value: string | null) => void;
}

const getStatusOptions = (): FilterOption<string | null>[] => [
  { value: null, label: t('filters.any'), dot: null },
  { value: 'active', label: t('filters.active'), dot: 'bg-emerald-500' },
  { value: 'banned', label: t('filters.banned'), dot: 'bg-red-500' },
  { value: 'limit_hit', label: t('filters.limitHit'), dot: 'bg-amber-500' },
];

export function StatusFilterChip({ value, onChange }: StatusFilterChipProps) {
  const statusOptions = getStatusOptions();
  const currentOption = statusOptions.find(opt => opt.value === value);
  const displayLabel = value !== null ? currentOption?.label : t('filters.status');

  return (
    <FilterDropdown
      value={value}
      onChange={onChange}
      options={statusOptions}
      icon={<Filter className="w-3 h-3" />}
      placeholder={displayLabel}
      showActiveState={true}
    />
  );
}

// ============================================
// Quota Filter Chip (Dropdown Style)
// ============================================

type QuotaFilterValue = 'any' | 'has_quota' | 'empty' | 'full' | 'low_quota';

interface QuotaFilterChipDropdownProps {
  value: QuotaFilterValue;
  onChange: (value: QuotaFilterValue) => void;
}

const getQuotaOptions = (): FilterOption<QuotaFilterValue>[] => [
  { value: 'any', label: t('filters.any') },
  { value: 'has_quota', label: t('filters.hasQuota') },
  { value: 'empty', label: t('filters.empty') },
  { value: 'full', label: t('filters.full') },
  { value: 'low_quota', label: t('filters.lowQuota') },
];

export function QuotaFilterChipDropdown({ value, onChange }: QuotaFilterChipDropdownProps) {
  const quotaOptions = getQuotaOptions();
  const currentOption = quotaOptions.find(opt => opt.value === value);
  const displayLabel = value !== 'any' ? currentOption?.label : t('filters.quota');

  return (
    <FilterDropdown
      value={value}
      onChange={onChange}
      options={quotaOptions}
      icon={<PieChart className="w-3 h-3" />}
      placeholder={displayLabel}
      showActiveState={true}
    />
  );
}
