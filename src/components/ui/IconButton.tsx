import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'danger' | 'success' | 'ghost';
  size?: 'sm' | 'md';
  tooltip?: string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant = 'default', size = 'md', children, disabled, ...props }, ref) => {
    const variants = {
      default:
        'text-slate-500 hover:text-white hover:bg-white/10 disabled:hover:bg-transparent',
      danger:
        'text-slate-500 hover:text-red-400 hover:bg-red-500/10 disabled:hover:bg-transparent',
      success:
        'text-slate-500 hover:text-green-400 hover:bg-green-500/10 disabled:hover:bg-transparent',
      ghost: 'text-slate-400 hover:text-white hover:bg-white/5 disabled:hover:bg-transparent',
    };

    const sizes = {
      sm: 'w-5 h-5 p-0.5',
      md: 'w-8 h-8 p-2',
    };

    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          'inline-flex items-center justify-center rounded transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed shrink-0',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

IconButton.displayName = 'IconButton';
