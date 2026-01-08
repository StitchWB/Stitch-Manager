import { cn } from '../../lib/utils';

interface UsageBarProps {
  used: number;
  limit: number;
  showLabel?: boolean;
  className?: string;
}

export function UsageBar({ used, limit, showLabel = true, className }: UsageBarProps) {
  if (limit <= 0) {
    return <span className="text-[10px] text-zinc-600">—</span>;
  }

  const percent = Math.min((used / limit) * 100, 100);
  
  // Color based on usage
  const getBarColor = () => {
    if (percent >= 90) return 'bg-gradient-to-r from-red-500 to-red-400';
    if (percent >= 70) return 'bg-gradient-to-r from-amber-500 to-amber-400';
    if (percent >= 50) return 'bg-gradient-to-r from-yellow-500 to-emerald-500';
    return 'bg-gradient-to-r from-emerald-500 to-emerald-400';
  };

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      {showLabel && (
        <span className={cn(
          'text-[10px] font-mono tabular-nums',
          percent >= 90 ? 'text-red-400' : percent >= 70 ? 'text-amber-400' : 'text-zinc-500'
        )}>
          {used}/{limit}
        </span>
      )}
      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-300', getBarColor())}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
