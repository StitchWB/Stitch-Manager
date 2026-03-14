import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface StickyToolbarProps {
  children: ReactNode;
  className?: string;
  topClassName?: string;
}

export function StickyToolbar({ children, className, topClassName }: StickyToolbarProps) {
  return (
    <div className={cn('sticky z-20', topClassName ?? 'top-2')}>
      <div
        className={cn(
          'rounded-xl border border-white/10 bg-black/60 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.25)] backdrop-blur-md',
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
