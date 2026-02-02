import { cn } from '../../lib/utils';

interface RangeSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  showMinMax?: boolean;
  minLabel?: string;
  maxLabel?: string;
  valueFormatter?: (value: number) => string;
  disabled?: boolean;
  className?: string;
}

export function RangeSlider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = '',
  showMinMax = false,
  minLabel,
  maxLabel,
  valueFormatter,
  disabled = false,
  className,
}: RangeSliderProps) {
  const formatValue = (val: number): string => {
    if (valueFormatter) {
      return valueFormatter(val);
    }
    return `${val}${unit}`;
  };

  return (
    <div className={cn('rounded-lg p-3', className)} style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.05)',
    }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-400">{label}</span>
        <span className="text-xs font-mono text-indigo-400">
          {formatValue(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        className="w-full h-1 rounded-full appearance-none cursor-pointer accent-indigo-500"
        style={{ background: 'rgba(255,255,255,0.1)' }}
      />
      {showMinMax && (minLabel || maxLabel) && (
        <div className="flex justify-between mt-1">
          <span className="text-[9px] text-slate-600">{minLabel || min}</span>
          <span className="text-[9px] text-slate-600">{maxLabel || max}</span>
        </div>
      )}
    </div>
  );
}
