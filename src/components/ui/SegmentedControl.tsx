import { Fragment } from 'react';
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
 * Segmented control with a pure-CSS sliding indicator.
 *
 * We intentionally avoid framer-motion `layoutId` here because it triggers
 * a layout pass on all ancestors (the whole left panel "jumps") whenever
 * two SegmentedControl instances share a layout root.
 * Instead we position the indicator with `left: calc(idx / n * 100%)`
 * and animate it with a CSS transition — zero reflow outside this element.
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
  const count = options.length;

  return (
    <div
      className={cn(
        'relative flex items-center bg-white/[0.04] border border-white/[0.08] overflow-hidden',
        size === 'sm' ? 'h-8 rounded-lg p-1' : 'h-10 rounded-xl p-1',
        disabled && 'opacity-50 pointer-events-none',
        className
      )}
    >
      {/* Sliding indicator — pure CSS, no layout side-effects */}
      {activeIdx >= 0 && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-1 bottom-1 rounded-lg pointer-events-none',
            options[activeIdx]?.danger
              ? 'bg-vsc-red/20 border border-vsc-red/40 shadow-glow-danger'
              : 'bg-primary/20 border border-primary/30 shadow-glow-primary'
          )}
          style={{
            // Container has p-1 (0.25rem per side): inner width = 100% - 0.5rem.
            // Each segment = inner/n; indicator left = padding + idx * segment.
            width: `calc(${100 / count}% - ${0.5 / count}rem)`,
            left: `calc(${activeIdx / count * 100}% + ${0.25 - activeIdx * 0.5 / count}rem)`,
            transition: 'left 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      )}

      {options.map(opt => {
        const isActive = opt.value === value;
        const isDisabled = disabled || Boolean(opt.disabled);
        const btn = (
          <button
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
