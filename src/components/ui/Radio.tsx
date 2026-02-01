import { cn } from '../../lib/utils';

interface RadioProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  description?: string;
}

export function Radio({ className, label, description, ...props }: RadioProps) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 group cursor-pointer select-none py-1.5 px-2 rounded-lg transition-colors hover:bg-white/[0.02]',
        props.disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
        className
      )}
    >
      <div className="relative flex items-center justify-center mt-0.5 shrink-0">
        <input
          type="radio"
          className={cn(
            'appearance-none w-4 h-4 rounded-full border border-white/20 bg-white/5 transition-all duration-200',
            'checked:border-indigo-500 checked:border-[5px] hover:border-white/40 group-hover:border-white/40',
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
