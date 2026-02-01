import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightElement?: React.ReactNode;
  prefixText?: string;
  suffixText?: string;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      label,
      error,
      leftIcon,
      rightElement,
      prefixText,
      suffixText,
      containerClassName,
      ...props
    },
    ref
  ) => {
    return (
      <div className={cn('flex flex-col gap-1.5 w-full', containerClassName)}>
        {label && (
          <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider px-1">
            {label}
          </label>
        )}
        <div
          className={cn(
            'relative group flex items-center h-9 rounded-lg overflow-hidden bg-white/[0.03] border transition-all duration-200',
            error
              ? 'border-red-500/50 focus-within:border-red-500'
              : 'border-white/10 focus-within:border-indigo-500/50',
            props.disabled && 'opacity-50 grayscale-[0.5]'
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
        {error && <p className="text-[10px] text-red-400 px-1 mt-0.5">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
