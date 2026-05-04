import { cn } from '../../lib/utils';

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

export function TabButton({
  active,
  onClick,
  icon,
  label,
  disabled = false,
  className = '',
}: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200',
        active
          ? 'text-white bg-indigo-500/20 shadow-[0_0_10px_rgba(99,102,241,0.3)]'
          : 'text-slate-500 hover:text-slate-300 hover:bg-white/5',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      {icon && <span className="w-4 h-4">{icon}</span>}
      {label}
    </button>
  );
}
