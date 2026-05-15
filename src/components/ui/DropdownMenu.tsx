import { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface DropdownMenuOption<TValue = string> {
  value: TValue;
  label: string;
  disabled?: boolean;
  icon?: React.ReactNode;
}

export interface DropdownMenuProps<TValue = string> {
  value: TValue;
  onValueChange: (value: TValue) => void;
  options: DropdownMenuOption<TValue>[];
  triggerLabel?: string;
  placeholder?: string;
  triggerIcon?: React.ReactNode;
  className?: string;
  menuClassName?: string;
  buttonClassName?: string;
  disabled?: boolean;
}

export function DropdownMenu<TValue = string>({
  value,
  onValueChange,
  options,
  triggerLabel,
  placeholder,
  triggerIcon,
  className,
  menuClassName,
  buttonClassName,
  disabled,
}: DropdownMenuProps<TValue>) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const selectedOption = useMemo(() => options.find(opt => opt.value === value), [options, value]);
  const selectedIndex = useMemo(
    () => options.findIndex(opt => opt.value === value),
    [options, value]
  );

  // Position menu via fixed positioning in a portal
  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) return;

    const updatePosition = () => {
      const trigger = buttonRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const margin = 4;
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

      const width = rect.width;
      const left = Math.min(Math.max(rect.left, margin), viewportWidth - margin - width);
      const top =
        placement === 'bottom'
          ? rect.bottom + margin
          : Math.max(margin, rect.top - margin - maxHeight);

      setMenuStyle({
        position: 'fixed',
        left,
        top,
        width,
        maxHeight,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideRoot = rootRef.current?.contains(target) ?? false;
      const insideMenu = menuRef.current?.contains(target) ?? false;
      if (!insideRoot && !insideMenu) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsOpen(false);
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setFocusedIndex(prev => (prev + 1) % options.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setFocusedIndex(prev => (prev - 1 + options.length) % options.length);
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const option = options[focusedIndex];
        if (!option || option.disabled) return;
        onValueChange(option.value);
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [focusedIndex, isOpen, onValueChange, options]);

  const menu = isOpen ? (
    <div
      ref={menuRef}
      className={cn(
        'z-50 bg-ds-surface-elevated/95 backdrop-blur-xl border border-ds-border rounded-lg shadow-2xl overflow-hidden animate-fade-in max-w-full',
        menuClassName
      )}
      style={menuStyle ?? {}}
      role="listbox"
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={`${String(option.value)}-${index}`}
            type="button"
            role="option"
            aria-selected={selected}
            disabled={option.disabled}
            onMouseEnter={() => setFocusedIndex(index)}
            onClick={() => {
              if (option.disabled) return;
              onValueChange(option.value);
              setIsOpen(false);
            }}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors',
              selected && 'bg-white/10 text-white',
              focusedIndex === index && !selected && 'bg-white/5 text-white',
              !selected &&
                focusedIndex !== index &&
                'text-slate-400 hover:bg-white/5 hover:text-white',
              option.disabled && 'opacity-40 cursor-not-allowed pointer-events-none'
            )}
          >
            {option.icon ? <span className="shrink-0">{option.icon}</span> : null}
            <span className="flex-1">{option.label}</span>
          </button>
        );
      })}
    </div>
  ) : null;

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!isOpen) {
            setFocusedIndex(selectedIndex >= 0 ? selectedIndex : 0);
          }
          setIsOpen(prev => !prev);
        }}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200',
          'bg-transparent border border-white/10 text-slate-400 hover:bg-white/5 hover:text-slate-300',
          disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
          buttonClassName
        )}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {triggerIcon ? <span className="w-3 h-3 shrink-0">{triggerIcon}</span> : null}
        {triggerLabel ? <span>{triggerLabel}:</span> : null}
        <span>{selectedOption?.label || placeholder || 'Select...'}</span>
        <ChevronDown className={cn('w-3 h-3 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
