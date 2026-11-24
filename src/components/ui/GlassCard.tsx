import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  glow?: 'purple' | 'blue' | 'none';
  gradient?: boolean;
}

export function GlassCard({
  children,
  className,
  glow = 'none',
  gradient = false,
  ...props
}: GlassCardProps) {
  return (
    <div
      className={cn(
        'bg-vsc-panel-solid/60 backdrop-blur-sm border border-white/[0.07] rounded-lg',
        glow === 'purple' && 'shadow-[0_0_20px_rgba(139,92,246,0.15)]',
        glow === 'blue' && 'shadow-[0_0_20px_rgba(59,130,246,0.15)]',
        gradient && 'bg-gradient-to-b from-white/[0.05] to-transparent',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
