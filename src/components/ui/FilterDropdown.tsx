import {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useCallback,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
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
  triggerClassName?: string;
  menuClassName?: string;
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
  triggerClassName,
  menuClassName,
  showActiveState = false,
}: FilterDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<'top' | 'bottom'>('bottom');

  const selectedOption = options.find(opt => opt.value === value);
  const isActive = showActiveState && value !== options[0]?.value;

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setMenuStyle(null);
  }, []);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = dropdownRef.current?.contains(target) ?? false;
      const insideMenu = menuRef.current?.contains(target) ?? false;
      if (!insideTrigger && !insideMenu) {
        closeMenu();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, closeMenu]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusedIndex(prev => (prev + 1) % options.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusedIndex(prev => (prev - 1 + options.length) % options.length);
          break;
        case 'Enter':
          e.preventDefault();
          onChange(options[focusedIndex].value);
          closeMenu();
          break;
        case 'Escape':
          e.preventDefault();
          closeMenu();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, focusedIndex, options, onChange, closeMenu]);

  // Reset focused index when opening to current selection
  useEffect(() => {
    if (!isOpen) return;
    const currentIndex = options.findIndex(opt => opt.value === value);
    queueMicrotask(() => setFocusedIndex(currentIndex >= 0 ? currentIndex : 0));
  }, [isOpen, value, options]);

  const portalRoot = useMemo(() => {
    if (typeof document === 'undefined') return null;
    return document.body;
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      const trigger = dropdownRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const margin = 8;
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;

      const maxMenuHeight = 288; // max-h-72
      const availableBelow = Math.max(0, viewportHeight - rect.bottom - margin);
      const availableAbove = Math.max(0, rect.top - margin);

      const shouldOpenUp = availableBelow < 180 && availableAbove > availableBelow;
      const placement: 'top' | 'bottom' = shouldOpenUp ? 'top' : 'bottom';

      const maxHeight = Math.min(
        maxMenuHeight,
        placement === 'bottom' ? availableBelow : availableAbove
      );

      const minWidth = rect.width;
      const maxWidth = viewportWidth - margin * 2;

      const left = Math.min(Math.max(rect.left, margin), viewportWidth - margin);
      const top =
        placement === 'bottom'
          ? rect.bottom + margin
          : Math.max(margin, rect.top - margin - maxHeight);

      setMenuPlacement(placement);
      setMenuStyle({
        position: 'fixed',
        left,
        top,
        minWidth,
        maxWidth,
        maxHeight,
      });
    };

    updatePosition();

    const onScrollOrResize = () => updatePosition();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);

    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [isOpen]);

  return (
    <div ref={dropdownRef} className={cn('relative', isOpen && 'z-[70]', className)}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => {
          if (isOpen) closeMenu();
          else setIsOpen(true);
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-all duration-200',
          isActive
            ? 'border-indigo-500/35 bg-indigo-500/12 text-indigo-200'
            : 'border-white/10 bg-white/[0.02] text-slate-300 hover:bg-white/5 hover:text-white',
          triggerClassName
        )}
      >
        {icon && <span className="w-3 h-3">{icon}</span>}
        {label && <span>{label}:</span>}
        <span>{selectedOption?.label || placeholder || 'Select...'}</span>
        {selectedOption?.count !== undefined && (
          <span className="text-xs text-slate-400 tabular-nums">({selectedOption.count})</span>
        )}
        <ChevronDown className={cn('w-3 h-3 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {/* Dropdown Menu */}
      {isOpen && portalRoot && menuStyle
        ? createPortal(
            <div
              ref={menuRef}
              style={menuStyle}
              className={cn(
                'z-[9999] overflow-y-auto rounded-xl border border-white/10 bg-[#11151f] shadow-2xl shadow-black/70 ring-1 ring-black/40 animate-fade-in',
                menuPlacement === 'top' ? 'origin-bottom' : 'origin-top',
                menuClassName
              )}
              role="listbox"
            >
              {options.map((option, index) => (
                <button
                  type="button"
                  key={String(option.value)}
                  onClick={() => {
                    onChange(option.value);
                    closeMenu();
                  }}
                  onMouseEnter={() => setFocusedIndex(index)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors',
                    value === option.value && 'bg-white/10 text-white',
                    focusedIndex === index && 'bg-white/5',
                    value !== option.value &&
                      focusedIndex !== index &&
                      'text-slate-300/70 hover:bg-white/5 hover:text-white'
                  )}
                  role="option"
                  aria-selected={value === option.value}
                >
                  {/* Icon or Dot indicator */}
                  {option.icon ? (
                    <span className="shrink-0">{option.icon}</span>
                  ) : option.dot !== undefined ? (
                    option.dot ? (
                      <span className={cn('h-2 w-2 rounded-full', option.dot)} />
                    ) : (
                      <span className="h-2 w-2 rounded-full border border-slate-600" />
                    )
                  ) : (
                    // Radio button style indicator
                    <span
                      className={cn(
                        'flex h-3 w-3 items-center justify-center rounded-full border',
                        value === option.value ? 'border-indigo-400' : 'border-slate-600'
                      )}
                    >
                      {value === option.value && (
                        <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                      )}
                    </span>
                  )}
                  <span className="flex-1 truncate text-left">{option.label}</span>
                  {option.count !== undefined && (
                    <span className="text-xs text-slate-500 tabular-nums">{option.count}</span>
                  )}
                </button>
              ))}
            </div>,
            portalRoot
          )
        : null}
    </div>
  );
}
