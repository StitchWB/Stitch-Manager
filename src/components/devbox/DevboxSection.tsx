import type { ReactNode } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Button } from '@/components/ui/Button';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export interface DevboxSectionProps {
  title: string;
  caption?: string;
  actions?: ReactNode;
  error?: string | null;
  onRetry?: () => void;
  children: ReactNode;
  testId?: string;
  className?: string;
  bodyClassName?: string;
}

export function DevboxSection({
  title,
  caption,
  actions,
  error,
  onRetry,
  children,
  testId,
  className,
  bodyClassName,
}: DevboxSectionProps) {
  return (
    <GlassCard className={cn('p-4', className)}>
      <div className="flex items-center justify-between gap-2 mb-3 shrink-0">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white truncate" data-testid={testId}>
            {title}
          </h3>
          {caption && <p className="text-2xs text-slate-400 mt-0.5">{caption}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {error && (
        <div
          className="flex items-center gap-2 mb-3 shrink-0"
          data-testid={testId ? `${testId}-error` : undefined}
        >
          <p className="text-2xs text-red-300 min-w-0 truncate">{error}</p>
          {onRetry && (
            <Button size="xs" variant="secondary" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          )}
        </div>
      )}
      <div className={cn('min-w-0', bodyClassName)}>{children}</div>
    </GlassCard>
  );
}
