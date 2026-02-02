import { useState, useEffect, useRef, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface FilterOption<T = string> {
  value: T;
  label: string;
  icon?: ReactNode;
  dot?: string | null; // CSS class for colored dot (e.g., 'bg-emerald-500')
  count?: number;
}

export interface FilterDropdownProps<T = string> {
  value: T;
  onChange: (value: T) => void;
  options: FilterOption<T>[];
  icon?: ReactNode;
  label?: string;
  placeholder?: string;
  className?: string;
  /** Show as active/filtered when value is not the first option */
  showActiveState?: boolean;
}

export function FilterDropdown<T = string>({
  value,
  onChange,
  options,
  icon,
  label,
  placeholder,
  className = '',
  showActiveState = false,
}: FilterDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);
  const isActive = showActiveState && value !== options[0]?.value;

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex((prev) => (prev + 1) % options.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex((prev) => (prev - 1 + options.length) % options.length);
          break;
        case 'Enter':
          e.preventDefault();
          onChange(options[focusedIndex].value);
          setIsOpen(false);
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, focusedIndex, options, onChange]);

  // Reset focused index when opening to current selection
  useEffect(() => {
    if (isOpen) {
      const currentIndex = options.findIndex((opt) => opt.value === value);
      setFocusedIndex(currentIndex >= 0 ? currentIndex : 0);
    }
  }, [isOpen, value, options]);

  return (
    <div ref={dropdownRef} className={cn('relative', className)}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200',
          isActive
            ? 'bg-indigo-500/20 border border-indigo-500/50 text-indigo-300'
            : 'bg-transparent border border-white/10 text-slate-400 hover:bg-white/5 hover:text-slate-300'
        )}
      >
        {icon && <span className="w-3 h-3">{icon}</span>}
        {label && <span>{label}:</span>}
        <span>{selectedOption?.label || placeholder || 'Select...'}</span>
        {selectedOption?.count !== undefined && (
          <span className="text-xs text-slate-400 tabular-nums">
            ({selectedOption.count})
          </span>
        )}
        <ChevronDown
          className={cn('w-3 h-3 transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute z-50 mt-2 left-0 min-w-[140px] bg-[#1a1a1a]/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl overflow-hidden animate-fade-in"
          role="listbox"
        >
          {options.map((option, index) => (
            <button
              key={String(option.value)}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              onMouseEnter={() => setFocusedIndex(index)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors',
                value === option.value && 'bg-white/10 text-white',
                focusedIndex === index && 'bg-white/5',
                value !== option.value &&
                  focusedIndex !== index &&
                  'text-slate-400 hover:bg-white/5 hover:text-white'
              )}
              role="option"
              aria-selected={value === option.value}
            >
              {/* Icon or Dot indicator */}
              {option.icon ? (
                <span className="shrink-0">{option.icon}</span>
              ) : option.dot !== undefined ? (
                option.dot ? (
                  <span className={cn('w-2 h-2 rounded-full', option.dot)} />
                ) : (
                  <span className="w-2 h-2 rounded-full border border-slate-600" />
                )
              ) : (
                // Radio button style indicator
                <span
                  className={cn(
                    'w-3 h-3 rounded-full border flex items-center justify-center',
                    value === option.value ? 'border-indigo-400' : 'border-slate-600'
                  )}
                >
                  {value === option.value && (
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                  )}
                </span>
              )}
              <span className="flex-1">{option.label}</span>
              {option.count !== undefined && (
                <span className="text-xs text-slate-500 tabular-nums">
                  {option.count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
