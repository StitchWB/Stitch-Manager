import { cn } from '@/lib/utils';

export interface FormGridProps {
  children: React.ReactNode;
  columns?: 1 | 2 | 3 | 4 | 'auto';
  gap?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  responsive?: boolean;
}

const columnMap: Record<Exclude<FormGridProps['columns'], undefined>, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  auto: 'grid-cols-[auto_1fr]',
};

const gapMap: Record<Exclude<FormGridProps['gap'], undefined>, string> = {
  xs: 'gap-1',
  sm: 'gap-2',
  md: 'gap-3',
  lg: 'gap-4',
};

export function FormGrid({
  children,
  columns = 2,
  gap = 'sm',
  className,
  responsive = false,
}: FormGridProps) {
  const baseColumn = columnMap[columns];
  const gapClass = gapMap[gap];

  const columnClass = responsive
    ? `grid-cols-1 md:${baseColumn}`
    : baseColumn;

  return <div className={cn('grid', columnClass, gapClass, className)}>{children}</div>;
}
