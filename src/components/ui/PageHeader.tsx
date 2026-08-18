import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  /** Optional small icon to the left of the title */
  icon?: ReactNode;
  /** Tiny eyebrow text above the title (e.g. "AI Hub") */
  eyebrow?: ReactNode;
  /** Page title, single line */
  title: ReactNode;
  /** Optional one-line description */
  description?: ReactNode;
  /** Action cluster on the right side (Buttons / IconButtons) */
  actions?: ReactNode;
  /** Optional extra row rendered under the title (filters, breadcrumbs, status pill, etc.) */
  meta?: ReactNode;
  className?: string;
}

/**
 * Universal in-page header.
 * Use as the first child of any page content area below the global Header.
 */
export function PageHeader({
  icon,
  eyebrow,
  title,
  description,
  actions,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'shrink-0 flex flex-wrap items-start gap-3 px-6 py-4 border-b border-white/5 bg-vsc-bg/80 backdrop-blur-xl',
        className
      )}
    >
      <div className="flex items-start gap-3 flex-1 min-w-0">
        {icon ? (
          <span className="mt-0.5 inline-flex w-8 h-8 items-center justify-center rounded-lg bg-white/[0.04] text-slate-300 shrink-0">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex flex-col">
          {eyebrow ? (
            <div className="text-[10px] uppercase tracking-wider text-slate-500 truncate">
              {eyebrow}
            </div>
          ) : null}
          <h2 className="text-lg font-semibold text-white tracking-tight leading-tight truncate">
            {title}
          </h2>
          {description ? (
            <p className="text-xs text-slate-400 mt-1 line-clamp-2">{description}</p>
          ) : null}
          {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
      </div>

      {actions ? (
        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">{actions}</div>
      ) : null}
    </div>
  );
}
