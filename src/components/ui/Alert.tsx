import type { ReactNode } from 'react';
import { Info, CheckCircle2, AlertTriangle, AlertCircle, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps {
  variant?: AlertVariant;
  title?: ReactNode;
  message: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

const variantConfig: Record<AlertVariant, { icon: LucideIcon; classes: string; iconClasses: string }> = {
  info: {
    icon: Info,
    classes: 'border-sky-500/20 bg-sky-500/10',
    iconClasses: 'text-sky-400',
  },
  success: {
    icon: CheckCircle2,
    classes: 'border-emerald-500/20 bg-emerald-500/10',
    iconClasses: 'text-emerald-400',
  },
  warning: {
    icon: AlertTriangle,
    classes: 'border-amber-500/20 bg-amber-500/10',
    iconClasses: 'text-amber-400',
  },
  danger: {
    icon: AlertCircle,
    classes: 'border-red-500/20 bg-red-500/10',
    iconClasses: 'text-red-400',
  },
};

export function Alert({ variant = 'info', title, message, detail, actions, className }: AlertProps) {
  const config = variantConfig[variant];
  const Icon = config.icon;

  return (
    <div
      // Only danger interrupts assertively; the other variants announce politely.
      role={variant === 'danger' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2.5 rounded-lg border p-3 text-xs', config.classes, className)}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', config.iconClasses)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold text-slate-100">{title}</div>}
        <div className={cn('text-slate-300', title && 'mt-0.5')}>{message}</div>
        {detail && <div className="mt-1.5 text-[11px] text-slate-400">{detail}</div>}
      </div>
      {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
