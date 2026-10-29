import { cn } from '../../lib/utils';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number | null;
  placeholder?: string;
  gradient?: string;
  className?: string;
}

export function StatCard({
  icon,
  label,
  value,
  placeholder = '—',
  gradient,
  className = '',
}: StatCardProps) {
  const displayValue = value !== null && value !== undefined ? value : placeholder;
  const isPlaceholder = value === null || value === undefined;

  return (
    <div
      className={cn(
        'p-3 rounded-lg border border-white/10 bg-white/[0.02]',
        gradient && `bg-gradient-to-br ${gradient}`,
        className
      )}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-slate-400">
          {icon}
        </div>
        <span className="text-2xs uppercase text-slate-400 tracking-wider">
          {label}
        </span>
      </div>
      <div className={cn(
        'text-xl font-bold tabular-nums',
        isPlaceholder ? 'text-slate-600' : 'text-white'
      )}>
        {displayValue}
      </div>
    </div>
  );
}
