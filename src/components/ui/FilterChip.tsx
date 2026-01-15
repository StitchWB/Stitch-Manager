import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Filter, PieChart } from 'lucide-react';
import { cn } from '../../lib/utils';
import { t } from '../../lib/i18n';

// ============================================
// Status Filter Chip
// ============================================

interface StatusFilterChipProps {
  value: string | null;
  onChange: (value: string | null) => void;
}

const getStatusOptions = () => [
  { value: null, label: t('filters.any'), dot: null },
  { value: 'active', label: t('filters.active'), dot: 'bg-emerald-500' },
  { value: 'banned', label: t('filters.banned'), dot: 'bg-red-500' },
  { value: 'limit_hit', label: t('filters.limitHit'), dot: 'bg-amber-500' },
] as const;

export function StatusFilterChip({ value, onChange }: StatusFilterChipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const statusOptions = getStatusOptions();
  const currentOption = statusOptions.find(opt => opt.value === value);
  const isActive = value !== null;

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200',
          isActive
            ? 'bg-indigo-500/20 border border-indigo-500/50 text-indigo-300'
            : 'bg-transparent border border-white/10 text-slate-400 hover:bg-white/5 hover:text-slate-300'
        )}
      >
        <Filter className="w-3 h-3" />
        <span>{isActive ? currentOption?.label : t('filters.status')}</span>
        <ChevronDown className={cn('w-3 h-3 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-2 left-0 min-w-[140px] bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl overflow-hidden animate-fade-in">
          {statusOptions.map((opt) => (
            <button
              key={opt.value ?? 'any'}
              onClick={() => { onChange(opt.value); setIsOpen(false); }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors',
                value === opt.value
                  ? 'bg-white/10 text-white'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              )}
            >
              {opt.dot ? (
                <span className={cn('w-2 h-2 rounded-full', opt.dot)} />
              ) : (
                <span className="w-2 h-2 rounded-full border border-slate-600" />
              )}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// Quota Filter Chip
// ============================================

type QuotaFilterValue = 'any' | 'has_quota' | 'empty' | 'full';

interface QuotaFilterChipProps {
  value: QuotaFilterValue;
  onChange: (value: QuotaFilterValue) => void;
}

const getQuotaOptions = (): { value: QuotaFilterValue; label: string }[] => [
  { value: 'any', label: t('filters.any') },
  { value: 'has_quota', label: t('filters.hasQuota') },
  { value: 'empty', label: t('filters.empty') },
  { value: 'full', label: t('filters.full') },
];

export function QuotaFilterChip({ value, onChange }: QuotaFilterChipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const quotaOptions = getQuotaOptions();
  const currentOption = quotaOptions.find(opt => opt.value === value);
  const isActive = value !== 'any';

  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200',
          isActive
            ? 'bg-indigo-500/20 border border-indigo-500/50 text-indigo-300'
            : 'bg-transparent border border-white/10 text-slate-400 hover:bg-white/5 hover:text-slate-300'
        )}
      >
        <PieChart className="w-3 h-3" />
        <span>{isActive ? currentOption?.label : t('filters.quota')}</span>
        <ChevronDown className={cn('w-3 h-3 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-2 left-0 min-w-[130px] bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl overflow-hidden animate-fade-in">
          {quotaOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setIsOpen(false); }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors',
                value === opt.value
                  ? 'bg-white/10 text-white'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              )}
            >
              <span className={cn(
                'w-3 h-3 rounded-full border flex items-center justify-center',
                value === opt.value ? 'border-indigo-400' : 'border-slate-600'
              )}>
                {value === opt.value && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />}
              </span>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
