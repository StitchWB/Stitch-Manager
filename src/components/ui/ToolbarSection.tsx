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
    <div className={cn('flex flex-wrap justify-between gap-4', className)}>
      <div className={cn('flex-[1_1_500px] min-w-[300px]', leftClassName)}>{left}</div>
      {right ? <div className={cn('flex-[0_1_auto] min-w-0', rightClassName)}>{right}</div> : null}
    </div>
  );
}
