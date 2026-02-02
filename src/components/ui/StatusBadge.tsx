import { cn } from '../../lib/utils';
import { STATUS_COLORS } from '../../constants/colors';

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

// Deep Space Void - Pill style badges (using centralized colors)
const variantStyles: Record<BadgeVariant, string> = {
  success: `${STATUS_COLORS.success.bgOpacity} ${STATUS_COLORS.success.text}`,
  error: `${STATUS_COLORS.error.bgOpacity} ${STATUS_COLORS.error.text}`,
  warning: `${STATUS_COLORS.warning.bgOpacity} ${STATUS_COLORS.warning.text}`,
  info: `${STATUS_COLORS.info.bgOpacity} ${STATUS_COLORS.info.text}`,
  default: 'bg-white/5 text-white/60',
  neutral: `${STATUS_COLORS.inactive.bgOpacity} ${STATUS_COLORS.inactive.text}`,
};

// Minimalist styles for "active" status (just dot + text, no background)
const minimalStyles: Record<BadgeVariant, string> = {
  success: STATUS_COLORS.success.text,
  error: STATUS_COLORS.error.text,
  warning: STATUS_COLORS.warning.text,
  info: STATUS_COLORS.info.text,
  default: STATUS_COLORS.inactive.text,
  neutral: STATUS_COLORS.inactive.text,
};

const sizeStyles: Record<'sm' | 'md', string> = {
  sm: 'text-[10px] px-2 py-0.5',
  md: 'text-xs px-2.5 py-1',
};

// New status-based styles (using centralized colors)
const statusStyles: Record<StatusType, string> = {
  active: `${STATUS_COLORS.success.bgOpacity} ${STATUS_COLORS.success.text}`,
  success: `${STATUS_COLORS.success.bgOpacity} ${STATUS_COLORS.success.text}`,
  error: `${STATUS_COLORS.error.bgOpacity} ${STATUS_COLORS.error.text}`,
  warning: `${STATUS_COLORS.warning.bgOpacity} ${STATUS_COLORS.warning.text}`,
  inactive: `${STATUS_COLORS.inactive.bgOpacity} ${STATUS_COLORS.inactive.text}`,
  pending: `${STATUS_COLORS.info.bgOpacity} ${STATUS_COLORS.info.text}`,
};

const dotColors: Record<StatusType, string> = {
  active: STATUS_COLORS.success.text.replace('text-', 'bg-'),
  success: STATUS_COLORS.success.text.replace('text-', 'bg-'),
  error: STATUS_COLORS.error.text.replace('text-', 'bg-'),
  warning: STATUS_COLORS.warning.text.replace('text-', 'bg-'),
  inactive: STATUS_COLORS.inactive.bg,
  pending: STATUS_COLORS.info.text.replace('text-', 'bg-'),
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
        <span className={cn('w-1.5 h-1.5 rounded-full', STATUS_COLORS.success.bg)} />
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
