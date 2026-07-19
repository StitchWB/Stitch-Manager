import { cn } from '../../lib/utils';

export interface SegmentedOption {
  label: string;
  value: string;
  icon?: React.ReactNode;
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
        'relative flex items-center bg-black/40 border border-white/10 overflow-hidden',
        size === 'sm' ? 'h-8 rounded-lg p-1' : 'h-10 rounded-xl p-1',
        disabled && 'opacity-50 pointer-events-none',
        className
      )}
    >
      {/* Sliding indicator — pure CSS, no layout side-effects */}
      {activeIdx >= 0 && (
        <span
          aria-hidden="true"
          className="absolute top-1 bottom-1 rounded-lg bg-white/10 border border-white/10 shadow-[0_0_10px_rgba(255,255,255,0.05)] pointer-events-none"
          style={{
            width: `calc(${100 / count}% - ${(count - 1) / count}rem)`,
            left: `calc(${activeIdx / count * 100}% + ${activeIdx / count}rem)`,
            transition: 'left 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      )}

      {options.map(opt => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative z-10 flex items-center justify-center gap-2 px-3 text-xs font-medium select-none',
              'transition-colors duration-150',
              stretch && 'flex-1',
              isActive ? 'text-white' : 'text-slate-500 hover:text-slate-300',
              size === 'sm' ? 'h-6' : 'h-8'
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
            <span className={cn(responsiveLabels && 'hidden sm:inline')}>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
