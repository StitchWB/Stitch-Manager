import { cn } from '../../lib/utils';
import { Tooltip } from './Tooltip';

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  tooltip?: string;
  className?: string;
}

export function Toggle({ label, checked, onChange, disabled, tooltip, className }: ToggleProps) {
  const content = (
    <label
      className={cn(
        'flex items-center gap-3 cursor-pointer select-none group',
        disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
        className
      )}
    >
      {label && (
        <span className="text-xs font-medium text-slate-400 group-hover:text-slate-200 transition-colors">
          {label}
        </span>
      )}
      <div
        className={cn(
          'w-8 h-4.5 rounded-full transition-all duration-300 relative border border-white/10 shadow-inner',
          checked ? 'bg-indigo-500/80 border-indigo-400/50' : 'bg-black/40'
        )}
      >
        <div
          className={cn(
            'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all duration-300 shadow-sm',
            checked ? 'translate-x-[16px] scale-110' : 'translate-x-0.5'
          )}
        />
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        disabled={disabled}
        className="sr-only"
      />
    </label>
  );

  return tooltip ? <Tooltip content={tooltip}>{content}</Tooltip> : content;
}
