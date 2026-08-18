import { cn } from '../../lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  withDot?: boolean;
  withPulse?: boolean;
}

const variantClasses: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'bg-white/5 text-slate-300 border border-white/10',
  success: 'bg-emerald-500/10 text-emerald-300 border border-transparent',
  warning: 'bg-amber-500/10 text-amber-300 border border-transparent',
  danger: 'bg-red-500/10 text-red-300 border border-transparent',
  info: 'bg-sky-500/10 text-sky-300 border border-transparent',
  outline: 'bg-transparent text-slate-300 border border-white/20',
};

const sizeClasses: Record<NonNullable<BadgeProps['size']>, string> = {
  sm: 'text-xs px-2 py-0.5',
  md: 'text-xs px-2.5 py-1',
  lg: 'text-sm px-3 py-1.5',
};

const dotClasses: Record<NonNullable<BadgeProps['variant']>, string> = {
  default: 'bg-slate-400',
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  danger: 'bg-red-400',
  info: 'bg-sky-400',
  outline: 'bg-slate-400',
};

export function Badge({
  className,
  variant = 'default',
  size = 'md',
  withDot = false,
  withPulse = false,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium uppercase tracking-wide leading-none',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {withDot ? (
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full',
            dotClasses[variant],
            withPulse && 'animate-pulse'
          )}
        />
      ) : null}
      {children}
    </span>
  );
}
