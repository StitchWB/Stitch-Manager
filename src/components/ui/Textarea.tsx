import { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { FieldHint, fieldClasses, getFieldShellClassName, useFieldA11y } from './field';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  containerClassName?: string;
  shellClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      label,
      error,
      hint,
      containerClassName,
      shellClassName,
      id,
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
      idPrefix: 'textarea',
    });

    return (
      <div className={cn(fieldClasses.container, containerClassName)}>
        {label && (
          <label htmlFor={a11y.fieldId} className={fieldClasses.label}>
            {label}
          </label>
        )}
        <div className={cn(getFieldShellClassName(error, props.disabled), shellClassName)}>
          <textarea
            ref={ref}
            id={a11y.fieldId}
            aria-invalid={error ? true : props['aria-invalid']}
            aria-describedby={a11y.describedBy}
            className={cn(
              'w-full min-h-[96px] bg-transparent px-3 py-2 text-sm text-slate-200 placeholder-slate-600 transition-all duration-200 outline-none resize-y font-sans',
              className
            )}
            {...props}
          />
        </div>
        <FieldHint hint={hint} error={error} hintId={a11y.hintId} errorId={a11y.errorId} />
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
