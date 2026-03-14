import { Tooltip as UITooltip, type TooltipProps as UITooltipProps } from '@/components/ui';

export interface TooltipProps {
  children: React.ReactNode;
  content: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  delayDuration?: number;
}

/**
 * Legacy tooltip wrapper (compat layer).
 * Prefer importing from src/components/ui/Tooltip.
 */
export function Tooltip({
  children,
  content,
  side = 'top',
  sideOffset = 8,
  delayDuration = 200,
}: TooltipProps) {
  const props: UITooltipProps = {
    children,
    content,
    side,
    sideOffset,
    delay: delayDuration / 1000,
  };

  return <UITooltip {...props} />;
}
