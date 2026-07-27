import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../../lib/utils';

export interface TabButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick'> {
  active: boolean;
  onClick: () => void;
  icon?: ReactNode;
  label: ReactNode;
  appearance?: 'workspace' | 'section';
  size?: 'sm' | 'md';
}

export function TabButton({
  active,
  onClick,
  icon,
  label,
  appearance = 'section',
  size = 'md',
  disabled = false,
  className,
  ...buttonProps
}: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-md border font-medium transition-colors duration-150',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3 text-sm',
        appearance === 'workspace' &&
        (active
          ? 'border-white/[0.11] bg-white/[0.07] text-white shadow-sm'
          : 'border-transparent text-slate-300/80 hover:border-white/[0.06] hover:bg-white/[0.045] hover:text-white'),
        appearance === 'section' &&
        (active
          ? 'border-white/[0.1] bg-vsc-hover text-vsc-text shadow-sm'
          : 'border-transparent text-vsc-text-muted hover:bg-white/[0.04] hover:text-vsc-text'),
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
      {...buttonProps}
    >
      {icon ? (
        <span
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center',
            active
              ? appearance === 'workspace'
                ? 'text-vsc-blue'
                : 'text-indigo-300'
              : 'text-slate-500'
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="whitespace-nowrap">{label}</span>
      {active && appearance === 'workspace' ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-2 -bottom-[9px] h-0.5 rounded-full bg-vsc-blue"
        />
      ) : null}
    </button>
  );
}
