import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  containerClassName?: string;
  options?: Array<{ value: string; label: string }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, containerClassName, options, children, ...props }, ref) => {
    return (
      <div className={cn('flex flex-col gap-1.5 w-full', containerClassName)}>
        {label && (
          <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider px-1">
            {label}
          </label>
        )}
        <div
          className={cn(
            'relative group rounded-lg overflow-hidden bg-white/[0.03] border transition-all duration-200',
            error
              ? 'border-red-500/50 focus-within:border-red-500'
              : 'border-white/10 focus-within:border-indigo-500/50',
            props.disabled && 'opacity-50 grayscale-[0.5]'
          )}
        >
          <select
            ref={ref}
            className={cn(
              'w-full bg-transparent px-3 py-2 text-sm text-slate-200 transition-all duration-200 outline-none appearance-none cursor-pointer',
              'bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3E%3Cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'m6 8 4 4 4-4\'/%3E%3C/svg%3E")] bg-[length:1.25rem] bg-[right_0.5rem_center] bg-no-repeat pr-10',
              className
            )}
            style={{ colorScheme: 'dark' }}
            {...props}
          >
            {options
              ? options.map(opt => (
                  <option key={opt.value} value={opt.value} className="bg-slate-900 text-slate-200">
                    {opt.label}
                  </option>
                ))
              : children}
          </select>
        </div>
        {error && <p className="text-[10px] text-red-400 px-1 mt-0.5">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';
