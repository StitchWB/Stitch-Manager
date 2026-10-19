import { cn } from '../../lib/utils';

interface SkeletonLoaderProps {
  variant?: 'text' | 'card' | 'table-row' | 'circle' | 'rectangle';
  width?: string;
  height?: string;
  count?: number;
  className?: string;
}

const variantClasses = {
  text: 'h-4 rounded',
  card: 'h-32 rounded-lg',
  'table-row': 'h-14 rounded-lg',
  circle: 'rounded-full',
  rectangle: 'rounded-lg',
};

export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  variant = 'rectangle',
  width,
  height,
  count = 1,
  className = '',
}) => {
  const skeletons = Array.from({ length: count }, (_, i) => (
    <div
      key={i}
      className={cn(
        'bg-white/[0.02] animate-pulse',
        variantClasses[variant],
        className
      )}
      style={{
        width: width || (variant === 'circle' ? height : undefined),
        height: height,
      }}
    />
  ));

  return count > 1 ? <div className="space-y-3">{skeletons}</div> : skeletons[0];
};

export type { SkeletonLoaderProps };
