import { cn } from '@/lib/utils';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  glow?: 'purple' | 'blue' | 'none';
  gradient?: boolean;
}

export function GlassCard({ children, className, glow = 'none', gradient = false }: GlassCardProps) {
  return (
    <div className={cn(
      'bg-black/40 backdrop-blur-sm border border-white/[0.06] rounded-lg',
      glow === 'purple' && 'shadow-[0_0_20px_rgba(139,92,246,0.15)]',
      glow === 'blue' && 'shadow-[0_0_20px_rgba(59,130,246,0.15)]',
      gradient && 'bg-gradient-to-b from-white/[0.05] to-transparent',
      className
    )}>
      {children}
    </div>
  );
}
