import { useRef } from 'react';

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
  const inputRef = useRef<HTMLInputElement>(null);
  // Track geometry is frozen at drag start. The value being dragged can
  // rescale the whole UI (rem-based layout), so re-measuring the track on
  // every pointermove creates a feedback loop: value -> scale -> track size
  // -> value, which makes the slider jitter. Computing the value from the
  // frozen rect breaks the loop.
  const dragTrack = useRef<{ left: number; width: number } | null>(null);

  const valueFromClientX = (clientX: number): number | null => {
    const track = dragTrack.current;
    if (!track || track.width <= 0) return null;
    const ratio = Math.min(1, Math.max(0, (clientX - track.left) / track.width));
    const raw = min + ratio * (max - min);
    const stepped = Math.min(max, Math.max(min, Math.round(raw / step) * step));
    return parseFloat(stepped.toFixed(4));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragTrack.current = { left: rect.left, width: rect.width };
    el.setPointerCapture(e.pointerId);
    // Stop the native pointer->value mapping from fighting us: the native
    // mapping re-measures the (rescaling) track and would oscillate.
    e.preventDefault();
    el.focus({ preventScroll: true });
    const next = valueFromClientX(e.clientX);
    if (next !== null) onChange(next);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLInputElement>) => {
    if (!dragTrack.current) return;
    const next = valueFromClientX(e.clientX);
    if (next !== null) onChange(next);
  };

  const endDrag = () => {
    dragTrack.current = null;
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Keyboard path (arrows/Home/End). During a pointer drag the value is
    // driven from the frozen track geometry above.
    if (dragTrack.current) return;
    onChange(parseFloat(e.target.value));
  };

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
        ref={inputRef}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
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
