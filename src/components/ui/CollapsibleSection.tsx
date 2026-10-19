import { useState, useCallback } from 'react';
import { ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { GlassCard } from './GlassCard';

export interface CollapsibleSectionProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  disabled?: boolean;
  className?: string;
  cardClassName?: string;
  headerClassName?: string;
  contentClassName?: string;
  onToggle?: (expanded: boolean) => void;
}

export function CollapsibleSection({
  title,
  description,
  icon,
  children,
  defaultExpanded = true,
  disabled = false,
  className,
  cardClassName,
  headerClassName,
  contentClassName,
  onToggle,
}: CollapsibleSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const handleToggle = useCallback(() => {
    if (disabled) return;
    const newState = !isExpanded;
    setIsExpanded(newState);
    onToggle?.(newState);
  }, [isExpanded, disabled, onToggle]);

  return (
    <GlassCard className={cn('overflow-hidden', cardClassName)}>
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={cn(
          'w-full flex items-center justify-between p-4 transition-colors',
          !disabled && 'hover:bg-white/[0.02]',
          disabled && 'cursor-not-allowed opacity-40',
          headerClassName
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          {icon && (
            <div className="w-8 h-8 rounded-lg bg-white/[0.05] flex items-center justify-center shrink-0">
              {icon}
            </div>
          )}
          <div className="flex-1 min-w-0 text-left">
            <div className="text-sm font-semibold text-white truncate">{title}</div>
            {description && <div className="text-xs text-slate-400 truncate">{description}</div>}
          </div>
        </div>
        <div
          className={cn(
            'w-7 h-7 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center shrink-0 transition-transform duration-300 ease-in-out',
            isExpanded && 'rotate-180'
          )}
        >
          <ChevronDown className="w-5 h-5 text-slate-300" />
        </div>
      </button>
      <div
        className={cn(
          'overflow-hidden transition-all duration-300 ease-in-out',
          isExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0',
          contentClassName
        )}
      >
        <div className={cn('p-4 pt-0', className)}>{children}</div>
      </div>
    </GlassCard>
  );
}

export interface CollapsibleGroupProps {
  children: React.ReactNode;
  className?: string;
  gap?: 'none' | 'xs' | 'sm' | 'md';
}

export function CollapsibleGroup({ children, className, gap = 'md' }: CollapsibleGroupProps) {
  const gapClasses = {
    none: '',
    xs: 'space-y-1',
    sm: 'space-y-2',
    md: 'space-y-3',
  };

  return <div className={cn(gapClasses[gap], className)}>{children}</div>;
}

export interface ExpandAllToggleProps {
  allExpanded: boolean;
  onToggle: () => void;
  className?: string;
}

export function ExpandAllToggle({ allExpanded, onToggle, className }: ExpandAllToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'text-xs font-medium text-slate-400 hover:text-slate-200 transition-all duration-200',
        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.05] border border-white/[0.08] hover:border-white/[0.15]',
        className
      )}
    >
      <ChevronsUpDown className="w-4 h-4" />
      <span>{allExpanded ? 'Свернуть всё' : 'Развернуть всё'}</span>
    </button>
  );
}
