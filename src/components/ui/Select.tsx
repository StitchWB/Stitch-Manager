import { forwardRef, useState, useRef, useEffect, useCallback, Children, isValidElement } from 'react';
import { cn } from '../../lib/utils';
import { FieldHint, fieldClasses, getFieldShellClassName, useFieldA11y } from './field';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label?: string;
  error?: string;
  hint?: string;
  placeholder?: string;
  containerClassName?: string;
  shellClassName?: string;
  options?: SelectOption[];
  onValueChange?: (value: string) => void;
}

/**
 * Custom dropdown select with full dark-theme styling.
 * Supports both `options` prop and `<option>` children for backward compatibility.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      className,
      label,
      error,
      hint,
      containerClassName,
      shellClassName,
      options,
      children,
      id,
      onChange,
      onValueChange,
      value,
      disabled,
      placeholder,
      'aria-describedby': ariaDescribedBy,
      ...props
    },
    ref
  ) => {
    const a11y = useFieldA11y({
      id,
      error,
      hint,
      describedBy: ariaDescribedBy,
      idPrefix: 'select',
    });

    // Resolve options from either prop or children
    const resolvedOptions: SelectOption[] = options ?? extractOptionsFromChildren(children);

    const [open, setOpen] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const hiddenRef = useRef<HTMLSelectElement>(null);

    // Merge refs
    const setRefs = useCallback(
      (el: HTMLSelectElement | null) => {
        (hiddenRef as React.MutableRefObject<HTMLSelectElement | null>).current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) (ref as React.MutableRefObject<HTMLSelectElement | null>).current = el;
      },
      [ref]
    );

    const currentValue = (value ?? '') as string;
    const selectedOption = resolvedOptions.find(o => o.value === currentValue);
    const displayLabel = selectedOption?.label ?? currentValue ?? '';

    // Close on outside click
    useEffect(() => {
      if (!open) return;
      const handler = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setOpen(false);
        }
      };
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    // Scroll highlighted item into view
    useEffect(() => {
      if (!open || highlightedIndex < 0 || !listRef.current) return;
      const item = listRef.current.children[highlightedIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }, [highlightedIndex, open]);

    const selectValue = (val: string) => {
      // Fire synthetic change event on hidden select
      if (hiddenRef.current) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          'value'
        )?.set;
        nativeInputValueSetter?.call(hiddenRef.current, val);
        const event = new Event('change', { bubbles: true });
        hiddenRef.current.dispatchEvent(event);
      }
      onValueChange?.(val);
      if (onChange) {
        const syntheticEvent = {
          target: { value: val },
          currentTarget: { value: val },
        } as React.ChangeEvent<HTMLSelectElement>;
        onChange(syntheticEvent);
      }
      setOpen(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (disabled) return;

      switch (e.key) {
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (open && highlightedIndex >= 0) {
            const opt = resolvedOptions[highlightedIndex];
            if (opt && !opt.disabled) selectValue(opt.value);
          } else {
            setOpen(true);
            const idx = resolvedOptions.findIndex(o => o.value === currentValue);
            setHighlightedIndex(idx >= 0 ? idx : 0);
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (!open) {
            setOpen(true);
            const idx = resolvedOptions.findIndex(o => o.value === currentValue);
            setHighlightedIndex(idx >= 0 ? idx : 0);
          } else {
            setHighlightedIndex(prev => {
              let next = prev + 1;
              while (next < resolvedOptions.length && resolvedOptions[next].disabled) next++;
              return next < resolvedOptions.length ? next : prev;
            });
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (open) {
            setHighlightedIndex(prev => {
              let next = prev - 1;
              while (next >= 0 && resolvedOptions[next].disabled) next--;
              return next >= 0 ? next : prev;
            });
          }
          break;
        case 'Escape':
          e.preventDefault();
          setOpen(false);
          break;
        case 'Tab':
          setOpen(false);
          break;
      }
    };

    return (
      <div className={cn(fieldClasses.container, containerClassName)} ref={containerRef}>
        {label && (
          <label htmlFor={a11y.fieldId} className={fieldClasses.label}>
            {label}
          </label>
        )}

        {/* Hidden native select for form compatibility */}
        <select
          ref={setRefs}
          id={a11y.fieldId}
          value={currentValue}
          onChange={e => {
            onChange?.(e);
            onValueChange?.(e.target.value);
          }}
          disabled={disabled}
          aria-hidden="true"
          tabIndex={-1}
          className="sr-only"
          {...props}
        >
          {resolvedOptions.map(opt => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Custom trigger button */}
        <div className="relative">
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={`${a11y.fieldId}-listbox`}
            aria-invalid={error ? true : undefined}
            aria-describedby={a11y.describedBy}
            aria-disabled={disabled}
            disabled={disabled}
            onClick={() => {
              if (!disabled) {
                setOpen(prev => !prev);
                if (!open) {
                  const idx = resolvedOptions.findIndex(o => o.value === currentValue);
                  setHighlightedIndex(idx >= 0 ? idx : 0);
                }
              }
            }}
            onKeyDown={handleKeyDown}
            className={cn(
              getFieldShellClassName(error, disabled),
              'flex items-center justify-between w-full h-8 px-3 text-sm text-left cursor-pointer',
              'text-slate-200 focus:outline-none',
              disabled && 'cursor-not-allowed',
              shellClassName,
              className
            )}
          >
            <span className={cn('truncate', !selectedOption && 'text-slate-500')}>
              {displayLabel || placeholder || ''}
            </span>
            <ChevronDown
              size={14}
              className={cn(
                'shrink-0 ml-2 text-slate-500 transition-transform duration-200',
                open && 'rotate-180'
              )}
            />
          </button>

          {/* Dropdown list */}
          {open && (
            <ul
              ref={listRef}
              id={`${a11y.fieldId}-listbox`}
              role="listbox"
              aria-activedescendant={
                highlightedIndex >= 0
                  ? `${a11y.fieldId}-option-${highlightedIndex}`
                  : undefined
              }
              className={cn(
                'absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-lg',
                'bg-slate-900 border border-white/10 shadow-xl shadow-black/40',
                'py-1 text-sm'
              )}
            >
              {resolvedOptions.map((opt, idx) => {
                const isSelected = opt.value === currentValue;
                const isHighlighted = idx === highlightedIndex;
                return (
                  <li
                    key={opt.value}
                    id={`${a11y.fieldId}-option-${idx}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={opt.disabled}
                    onMouseEnter={() => !opt.disabled && setHighlightedIndex(idx)}
                    onMouseDown={e => {
                      e.preventDefault();
                      if (!opt.disabled) selectValue(opt.value);
                    }}
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none transition-colors',
                      isHighlighted && !opt.disabled && 'bg-white/10',
                      isSelected && 'text-white font-medium',
                      !isSelected && 'text-slate-300',
                      opt.disabled && 'text-slate-600 cursor-not-allowed opacity-50'
                    )}
                  >
                    <Check
                      size={12}
                      className={cn(
                        'shrink-0 text-slate-400 transition-opacity',
                        isSelected ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="truncate">{opt.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <FieldHint hint={hint} error={error} hintId={a11y.hintId} errorId={a11y.errorId} />
      </div>
    );
  }
);

Select.displayName = 'Select';

/** Extract SelectOption[] from <option> children for backward compatibility */
function extractOptionsFromChildren(children: React.ReactNode): SelectOption[] {
  const opts: SelectOption[] = [];
  Children.forEach(children, child => {
    if (isValidElement(child) && child.type === 'option') {
      const props = child.props as { value?: string; disabled?: boolean; children?: React.ReactNode };
      opts.push({
        value: String(props.value ?? ''),
        label: String(props.children ?? props.value ?? ''),
        disabled: props.disabled,
      });
    }
  });
  return opts;
}
