import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { t } from '../../lib/i18n';

interface FilterDropdownProps {
  value: string | null;
  onChange: (value: string | null) => void;
}

const getFilterOptions = () => [
  { value: null, label: t('filters.anyStatus') },
  { value: 'active', label: t('filters.active') },
  { value: 'banned', label: t('filters.banned') },
  { value: 'limit_hit', label: t('filters.limitHit') },
] as const;

export function FilterDropdown({ value, onChange }: FilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filterOptions = getFilterOptions();
  // Get current label
  const currentLabel = filterOptions.find(opt => opt.value === value)?.label ?? t('filters.anyStatus');
  const isFiltered = value !== null;

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleSelect = (newValue: string | null) => {
    onChange(newValue);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border transition-colors
          ${isFiltered 
            ? 'bg-white/5 border-indigo-500/50 text-indigo-400' 
            : 'bg-white/5 border-white/10 text-white/70 hover:text-white hover:border-white/20'
          }
        `}
      >
        {/* Active filter dot indicator */}
        {isFiltered && (
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
        )}
        <span>{currentLabel}</span>
        <ChevronDown 
          className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute z-50 mt-1 min-w-[140px] bg-slate-900/95 backdrop-blur-sm border border-white/10 rounded-lg shadow-xl overflow-hidden">
          {filterOptions.map((option) => (
            <button
              key={option.value ?? 'all'}
              type="button"
              onClick={() => handleSelect(option.value)}
              className={`
                w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors
                ${value === option.value 
                  ? 'bg-indigo-500/20 text-indigo-400' 
                  : 'text-white/70 hover:bg-white/5 hover:text-white'
                }
              `}
            >
              {/* Radio indicator */}
              <span className={`
                w-3 h-3 rounded-full border flex items-center justify-center
                ${value === option.value 
                  ? 'border-indigo-400' 
                  : 'border-white/30'
                }
              `}>
                {value === option.value && (
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                )}
              </span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default FilterDropdown;
