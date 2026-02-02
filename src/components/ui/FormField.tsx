import { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { Input, type InputProps } from './Input';
import { Select, type SelectProps } from './Select';

interface BaseFormFieldProps {
  hint?: string;
  required?: boolean;
  containerClassName?: string;
}

interface InputFormFieldProps extends BaseFormFieldProps {
  type?: 'input';
  inputProps: Omit<InputProps, 'containerClassName'>;
}

interface TextareaFormFieldProps extends BaseFormFieldProps {
  type: 'textarea';
  textareaProps: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    label?: string;
    error?: string;
  };
}

interface SelectFormFieldProps extends BaseFormFieldProps {
  type: 'select';
  selectProps: Omit<SelectProps, 'containerClassName'>;
}

type FormFieldProps = InputFormFieldProps | TextareaFormFieldProps | SelectFormFieldProps;

export const FormField = forwardRef<
  HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  FormFieldProps
>((props, ref) => {
  const { hint, required, containerClassName } = props;

  if (props.type === 'select') {
    return (
      <div className={containerClassName}>
        <Select
          ref={ref as React.Ref<HTMLSelectElement>}
          {...props.selectProps}
        />
        {hint && !props.selectProps.error && (
          <p className="text-[10px] text-slate-400 px-1 mt-0.5">{hint}</p>
        )}
      </div>
    );
  }

  if (props.type === 'textarea') {
    const { label, error, className, ...textareaProps } = props.textareaProps;
    return (
      <div className={cn('flex flex-col gap-1.5 w-full', containerClassName)}>
        {label && (
          <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider px-1">
            {label}
            {required && <span className="text-red-400 ml-1">*</span>}
          </label>
        )}
        <div
          className={cn(
            'relative group rounded-lg overflow-hidden bg-white/[0.03] border transition-all duration-200',
            error
              ? 'border-red-500/50 focus-within:border-red-500'
              : 'border-white/10 focus-within:border-indigo-500/50',
            textareaProps.disabled && 'opacity-50 grayscale-[0.5]'
          )}
        >
          <textarea
            ref={ref as React.Ref<HTMLTextAreaElement>}
            className={cn(
              'w-full bg-transparent px-3 py-2 text-sm text-slate-200 placeholder-slate-600 transition-all duration-200 outline-none resize-none font-sans',
              className
            )}
            {...textareaProps}
          />
        </div>
        {hint && !error && <p className="text-[10px] text-slate-400 px-1 mt-0.5">{hint}</p>}
        {error && <p className="text-[10px] text-red-400 px-1 mt-0.5">{error}</p>}
      </div>
    );
  }

  // Default to input
  return (
    <div className={containerClassName}>
      <Input
        ref={ref as React.Ref<HTMLInputElement>}
        {...props.inputProps}
      />
      {hint && !props.inputProps.error && (
        <p className="text-[10px] text-slate-400 px-1 mt-0.5">{hint}</p>
      )}
    </div>
  );
});

FormField.displayName = 'FormField';

export type { FormFieldProps };
