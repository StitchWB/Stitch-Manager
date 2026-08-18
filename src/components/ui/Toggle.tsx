import { cn } from '../../lib/utils';
import { Tooltip } from './Tooltip';

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  tooltip?: string;
  className?: string;
  size?: 'md' | 'sm';
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled,
  tooltip,
  className,
  size = 'md',
}: ToggleProps) {
  const compact = size === 'sm';

  const content = (
    <label
      className={cn(
        compact
          ? 'flex items-center gap-2 cursor-pointer select-none group'
          : 'flex items-center gap-3 cursor-pointer select-none group',
        disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
        className
      )}
    >
      {label && (
        <span
          className={cn(
            compact
              ? 'text-xs font-medium text-slate-300 group-hover:text-slate-100 transition-colors'
              : 'text-sm font-medium text-slate-300 group-hover:text-slate-100 transition-colors'
          )}
        >
          {label}
        </span>
      )}
      <div
        className={cn(
          compact
            ? 'relative h-4 w-7 shrink-0 rounded-full border transition-all duration-200'
            : 'relative h-5 w-9 shrink-0 rounded-full border transition-all duration-200',
          checked
            ? 'bg-indigo-500/85 border-indigo-400/60 shadow-[0_0_0_1px_rgba(99,102,241,0.25)]'
            : 'bg-black/40 border-white/15'
        )}
      >
        <div
          className={cn(
            compact
              ? 'absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-all duration-200'
              : 'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-200',
            checked ? (compact ? 'translate-x-3' : 'translate-x-4') : 'translate-x-0'
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
