import { Minus, Plus } from 'lucide-react';
import { Tooltip } from '../Tooltip';

export interface NumberInputProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  tooltip?: string;
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
}: NumberInputProps) {
  const decrement = () => onChange(Math.max(min, value - step));
  const increment = () => onChange(Math.min(max, value + step));

  const content = (
    <div
      className="rounded-lg p-2"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
    >
      <div className="text-[10px] text-slate-500 mb-1.5">{label}</div>
      <div className="flex items-center gap-1">
        <button
          onClick={decrement}
          disabled={disabled || value <= min}
          className="w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Minus className="w-3 h-3" />
        </button>
        <span className="flex-1 text-center text-xs font-mono text-indigo-400">
          {value}
          {unit}
        </span>
        <button
          onClick={increment}
          disabled={disabled || value >= max}
          className="w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );

  return tooltip ? <Tooltip content={tooltip}>{content}</Tooltip> : content;
}
