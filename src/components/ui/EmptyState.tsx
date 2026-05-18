import type { ReactNode } from 'react';
import { LucideIcon } from 'lucide-react';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
  /** Compact layout for inline / nested use */
  compact?: boolean;
  /** Optional CTA / action area rendered below the description */
  action?: ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  className = '',
  compact = false,
  action,
}: EmptyStateProps) {
  if (compact) {
    return (
      <div
        className={`flex flex-col items-center justify-center py-6 px-4 text-center ${className}`}
      >
        <Icon className="w-8 h-8 text-white/25 mb-2" />
        <p className="text-white/50 text-sm font-medium">{title}</p>
        {description && (
          <p className="text-white/25 text-xs mt-0.5">{description}</p>
        )}
        {action && <div className="mt-3">{action}</div>}
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-center py-12 ${className}`}>
      <Icon className="w-12 h-12 text-white/20 mb-4" />
      <p className="text-white/40 text-sm font-medium">{title}</p>
      {description && (
        <p className="text-white/20 text-xs mt-1">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
