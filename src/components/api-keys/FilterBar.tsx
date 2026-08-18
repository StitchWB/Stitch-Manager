import { cn } from '../../lib/utils';
import type { KeyFilter } from '../../types/apiKeys';
import { ButtonBase } from '@/components/ui/ButtonBase';

interface FilterBarProps {
  active: KeyFilter;
  onChange: (filter: KeyFilter) => void;
  counts: Record<KeyFilter, number>;
}

const chips: { key: KeyFilter; label: string; dot: string }[] = [
  { key: 'all', label: 'All', dot: 'bg-slate-400' },
  { key: 'ok', label: 'OK', dot: 'bg-emerald-400' },
  { key: 'rate_limited', label: 'Rate Limited', dot: 'bg-amber-400' },
  { key: 'invalid', label: 'Invalid', dot: 'bg-red-400' },
];

export function FilterBar({ active, onChange, counts }: FilterBarProps) {
  return (
    <div className="flex items-center gap-1.5" role="tablist" aria-label="Filter API keys by status">
      {chips.map(({ key, label, dot }) => (
        <ButtonBase
          key={key}
          role="tab"
          aria-selected={active === key}
          onClick={() => onChange(key)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
            active === key
              ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
              : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10 hover:text-slate-300'
          )}
        >
          <span className={cn('w-1.5 h-1.5 rounded-full', dot)} />
          {label}
          <span className={cn(
            'ml-0.5 tabular-nums',
            active === key ? 'text-sky-400' : 'text-slate-500'
          )}>
            ({counts[key] ?? 0})
          </span>
        </ButtonBase>
      ))}
    </div>
  );
}