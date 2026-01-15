import { cn } from '../../lib/utils';

type BadgeVariant = 'success' | 'error' | 'warning' | 'info' | 'default' | 'neutral';

interface StatusBadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md';
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

const sizeStyles: Record<'sm' | 'md', string> = {
  sm: 'text-[10px] px-2 py-0.5',
  md: 'text-xs px-2.5 py-1',
};

export function StatusBadge({ 
  variant, 
  children, 
  className,
  size = 'sm' 
}: StatusBadgeProps) {
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
