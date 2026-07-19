import { useState, useEffect, useCallback } from 'react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils';

export interface TooltipProps {
  content: string | React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  delay?: number;
  sideOffset?: number;
}

export function Tooltip({
  content,
  children,
  side = 'top',
  className,
  delay = 0.2,
  sideOffset = 8,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  // Use callback ref to measure after mount without storing in useRef that
  // causes the framer-motion PopChild "ref is not a prop" warning.
  const [tooltipEl, setTooltipEl] = useState<HTMLDivElement | null>(null);
  const tooltipRef = useCallback((node: HTMLDivElement | null) => {
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

  // Adjust position after tooltip is rendered to account for its size
  useEffect(() => {
    if (isVisible && tooltipEl) {
      const tooltipRect = tooltipEl.getBoundingClientRect();
      setPosition(prev => {
        let newX = prev.x;
        let newY = prev.y;
        if (side === 'top') newY = prev.y - tooltipRect.height;
        else if (side === 'left') newX = prev.x - tooltipRect.width;
        return { x: newX, y: newY };
      });
    }
  }, [isVisible, tooltipEl, side]);

  const getTransform = () => {
    if (side === 'top' || side === 'bottom') return 'translateX(-50%)';
    if (side === 'left' || side === 'right') return 'translateY(-50%)';
    return 'none';
  };

  return (
    <>
      <div
        className="relative inline-flex items-center justify-center"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setIsVisible(false)}
        onFocus={handleMouseEnter}
        onBlur={() => setIsVisible(false)}
      >
        {children}
      </div>
      {createPortal(
        // AnimatePresence must wrap the conditional so exit animations work
        <AnimatePresence>
          {isVisible && (
            <motion.div
              ref={tooltipRef}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
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
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}

