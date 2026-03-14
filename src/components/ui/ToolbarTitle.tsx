import { cn } from '@/lib/utils';

interface ToolbarTitleProps {
  eyebrow?: string;
  title: string;
  className?: string;
  eyebrowClassName?: string;
  titleClassName?: string;
}

export function ToolbarTitle({
  eyebrow,
  title,
  className,
  eyebrowClassName,
  titleClassName,
}: ToolbarTitleProps) {
  return (
    <div className={cn('min-w-0', className)}>
      {eyebrow ? (
        <div className={cn('text-xs text-slate-400', eyebrowClassName)}>{eyebrow}</div>
      ) : null}
      <div className={cn('text-sm text-slate-200', titleClassName)}>{title}</div>
    </div>
  );
}
