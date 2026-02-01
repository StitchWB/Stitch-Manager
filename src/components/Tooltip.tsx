import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../lib/utils';

interface TooltipProps {
  children: React.ReactNode;
  content: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  delayDuration?: number;
}

/**
 * Tooltip component using Radix UI for proper positioning and portal rendering
 */
export function Tooltip({ 
  children, 
  content, 
  side = 'top', 
  sideOffset = 8,
  delayDuration = 200 
}: TooltipProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={sideOffset}
            className={cn(
              'z-[9999] px-3 py-2 text-xs text-white bg-slate-900/95 backdrop-blur-sm',
              'rounded-md shadow-2xl border border-indigo-500/30 max-w-xs leading-relaxed',
              'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out',
              'data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
              'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
              'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2'
            )}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-slate-900/95" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}
