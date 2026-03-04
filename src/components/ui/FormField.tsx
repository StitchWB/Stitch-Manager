import { forwardRef } from 'react';
import { Input, type InputProps } from './Input';
import { Select, type SelectProps } from './Select';
import { Textarea, type TextareaProps } from './Textarea';

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
  textareaProps: Omit<TextareaProps, 'containerClassName'>;
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
        <Select ref={ref as React.Ref<HTMLSelectElement>} {...props.selectProps} hint={hint} />
      </div>
    );
  }

  if (props.type === 'textarea') {
    return (
      <div className={containerClassName}>
        <Textarea
          ref={ref as React.Ref<HTMLTextAreaElement>}
          {...props.textareaProps}
          hint={hint}
          label={
            props.textareaProps.label
              ? `${props.textareaProps.label}${required ? ' *' : ''}`
              : props.textareaProps.label
          }
        />
      </div>
    );
  }

  // Default to input
  return (
    <div className={containerClassName}>
      <Input ref={ref as React.Ref<HTMLInputElement>} {...props.inputProps} hint={hint} />
    </div>
  );
});

FormField.displayName = 'FormField';

export type { FormFieldProps };
