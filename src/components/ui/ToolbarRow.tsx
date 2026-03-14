import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ToolbarRowProps {
  children: ReactNode;
  className?: string;
}

export function ToolbarRow({ children, className }: ToolbarRowProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2 min-w-0', className)}>{children}</div>
  );
}
