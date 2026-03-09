import { createElement, useId } from 'react';
import { cn } from '../../lib/utils';

export const fieldClasses = {
  container: 'flex flex-col gap-1.5 w-full',
  label: 'text-xs font-semibold text-slate-300 px-0.5 leading-4',
  shellBase:
    'relative group rounded-lg overflow-hidden bg-white/[0.05] border transition-all duration-200',
  shellOk: 'border-white/15 focus-within:border-indigo-400/70',
  shellError: 'border-red-500/50 focus-within:border-red-500',
  shellDisabled: 'opacity-50 grayscale-[0.5]',
  hintText: 'text-xs text-slate-400 px-0.5 mt-0.5',
  errorText: 'text-xs text-red-300 px-0.5 mt-0.5',
};

export const getFieldShellClassName = (error?: string, disabled?: boolean) =>
  cn(
    fieldClasses.shellBase,
    error ? fieldClasses.shellError : fieldClasses.shellOk,
    disabled && fieldClasses.shellDisabled
  );

interface UseFieldA11yParams {
  id?: string;
  error?: string;
  hint?: string;
  describedBy?: string;
  idPrefix: 'input' | 'select' | 'textarea';
}

export function useFieldA11y({ id, error, hint, describedBy, idPrefix }: UseFieldA11yParams) {
  const generatedId = useId();
  const fieldId = id ?? `${idPrefix}-${generatedId}`;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const mergedDescribedBy = [describedBy, hintId, errorId].filter(Boolean).join(' ') || undefined;

  return {
    fieldId,
    hintId,
    errorId,
    describedBy: mergedDescribedBy,
    invalid: Boolean(error),
  };
}

interface FieldHintProps {
  hint?: string;
  error?: string;
  hintId?: string;
  errorId?: string;
}

export function FieldHint({ hint, error, hintId, errorId }: FieldHintProps) {
  if (error) {
    return createElement('p', { id: errorId, className: fieldClasses.errorText }, error);
  }

  if (hint) {
    return createElement('p', { id: hintId, className: fieldClasses.hintText }, hint);
  }

  return null;
}
