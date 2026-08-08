import { ReactNode } from 'react';

export interface SectionHeaderProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SectionHeader({
  title,
  description,
  icon,
  children,
  className = '',
}: SectionHeaderProps) {
  return (
    <div className={`space-y-4 ${className}`}>
      <div>
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          {icon}
          {title}
        </h3>
        {description && <p className="text-slate-400 text-xs">{description}</p>}
      </div>
      {children}
    </div>
  );
}
