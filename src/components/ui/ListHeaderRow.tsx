import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ListHeaderRowProps {
  children: ReactNode;
  className?: string;
  stickyTopClassName?: string;
}

export function ListHeaderRow({
  children,
  className,
  stickyTopClassName = 'top-0',
}: ListHeaderRowProps) {
  return (
    <div
      className={cn(
        'sticky z-10 border-b border-white/10 bg-black/70 px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400 backdrop-blur',
        stickyTopClassName,
        className
      )}
    >
      {children}
    </div>
  );
}
