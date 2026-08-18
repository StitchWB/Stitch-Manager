import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ToolbarFiltersGroupProps {
  children: ReactNode;
  className?: string;
  mobileScrollable?: boolean;
}

export function ToolbarFiltersGroup({
  children,
  className,
  mobileScrollable = false,
}: ToolbarFiltersGroupProps) {
  return (
    <div
      className={cn(
        'relative z-20 flex items-center gap-0.5',
        mobileScrollable
          ? 'flex-nowrap overflow-x-auto no-scrollbar'
          : 'flex-nowrap',
        className
      )}
    >
      {children}
    </div>
  );
}
