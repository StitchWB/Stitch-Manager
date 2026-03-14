import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ToolbarFiltersGroupProps {
  children: ReactNode;
  className?: string;
  align?: 'center' | 'end';
  mobileScrollable?: boolean;
}

export function ToolbarFiltersGroup({
  children,
  className,
  align = 'center',
  mobileScrollable = false,
}: ToolbarFiltersGroupProps) {
  return (
    <div
      className={cn(
        'relative z-20 flex gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2 py-2',
        align === 'end' ? 'items-end' : 'items-center',
        mobileScrollable
          ? 'flex-nowrap overflow-x-auto [scrollbar-width:thin] lg:flex-wrap'
          : 'flex-wrap',
        className
      )}
    >
      {children}
    </div>
  );
}
