import { useEffect, useMemo, useRef, useState } from 'react';
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
  const rootRef = useRef<HTMLDivElement | null>(null);

  const selectedOption = useMemo(() => options.find(opt => opt.value === value), [options, value]);
  const selectedIndex = useMemo(
    () => options.findIndex(opt => opt.value === value),
    [options, value]
  );

  useEffect(() => {
    if (!isOpen) return;
    const onOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
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

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
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

      {isOpen ? (
        <div
          className={cn(
            'absolute z-50 mt-2 left-0 min-w-[160px] bg-ds-surface-elevated/95 backdrop-blur-xl border border-ds-border rounded-lg shadow-2xl overflow-hidden animate-fade-in',
            menuClassName
          )}
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
      ) : null}
    </div>
  );
}
