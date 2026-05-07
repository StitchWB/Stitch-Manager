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
  unit = 'сек',
  disabled,
  tooltip,
  className,
}: NumberInputProps) {
  const decrement = () => onChange(Math.max(min, value - step));
  const increment = () => onChange(Math.min(max, value + step));

  const content = (
    <div className={cn('flex flex-col', label && 'gap-1', className)}>
      {label && (
        <div className="text-[9px] uppercase font-medium text-slate-600 tracking-wider px-0.5 leading-none">
          {label}
        </div>
      )}
      <div
        className={cn(
          'flex items-stretch h-8 bg-black/40 rounded-md border border-white/[0.06] overflow-hidden transition-all duration-200 focus-within:border-indigo-500/50',
          disabled && 'opacity-50 grayscale cursor-not-allowed'
        )}
      >
        <button
          type="button"
          onClick={decrement}
          disabled={disabled || value <= min}
          className="px-2.5 hover:bg-white/5 text-slate-400 hover:text-white transition-colors disabled:opacity-30 border-r border-white/[0.04]"
        >
          <Minus className="w-3 h-3" />
        </button>
        <div className="flex-1 flex items-center justify-center bg-white/[0.02] px-2 min-w-[50px]">
          <span className="text-sm font-mono font-bold text-indigo-400 tracking-tight leading-none">
            {value}
            <span className="ml-0.5 text-[9px] text-slate-600 font-medium uppercase">{unit}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={increment}
          disabled={disabled || value >= max}
          className="px-2.5 hover:bg-white/5 text-slate-400 hover:text-white transition-colors disabled:opacity-30 border-l border-white/[0.04]"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );

  return tooltip ? <Tooltip content={tooltip}>{content}</Tooltip> : content;
}
