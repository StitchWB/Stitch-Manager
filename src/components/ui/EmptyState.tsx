import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-12 ${className}`}>
      <Icon className="w-12 h-12 text-white/20 mb-4" />
      <p className="text-white/40 text-sm font-medium">{title}</p>
      {description && (
        <p className="text-white/20 text-xs mt-1">{description}</p>
      )}
    </div>
  );
}
