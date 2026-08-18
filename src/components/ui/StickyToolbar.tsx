import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface StickyToolbarProps {
  children: ReactNode;
  className?: string;
  topClassName?: string;
}

export function StickyToolbar({ children, className, topClassName }: StickyToolbarProps) {
  return (
    <div className={cn('sticky z-20', topClassName ?? 'top-0')}>
      <div
        className={cn(
          'border-b border-white/[0.06] bg-[#0a0a0f] px-4 py-3',
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
