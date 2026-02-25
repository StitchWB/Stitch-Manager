import { motion } from 'framer-motion';
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
}

export function SegmentedControl({
  options,
  value,
  onChange,
  className,
  size = 'md',
  stretch = true,
}: SegmentedControlProps) {
  return (
    <div
      className={cn(
        'flex p-1 bg-black/40 rounded-xl border border-white/10 overflow-hidden relative',
        size === 'sm' ? 'rounded-lg' : 'rounded-xl',
        className
      )}
    >
      {options.map(opt => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium transition-colors duration-300 z-10 select-none',
              stretch && 'flex-1',
              isActive ? 'text-white' : 'text-slate-500 hover:text-slate-300',
              size === 'sm' ? 'py-1 text-[10px]' : 'py-1.5'
            )}
          >
            {isActive && (
              <motion.div
                layoutId={`segmented-active-${options[0].value}`}
                className="absolute inset-0 bg-white/10 rounded-lg shadow-[0_0_10px_rgba(255,255,255,0.05)] border border-white/10"
                transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
              />
            )}
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
            <span className="relative">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
