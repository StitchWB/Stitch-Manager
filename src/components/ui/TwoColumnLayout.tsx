import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TwoColumnLayoutProps {
  /** Main content (left). Grows to fill remaining space. */
  main: ReactNode;
  /** Side content (right). Fixed width on desktop, stacked underneath on small screens. */
  side: ReactNode;
  /** Width of the side column on desktop. Tailwind arbitrary value, default w-[320px]. */
  sideWidth?: string;
  /** Reverse order: side becomes left, main becomes right. */
  reverse?: boolean;
  /** Gap between columns / stacks. */
  gap?: 'sm' | 'md' | 'lg';
  /** Breakpoint at which the layout flips from stacked to side-by-side. */
  breakpoint?: 'md' | 'lg' | 'xl';
  className?: string;
}

const gapClass = {
  sm: 'gap-3',
  md: 'gap-4',
  lg: 'gap-6',
} as const;

const flexBpClass = {
  md: 'md:flex-row',
  lg: 'lg:flex-row',
  xl: 'xl:flex-row',
} as const;

/**
 * Two-column layout that stacks vertically on small screens and switches to
 * side-by-side at the given breakpoint. Side column has a fixed width;
 * main column grows.
 */
export function TwoColumnLayout({
  main,
  side,
  sideWidth = 'w-full md:w-[320px]',
  reverse = false,
  gap = 'md',
  breakpoint = 'lg',
  className,
}: TwoColumnLayoutProps) {
  return (
    <div className={cn('flex flex-col', flexBpClass[breakpoint], gapClass[gap], className)}>
      <div className={cn('flex-1 min-w-0', reverse && 'order-2')}>{main}</div>
      <aside className={cn(sideWidth, 'shrink-0', reverse && 'order-1')}>{side}</aside>
    </div>
  );
}
