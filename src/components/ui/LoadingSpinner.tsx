import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

interface LoadingSpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  color?: 'primary' | 'white' | 'muted' | 'inherit';
}

const sizeClasses = {
  xs: 'w-3 h-3',
  sm: 'w-4 h-4',
  md: 'w-6 h-6',
  lg: 'w-8 h-8',
  xl: 'w-12 h-12',
};

const colorClasses = {
  primary: 'text-indigo-400',
  white: 'text-white',
  muted: 'text-slate-400',
  inherit: '', // No color class, inherits from parent
};

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  className = '',
  color = 'primary',
}) => {
  return (
    <Loader2
      className={cn('animate-spin', sizeClasses[size], colorClasses[color], className)}
    />
  );
};

export type { LoadingSpinnerProps };
