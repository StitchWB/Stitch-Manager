import { LoadingSpinner } from './LoadingSpinner';
import { cn } from '../../lib/utils';

interface LoadingOverlayProps {
  message?: string;
  className?: string;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  message,
  className = '',
}) => {
  return (
    <div
      className={cn(
        'absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50',
        className
      )}
    >
      <div className="flex flex-col items-center gap-3">
        <LoadingSpinner size="lg" color="white" />
        {message && <span className="text-sm text-white font-medium">{message}</span>}
      </div>
    </div>
  );
};

export type { LoadingOverlayProps };
