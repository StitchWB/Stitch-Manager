import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { Tooltip } from './Tooltip';

export interface SegmentedOption {
  label: string;
  value: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  tooltip?: string;
  /** Renders the option in the destructive/confirm red style (two-step confirm). */
  danger?: boolean;
}

export interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  size?: 'sm' | 'md';
  stretch?: boolean;
  responsiveLabels?: boolean;
  disabled?: boolean;
}

/**
 * Segmented control with a measured sliding indicator.
 *
 * We intentionally avoid framer-motion `layoutId` here because it triggers
 * a layout pass on all ancestors (the whole left panel "jumps") whenever
 * two SegmentedControl instances share a layout root.
 * The indicator is positioned from the ACTIVE BUTTON's real geometry
 * (offsetLeft/offsetWidth via refs), so it stays aligned whether segments are
 * equal-width (stretch) or content-sized (stretch=false) — and animates with a
 * CSS transition, zero reflow outside this element.
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  className,
  size = 'md',
  stretch = true,
  responsiveLabels = false,
  disabled = false,
}: SegmentedControlProps) {
  const activeIdx = options.findIndex(o => o.value === value);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(
    null
  );

  // Measure the active button's REAL geometry so the sliding indicator always
  // matches it. The previous equal-share math (`idx/count*100%`) only worked when
  // every segment had the same width (stretch=true); with content-sized segments
  // (stretch=false) the indicator drifted and overlapped neighbouring tabs.
  useLayoutEffect(() => {
    const measure = () => {
      const container = containerRef.current;
      const btn = btnRefs.current[activeIdx];
      if (!container || !btn) {
        setIndicator(null);
        return;
      }
      const c = container.getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      const left = b.left - c.left - container.clientLeft;
      const width = b.width;
      setIndicator(prev =>
        prev && Math.abs(prev.left - left) < 0.5 && Math.abs(prev.width - width) < 0.5
          ? prev
          : { left, width }
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [activeIdx, options, stretch, size, disabled]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex items-center bg-white/[0.04] border border-white/[0.08] overflow-hidden',
        size === 'sm' ? 'h-8 rounded-lg p-1' : 'h-10 rounded-xl p-1',
        disabled && 'opacity-50 pointer-events-none',
        className
      )}
    >
      {/* Sliding indicator — positioned from measured button geometry */}
      {activeIdx >= 0 && indicator && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-1 bottom-1 rounded-lg pointer-events-none',
            options[activeIdx]?.danger
              ? 'bg-vsc-red/20 border border-vsc-red/40 shadow-glow-danger'
              : 'bg-primary/20 border border-primary/30 shadow-glow-primary'
          )}
          style={{
            left: indicator.left,
            width: indicator.width,
            transition:
              'left 0.22s cubic-bezier(0.4, 0, 0.2, 1), width 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      )}

      {options.map((opt, i) => {
        const isActive = opt.value === value;
        const isDisabled = disabled || Boolean(opt.disabled);
        const btn = (
          <button
            ref={el => {
              btnRefs.current[i] = el;
            }}
            type="button"
            disabled={isDisabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative z-10 flex items-center justify-center gap-2 px-3 select-none',
              'transition-colors duration-150',
              stretch && 'flex-1',
              opt.danger
                ? cn('text-red-300 hover:text-red-200', isActive && 'text-red-200 font-semibold')
                : isActive
                  ? 'text-indigo-100 font-semibold'
                  : 'text-slate-500 hover:text-slate-300 font-medium',
              size === 'sm' ? 'h-6 text-[11px]' : 'h-8 text-xs',
              isDisabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            {opt.icon && (
              <span
                className={cn(
                  'shrink-0 w-3.5 h-3.5 flex items-center justify-center',
                  isActive ? 'text-indigo-400' : 'opacity-40'
                )}
              >
                {opt.icon}
              </span>
            )}
            <span className={cn('truncate', responsiveLabels && 'hidden sm:inline')}>{opt.label}</span>
          </button>
        );

        if (opt.tooltip) {
          return (
            <Tooltip key={opt.value} content={opt.tooltip} wrapperClassName={cn('min-w-0', stretch && 'flex-1')}>
              {btn}
            </Tooltip>
          );
        }
        return <Fragment key={opt.value}>{btn}</Fragment>;
      })}
    </div>
  );
}
