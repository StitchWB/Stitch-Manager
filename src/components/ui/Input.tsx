import { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { FieldHint, fieldClasses, getFieldShellClassName, useFieldA11y } from './field';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightElement?: React.ReactNode;
  prefixText?: string;
  suffixText?: string;
  containerClassName?: string;
  shellClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      label,
      error,
      hint,
      leftIcon,
      rightElement,
      prefixText,
      suffixText,
      containerClassName,
      shellClassName,
      id,
      'aria-invalid': ariaInvalid,
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
      idPrefix: 'input',
    });

    return (
      <div className={cn(fieldClasses.container, containerClassName)}>
        {label && (
          <label htmlFor={a11y.fieldId} className={fieldClasses.label}>
            {label}
          </label>
        )}
        <div
          className={cn(
            getFieldShellClassName(error, props.disabled),
            'flex items-center h-8',
            shellClassName
          )}
        >
          {leftIcon && (
            <div className="pl-3 text-slate-500 group-focus-within:text-indigo-400 transition-colors shrink-0">
              {leftIcon}
            </div>
          )}

          {prefixText && (
            <span className="pl-3 pr-2 text-xs font-mono text-slate-500 select-none shrink-0 border-r border-white/5 mr-1 bg-white/[0.02] h-full flex items-center">
              {prefixText}
            </span>
          )}

          <input
            ref={ref}
            id={a11y.fieldId}
            aria-invalid={error ? true : ariaInvalid}
            aria-describedby={a11y.describedBy}
            className={cn(
              'flex-1 bg-transparent px-3 py-2 text-sm text-slate-200 placeholder-slate-600 transition-all duration-200 outline-none w-full min-w-0 font-sans',
              props.type === 'password' && 'font-mono tracking-widest',
              className
            )}
            {...props}
          />

          {suffixText && (
            <span className="pr-3 pl-2 text-xs font-mono text-slate-500 select-none shrink-0 border-l border-white/5 ml-1 bg-white/[0.02] h-full flex items-center">
              {suffixText}
            </span>
          )}

          {rightElement && (
            <div className="pr-1 flex items-center gap-1 shrink-0">{rightElement}</div>
          )}
        </div>
        <FieldHint hint={hint} error={error} hintId={a11y.hintId} errorId={a11y.errorId} />
      </div>
    );
  }
);

Input.displayName = 'Input';
