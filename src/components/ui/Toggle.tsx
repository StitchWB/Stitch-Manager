import { cn } from '../../lib/utils';
import { Tooltip } from './Tooltip';

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  tooltip?: string;
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled,
  tooltip,
}: ToggleProps) {
  const content = (
    <label
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors',
        checked ? 'bg-indigo-500/10' : 'bg-white/[0.02]',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <span className="text-[10px] text-slate-400 flex-1">{label}</span>
      <div
        className={cn(
          'w-7 h-4 rounded-full transition-colors relative',
          checked ? 'bg-indigo-500' : 'bg-white/10'
        )}
      >
        <div
          className={cn(
            'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform',
            checked ? 'translate-x-3.5' : 'translate-x-0.5'
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
