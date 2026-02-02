import { cn } from '../../lib/utils';

type BadgeVariant = 'success' | 'error' | 'warning' | 'info' | 'default' | 'neutral';
type StatusType = 'active' | 'inactive' | 'error' | 'warning' | 'success' | 'pending';

interface StatusBadgePropsOld {
  variant: BadgeVariant;
  children: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md';
  minimal?: boolean; // New prop for minimalist "active" status
}

interface StatusBadgePropsNew {
  status: StatusType;
  withDot?: boolean;
  withPulse?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

type StatusBadgeProps = StatusBadgePropsOld | StatusBadgePropsNew;

// Deep Space Void - Pill style badges
const variantStyles: Record<BadgeVariant, string> = {
  success: 'bg-green-500/10 text-green-400',
  error: 'bg-red-500/10 text-red-400',
  warning: 'bg-amber-500/10 text-amber-400',
  info: 'bg-blue-500/10 text-blue-400',
  default: 'bg-white/5 text-white/60',
  neutral: 'bg-slate-500/10 text-slate-400',
};

// Minimalist styles for "active" status (just dot + text, no background)
const minimalStyles: Record<BadgeVariant, string> = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  warning: 'text-amber-400',
  info: 'text-blue-400',
  default: 'text-slate-400',
  neutral: 'text-slate-400',
};

const sizeStyles: Record<'sm' | 'md', string> = {
  sm: 'text-[10px] px-2 py-0.5',
  md: 'text-xs px-2.5 py-1',
};

// New status-based styles
const statusStyles: Record<StatusType, string> = {
  active: 'bg-emerald-500/10 text-emerald-400',
  success: 'bg-emerald-500/10 text-emerald-400',
  error: 'bg-red-500/10 text-red-400',
  warning: 'bg-amber-500/10 text-amber-400',
  inactive: 'bg-slate-500/10 text-slate-400',
  pending: 'bg-blue-500/10 text-blue-400',
};

const dotColors: Record<StatusType, string> = {
  active: 'bg-emerald-400',
  success: 'bg-emerald-400',
  error: 'bg-red-400',
  warning: 'bg-amber-400',
  inactive: 'bg-slate-500',
  pending: 'bg-blue-400',
};

const newSizeStyles: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'text-[10px] px-2 py-0.5',
  md: 'text-xs px-2.5 py-1',
  lg: 'text-sm px-3 py-1.5',
};

const dotSizes: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'w-1 h-1',
  md: 'w-1.5 h-1.5',
  lg: 'w-2 h-2',
};

function isNewProps(props: StatusBadgeProps): props is StatusBadgePropsNew {
  return 'status' in props;
}

export function StatusBadge(props: StatusBadgeProps) {
  // New API with status prop
  if (isNewProps(props)) {
    const { status, withDot = false, withPulse = false, size = 'md', className } = props;
    
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 font-bold uppercase tracking-wide rounded-full',
          statusStyles[status],
          newSizeStyles[size],
          className
        )}
      >
        {withDot && (
          <span 
            className={cn(
              'rounded-full',
              dotColors[status],
              dotSizes[size],
              withPulse && 'animate-pulse'
            )}
          />
        )}
        <span className="capitalize">{status}</span>
      </span>
    );
  }

  // Old API with variant prop (backward compatible)
  const { variant, children, className, size = 'sm', minimal = false } = props;

  // Minimalist style for "active" status
  if (minimal && variant === 'success') {
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs', minimalStyles[variant], className)}>
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        {children}
      </span>
    );
  }

  // Heavy badge for errors/warnings (to draw attention)
  return (
    <span
      className={cn(
        'inline-flex items-center font-bold uppercase tracking-wide rounded-full',
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
    >
      {children}
    </span>
  );
}
