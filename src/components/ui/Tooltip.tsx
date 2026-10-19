import { useState, useEffect, useCallback, useRef } from 'react';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  content: string | React.ReactNode;
  children: React.ReactNode;
  side?: TooltipSide;
  className?: string;
  wrapperClassName?: string;
  delay?: number;
  sideOffset?: number;
}

const VIEWPORT_MARGIN = 8;
const ARROW_INSET = 8;

export interface TooltipPlacement {
  left: number;
  top: number;
  arrowShift: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Coordinates are in the style-prop system: on the centered axis
 * (translateX/Y(-50%)) the value is the tooltip center, on the other axis it is
 * the leading edge. arrowShift offsets the arrow along the tooltip edge so it
 * keeps pointing at the anchor after the box is clamped to the viewport.
 */
export function placeTooltip(
  side: TooltipSide,
  anchorX: number,
  anchorY: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
): TooltipPlacement {
  if (side === 'top' || side === 'bottom') {
    const desiredLeft = anchorX - width / 2;
    const left = clamp(desiredLeft, VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN);
    const top = clamp(
      side === 'top' ? anchorY - height : anchorY,
      VIEWPORT_MARGIN,
      viewportHeight - height - VIEWPORT_MARGIN,
    );
    return {
      left: left + width / 2,
      top,
      arrowShift: clamp(desiredLeft - left, ARROW_INSET - width / 2, width / 2 - ARROW_INSET),
    };
  }
  const desiredTop = anchorY - height / 2;
  const top = clamp(desiredTop, VIEWPORT_MARGIN, viewportHeight - height - VIEWPORT_MARGIN);
  const left = clamp(
    side === 'left' ? anchorX - width : anchorX,
    VIEWPORT_MARGIN,
    viewportWidth - width - VIEWPORT_MARGIN,
  );
  return {
    left,
    top: top + height / 2,
    arrowShift: clamp(desiredTop - top, ARROW_INSET - height / 2, height / 2 - ARROW_INSET),
  };
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
      const arrow = node.lastElementChild as HTMLElement | null;
      const { left, top, arrowShift } = placeTooltip(
        side,
        position.x,
        position.y,
        node.offsetWidth,
        node.offsetHeight,
        document.documentElement.clientWidth,
        document.documentElement.clientHeight,
      );
      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
      if (arrow) {
        if (side === 'top' || side === 'bottom') arrow.style.marginLeft = `${arrowShift}px`;
        else arrow.style.marginTop = `${arrowShift}px`;
      }
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

