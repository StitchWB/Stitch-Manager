import { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { LoadingSpinner } from './LoadingSpinner';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'purple';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'icon';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      isLoading,
      leftIcon,
      rightIcon,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const variants = {
      primary:
        'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/40 hover:from-indigo-400 hover:to-purple-500 active:scale-95 disabled:hover:shadow-none disabled:active:scale-100',
      purple:
        'bg-gradient-to-br from-purple-600 to-violet-700 text-white shadow-lg shadow-purple-500/20 hover:shadow-purple-500/40 hover:from-purple-500 hover:to-violet-600 active:scale-95',
      secondary:
        'bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white active:scale-95',
      ghost: 'text-slate-400 hover:text-white hover:bg-white/5 disabled:hover:bg-transparent',
      danger:
        'bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 hover:text-red-300 active:scale-95',
      outline:
        'border border-white/20 text-slate-300 hover:border-white/40 hover:text-white active:scale-95',
    };

    const sizes = {
      xs: 'px-2 py-1 text-[10px] h-6',
      sm: 'px-3 py-1.5 text-xs h-8',
      md: 'px-4 py-2 text-sm h-10',
      lg: 'px-6 py-3 text-base h-12',
      icon: 'p-2 w-8 h-8',
    };

    return (
      <button
        ref={ref}
        disabled={isLoading || disabled}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed select-none',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {isLoading ? (
          <LoadingSpinner size="sm" color="inherit" />
        ) : (
          leftIcon && <span className="shrink-0">{leftIcon}</span>
        )}
        <span className="truncate">{children}</span>
        {!isLoading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
      </button>
    );
  }
);

Button.displayName = 'Button';
