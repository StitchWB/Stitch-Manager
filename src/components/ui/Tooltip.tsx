import { useState, useEffect, useCallback, useRef } from 'react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

export interface TooltipProps {
  content: string | React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  wrapperClassName?: string;
  delay?: number;
  sideOffset?: number;
}

export function Tooltip({
  content,
  children,
  side = 'top',
  className,
  wrapperClassName,
  delay = 0.2,
  sideOffset = 8,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  // Use callback ref to measure after mount. The state copy only serves as
  // an effect trigger; the mutable ref holds the node for DOM adjustments.
  const tooltipNodeRef = useRef<HTMLDivElement | null>(null);
  const [tooltipEl, setTooltipEl] = useState<HTMLDivElement | null>(null);
  const tooltipRef = useCallback((node: HTMLDivElement | null) => {
    tooltipNodeRef.current = node;
    setTooltipEl(node);
  }, []);

  const handleMouseEnter = (e: React.MouseEvent | React.FocusEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();

    let x = rect.left + rect.width / 2;
    let y = rect.top;

    if (side === 'top') {
      y = rect.top - sideOffset;
    } else if (side === 'bottom') {
      y = rect.bottom + sideOffset;
    } else if (side === 'left') {
      x = rect.left - sideOffset;
      y = rect.top + rect.height / 2;
    } else if (side === 'right') {
      x = rect.right + sideOffset;
      y = rect.top + rect.height / 2;
    }

    setPosition({ x, y });
    setIsVisible(true);
  };

  // Adjust position after tooltip is rendered to account for its size.
  // Writes straight to the DOM node instead of setState-in-effect to avoid
  // cascading renders (react-hooks/set-state-in-effect).
  useEffect(() => {
    const node = tooltipNodeRef.current;
    if (isVisible && node) {
      const tooltipRect = node.getBoundingClientRect();
      let newX = position.x;
      let newY = position.y;
      if (side === 'top') newY = position.y - tooltipRect.height;
      else if (side === 'left') newX = position.x - tooltipRect.width;
      node.style.left = `${newX}px`;
      node.style.top = `${newY}px`;
    }
  }, [isVisible, tooltipEl, side, position.x, position.y]);

  const getTransform = () => {
    if (side === 'top' || side === 'bottom') return 'translateX(-50%)';
    if (side === 'left' || side === 'right') return 'translateY(-50%)';
    return 'none';
  };

  return (
    <>
      <div
        className={cn('relative inline-flex items-center justify-center', wrapperClassName)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setIsVisible(false)}
        onFocus={handleMouseEnter}
        onBlur={() => setIsVisible(false)}
      >
        {children}
      </div>
      {createPortal(
        // No AnimatePresence: it wraps children in PopChild which reads
        // children.props.ref on React 18.3 and logs a "ref is not a prop"
        // warning (framer-motion v12 / React 18.3 incompat). motion.div alone
        // still animates initial→animate on mount; exit is instant, which is
        // fine for a tooltip.
        isVisible && (
          <motion.div
            ref={tooltipRef}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.15, delay }}
            className={cn(
              'fixed z-[99999] px-2.5 py-1.5 text-xs font-medium text-slate-200 bg-vsc-sidebar border border-vsc-border-light rounded-md shadow-xl backdrop-blur-xl whitespace-nowrap pointer-events-none',
              className
            )}
            style={{
              left: `${position.x}px`,
              top: `${position.y}px`,
              transform: getTransform(),
            }}
          >
            {content}
            <div
              className={cn(
                'absolute w-2 h-2 bg-vsc-sidebar border-vsc-border-light rotate-45',
                side === 'top' && 'bottom-[-5px] left-1/2 -translate-x-1/2 border-b border-r',
                side === 'bottom' && 'top-[-5px] left-1/2 -translate-x-1/2 border-t border-l',
                side === 'left' && 'right-[-5px] top-1/2 -translate-y-1/2 border-t border-r',
                side === 'right' && 'left-[-5px] top-1/2 -translate-y-1/2 border-b border-l'
              )}
            />
          </motion.div>
        ),
        document.body
      )}
    </>
  );
}

