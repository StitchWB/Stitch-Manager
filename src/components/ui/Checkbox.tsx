import { cn } from '../../lib/utils';

interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  description?: React.ReactNode;
}

export function Checkbox({ className, label, description, ...props }: CheckboxProps) {
  return (
    <label
      className={cn(
        'flex items-center gap-3 group cursor-pointer select-none py-1.5 px-2 rounded-lg transition-colors hover:bg-white/[0.02]',
        props.disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
        className
      )}
    >
      <div className="relative flex items-center justify-center shrink-0">
        <input
          type="checkbox"
          className={cn(
            'appearance-none h-[15px] w-[15px] rounded-[4px] border border-white/20 bg-white/[0.03] transition-all duration-200',
            "checked:bg-indigo-500 checked:border-indigo-500 checked:bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20viewBox%3D%220%200%2016%2016%22%20fill%3D%22white%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath%20d%3D%22M12.207%204.793a1%201%200%20010%201.414l-5%205a1%201%200%2001-1.414%200l-2-2a1%201%200%20011.414-1.414L6.5%209.086l4.293-4.293a1%201%200%20011.414%200z%22%2F%3E%3C%2Fsvg%3E')]",
            'hover:border-white/35 group-hover:border-white/35',
            'focus:outline-none focus:ring-4 focus:ring-indigo-500/10'
          )}
          {...props}
        />
      </div>
      {(label || description) && (
        <div className="flex flex-col">
          {label && (
            <span className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors">
              {label}
            </span>
          )}
          {description && (
            <span className="text-[10px] text-slate-500 leading-tight mt-0.5">{description}</span>
          )}
        </div>
      )}
    </label>
  );
}
