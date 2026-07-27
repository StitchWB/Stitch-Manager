import type { LucideIcon } from 'lucide-react';

import { ButtonBase } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface AiSectionNavItem<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: LucideIcon;
  badge?: string | number;
}

interface AiSectionNavProps<T extends string> {
  label: string;
  items: AiSectionNavItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function AiSectionNav<T extends string>({
  label,
  items,
  value,
  onChange,
  className,
}: AiSectionNavProps<T>) {
  return (
    <>
      <aside
        aria-label={label}
        className={cn(
          'hidden w-56 shrink-0 border-r border-white/[0.06] bg-vsc-sidebar/20 p-3 lg:flex lg:flex-col',
          className
        )}
      >
        <div className="px-2 pb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-600">
          {label}
        </div>
        <div className="space-y-1">
          {items.map(item => {
            const Icon = item.icon;
            const active = item.value === value;
            return (
              <ButtonBase
                key={item.value}
                type="button"
                onClick={() => onChange(item.value)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2.5 text-left transition-colors',
                  active
                    ? 'border-indigo-400/20 bg-indigo-500/10 text-white'
                    : 'border-transparent text-slate-400 hover:border-white/[0.06] hover:bg-white/[0.03] hover:text-slate-200'
                )}
              >
                {Icon ? (
                  <Icon
                    size={15}
                    className={cn('mt-0.5 shrink-0', active ? 'text-indigo-300' : 'text-slate-600')}
                  />
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2 text-xs font-medium">
                    <span className="truncate">{item.label}</span>
                    {item.badge !== undefined ? (
                      <span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[9px] tabular-nums text-slate-500">
                        {item.badge}
                      </span>
                    ) : null}
                  </span>
                  {item.description ? (
                    <span className="mt-0.5 block text-[10px] leading-4 text-slate-600 group-hover:text-slate-500">
                      {item.description}
                    </span>
                  ) : null}
                </span>
              </ButtonBase>
            );
          })}
        </div>
      </aside>

      <div className="shrink-0 overflow-x-auto border-b border-white/[0.06] bg-vsc-sidebar/20 p-2 lg:hidden">
        <div className="flex min-w-max gap-1">
          {items.map(item => {
            const Icon = item.icon;
            const active = item.value === value;
            return (
              <ButtonBase
                key={item.value}
                type="button"
                onClick={() => onChange(item.value)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium',
                  active ? 'bg-indigo-500/15 text-white' : 'text-slate-500 hover:bg-white/5'
                )}
              >
                {Icon ? <Icon size={13} /> : null}
                {item.label}
              </ButtonBase>
            );
          })}
        </div>
      </div>
    </>
  );
}
