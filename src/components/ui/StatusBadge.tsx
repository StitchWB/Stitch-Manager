import { cn } from '../../lib/utils';

type BadgeVariant = 'success' | 'error' | 'warning' | 'info' | 'default' | 'neutral';

interface StatusBadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md';
  minimal?: boolean; // New prop for minimalist "active" status
}

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

export function StatusBadge({ 
  variant, 
  children, 
  className,
  size = 'sm',
  minimal = false,
}: StatusBadgeProps) {
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
