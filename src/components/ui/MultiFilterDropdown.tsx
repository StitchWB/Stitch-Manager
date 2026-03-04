import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import type { FilterOption } from './FilterDropdown';

export interface MultiFilterDropdownProps<T = string> {
  values: T[];
  onChange: (values: T[]) => void;
  options: FilterOption<T>[];
  icon?: ReactNode;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  /** Show as active/filtered when values not empty */
  showActiveState?: boolean;
  /** Customize trigger label for selected values */
  renderValue?: (values: T[]) => string;
  /** Whether to show footer actions (All/Clear) */
  showFooterActions?: boolean;
  footerAllLabel?: string;
  footerClearLabel?: string;
}

export function MultiFilterDropdown<T = string>({
  values,
  onChange,
  options,
  icon,
  placeholder,
  className = '',
  triggerClassName,
  menuClassName,
  showActiveState = true,
  renderValue,
  showFooterActions = true,
  footerAllLabel,
  footerClearLabel,
}: MultiFilterDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<'top' | 'bottom'>('bottom');

  const isActive = showActiveState && values.length > 0;

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setMenuStyle(null);
  }, []);

  const portalRoot = useMemo(() => {
    if (typeof document === 'undefined') return null;
    return document.body;
  }, []);

  const selectedLabel = useMemo(() => {
    if (renderValue) return renderValue(values);
    if (values.length === 0) return placeholder || 'All';
    return `${values.length} selected`;
  }, [placeholder, renderValue, values]);

  const isSelected = useCallback((value: T) => values.some(v => Object.is(v, value)), [values]);

  const toggleValue = useCallback(
    (value: T) => {
      if (isSelected(value)) {
        onChange(values.filter(v => !Object.is(v, value)));
      } else {
        onChange([...values, value]);
      }
    },
    [isSelected, onChange, values]
  );

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = dropdownRef.current?.contains(target) ?? false;
      const insideMenu = menuRef.current?.contains(target) ?? false;
      if (!insideTrigger && !insideMenu) closeMenu();
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
        case ' ': {
          e.preventDefault();
          const opt = options[focusedIndex];
          if (!opt) return;
          toggleValue(opt.value);
          break;
        }
        case 'Escape':
          e.preventDefault();
          closeMenu();
          break;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeMenu, focusedIndex, isOpen, options, toggleValue]);

  useEffect(() => {
    if (!isOpen) return;
    queueMicrotask(() => setFocusedIndex(0));
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const updatePosition = () => {
      const trigger = dropdownRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const margin = 8;
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;

      const maxMenuHeight = 320;
      const availableBelow = Math.max(0, viewportHeight - rect.bottom - margin);
      const availableAbove = Math.max(0, rect.top - margin);

      const shouldOpenUp = availableBelow < 200 && availableAbove > availableBelow;
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
      <button
        type="button"
        onClick={() => {
          if (isOpen) closeMenu();
          else setIsOpen(true);
        }}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-all duration-200',
          isActive
            ? 'border-indigo-500/35 bg-indigo-500/12 text-indigo-200'
            : 'border-white/10 bg-white/[0.02] text-slate-300 hover:bg-white/5 hover:text-white',
          triggerClassName
        )}
      >
        {icon && <span className="w-3 h-3">{icon}</span>}
        <span>{selectedLabel}</span>
        <ChevronDown className={cn('w-3 h-3 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && portalRoot && menuStyle
        ? createPortal(
            <div
              ref={menuRef}
              style={menuStyle}
              className={cn(
                'z-[9999] overflow-hidden rounded-xl border border-white/10 bg-[#11151f] shadow-2xl shadow-black/70 ring-1 ring-black/40 animate-fade-in',
                menuPlacement === 'top' ? 'origin-bottom' : 'origin-top',
                menuClassName
              )}
              role="listbox"
            >
              <div className="max-h-[320px] overflow-y-auto p-1">
                {options.map((option, index) => {
                  const checked = isSelected(option.value);
                  return (
                    <div
                      key={String(option.value)}
                      className={cn(
                        focusedIndex === index && 'bg-white/5 rounded-lg',
                        'flex items-center justify-between gap-2'
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onChange={() => toggleValue(option.value)}
                        label={
                          <div className="flex items-center gap-2">
                            {option.dot ? (
                              <span className={cn('h-2 w-2 rounded-full', option.dot)} />
                            ) : null}
                            <span className="text-xs text-slate-200">{option.label}</span>
                          </div>
                        }
                        className="flex-1"
                      />
                      {typeof option.count === 'number' ? (
                        <span className="px-2 text-[10px] tabular-nums text-slate-500">
                          {option.count}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              {showFooterActions ? (
                <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-black/20 px-2 py-2">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => onChange(options.map(o => o.value))}
                  >
                    {footerAllLabel || 'All'}
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => onChange([])}>
                    {footerClearLabel || 'Clear'}
                  </Button>
                </div>
              ) : null}
            </div>,
            portalRoot
          )
        : null}
    </div>
  );
}
