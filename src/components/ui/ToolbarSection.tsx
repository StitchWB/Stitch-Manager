import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface ToolbarSectionProps {
  left: ReactNode;
  right?: ReactNode;
  className?: string;
  leftClassName?: string;
  rightClassName?: string;
  layout?: 'stack' | 'split';
}

export function ToolbarSection({
  left,
  right,
  className,
  leftClassName,
  rightClassName,
  layout = 'split',
}: ToolbarSectionProps) {
  if (layout === 'stack') {
    return (
      <div className={cn('flex min-w-0 flex-col gap-4', className)}>
        <div className={cn('min-w-0', leftClassName)}>{left}</div>
        {right ? <div className={cn('min-w-0', rightClassName)}>{right}</div> : null}
      </div>
    );
  }

  return (
    <div className={cn('grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_auto]', className)}>
      <div className={cn('min-w-0', leftClassName)}>{left}</div>
      {right ? <div className={cn('min-w-0', rightClassName)}>{right}</div> : null}
    </div>
  );
}
