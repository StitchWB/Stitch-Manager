import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ToolbarActionsClusterProps {
  children: ReactNode;
  className?: string;
  align?: 'start' | 'end';
}

export function ToolbarActionsCluster({
  children,
  className,
  align = 'end',
}: ToolbarActionsClusterProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2',
        align === 'start' ? 'justify-start' : 'justify-end',
        className
      )}
    >
      {children}
    </div>
  );
}
