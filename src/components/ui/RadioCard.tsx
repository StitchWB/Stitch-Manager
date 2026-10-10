import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../../lib/utils';

export interface RadioCardProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onSelect' | 'title'> {
  selected: boolean;
  onSelect: () => void;
  title: ReactNode;
  description?: ReactNode;
}

export function RadioCard({
  selected,
  onSelect,
  title,
  description,
  disabled = false,
  className,
  ...buttonProps
}: RadioCardProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex flex-col gap-1 rounded-md border p-2 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-indigo-400/60 bg-indigo-500/10'
          : 'border-white/10 hover:border-white/25',
        className,
      )}
      {...buttonProps}
    >
      <span className="text-xs font-medium text-white">{title}</span>
      {description ? <span className="text-2xs text-slate-400">{description}</span> : null}
    </button>
  );
}
