import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

interface StatusBarProps {
  success: number;
  failed: number;
  active: number;
  className?: string;
}

export function StatusBar({ success, failed, active, className }: StatusBarProps) {
  return (
    <div className={cn('flex items-center gap-2 text-[11px]', className)}>
      <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-emerald-300">
        {t('common.check')} {success}
      </span>
      <span className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-red-300">
        {t('common.cross')} {failed}
      </span>
      <span className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-sky-300">
        {t('common.dot')} {active}
      </span>
    </div>
  );
}
