import { Minus, Plus } from 'lucide-react';
import { Tooltip } from '../Tooltip';
import { cn } from '../../lib/utils';

export interface NumberInputProps {
  label?: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  tooltip?: string;
  className?: string;
}

export function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = 's',
  disabled,
  tooltip,
  className,
}: NumberInputProps) {
  const decrement = () => onChange(Math.max(min, value - step));
  const increment = () => onChange(Math.min(max, value + step));

  const content = (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider px-1">{label}</div>}
      <div
        className={cn(
          'flex items-stretch h-9 bg-black/40 rounded-lg border border-white/10 overflow-hidden transition-all duration-200 focus-within:border-indigo-500/50',
          disabled && 'opacity-50 grayscale cursor-not-allowed'
        )}
      >
        <button
          type="button"
          onClick={decrement}
          disabled={disabled || value <= min}
          className="px-3 hover:bg-white/5 text-slate-400 hover:text-white transition-colors disabled:opacity-30 border-r border-white/5"
        >
          <Minus className="w-3 h-3" />
        </button>
        <div className="flex-1 flex items-center justify-center bg-white/[0.02] px-4 min-w-[60px]">
          <span className="text-sm font-mono font-bold text-indigo-400 tracking-tight">
            {value}
            <span className="ml-0.5 text-[10px] text-slate-500 font-medium uppercase">{unit}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={increment}
          disabled={disabled || value >= max}
          className="px-3 hover:bg-white/5 text-slate-400 hover:text-white transition-colors disabled:opacity-30 border-l border-white/5"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );

  return tooltip ? <Tooltip content={tooltip}>{content}</Tooltip> : content;
}
