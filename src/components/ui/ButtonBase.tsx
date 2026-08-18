import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

export type ButtonBaseProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * Low-level UI-kit primitive for button semantics without visual skin.
 * Use when complex layouts require full custom classes but raw <button> is disallowed.
 */
export const ButtonBase = forwardRef<HTMLButtonElement, ButtonBaseProps>(
  ({ className, ...props }, ref) => {
    return <button ref={ref} className={cn(className)} {...props} />;
  }
);

ButtonBase.displayName = 'ButtonBase';
