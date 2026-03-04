import { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { FieldHint, fieldClasses, getFieldShellClassName, useFieldA11y } from './field';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  containerClassName?: string;
  shellClassName?: string;
  options?: SelectOption[];
  onValueChange?: (value: string) => void;
}

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

    const handleChange: React.ChangeEventHandler<HTMLSelectElement> = event => {
      onChange?.(event);
      onValueChange?.(event.target.value);
    };

    return (
      <div className={cn(fieldClasses.container, containerClassName)}>
        {label && (
          <label htmlFor={a11y.fieldId} className={fieldClasses.label}>
            {label}
          </label>
        )}
        <div className={cn(getFieldShellClassName(error, props.disabled), shellClassName)}>
          <select
            ref={ref}
            id={a11y.fieldId}
            onChange={handleChange}
            aria-invalid={error ? true : props['aria-invalid']}
            aria-describedby={a11y.describedBy}
            className={cn(
              'w-full bg-transparent px-3 py-2 text-sm text-slate-200 transition-all duration-200 outline-none appearance-none cursor-pointer',
              "bg-[url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3E%3C/svg%3E\")] bg-[length:1.25rem] bg-[right_0.5rem_center] bg-no-repeat pr-10",
              className
            )}
            style={{ colorScheme: 'dark' }}
            {...props}
          >
            {options
              ? options.map(opt => (
                  <option
                    key={opt.value}
                    value={opt.value}
                    disabled={opt.disabled}
                    className="bg-slate-900 text-slate-200"
                  >
                    {opt.label}
                  </option>
                ))
              : children}
          </select>
        </div>
        <FieldHint hint={hint} error={error} hintId={a11y.hintId} errorId={a11y.errorId} />
      </div>
    );
  }
);

Select.displayName = 'Select';
