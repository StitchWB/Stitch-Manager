import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  children: React.ReactNode;
  text: string;
}

/**
 * Smart tooltip component that appears near the trigger element and follows cursor
 */
export function Tooltip({ children, text }: TooltipProps) {
  const [show, setShow] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const updatePosition = (clientX: number, clientY: number) => {
    const offset = 8; // Small offset from cursor
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Get tooltip dimensions (use estimated size if not yet rendered)
    const tooltipWidth = tooltipRef.current?.offsetWidth || 250;
    const tooltipHeight = tooltipRef.current?.offsetHeight || 60;
    
    // Default position: bottom-right of cursor
    let x = clientX + offset;
    let y = clientY + offset;
    
    // If tooltip goes off right edge, show it to the left of cursor
    if (x + tooltipWidth > viewportWidth - 10) {
      x = clientX - tooltipWidth - offset;
    }
    
    // If tooltip goes off bottom edge, show it above cursor
    if (y + tooltipHeight > viewportHeight - 10) {
      y = clientY - tooltipHeight - offset;
    }
    
    // Ensure tooltip doesn't go off left or top edges
    x = Math.max(10, x);
    y = Math.max(10, y);
    
    setCoords({ x, y });
  };

  useEffect(() => {
    if (!show) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      // Only update if mouse is over the trigger element
      if (triggerRef.current?.contains(e.target as Node)) {
        updatePosition(e.clientX, e.clientY);
      }
    };

    // Add global mouse move listener to track cursor even on small elements
    document.addEventListener('mousemove', handleGlobalMouseMove);
    
    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
    };
  }, [show]);

  const handleMouseEnter = (e: React.MouseEvent) => {
    updatePosition(e.clientX, e.clientY);
    setShow(true);
  };

  return (
    <>
      <div 
        ref={triggerRef} 
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setShow(false)}
        className="inline-flex"
      >
        {children}
      </div>
      {show && createPortal(
        <div
          ref={tooltipRef}
          className="fixed px-3 py-2 text-xs text-white bg-slate-900/95 backdrop-blur-sm rounded-md shadow-2xl pointer-events-none border border-indigo-500/30 max-w-xs leading-relaxed"
          style={{
            left: `${coords.x}px`,
            top: `${coords.y}px`,
            zIndex: 2147483647,
          }}
        >
          {text}
        </div>,
        document.body
      )}
    </>
  );
}
