import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

import { cn } from '@/lib/utils';
import { IconButton } from './IconButton';

export interface OverflowMenuItem {
  /** Stable id for keys. */
  id: string;
  /** Item label. */
  label: string;
  /** Optional left icon. */
  icon?: React.ReactNode;
  /** Click handler. */
  onSelect: () => void;
  /** Visual tone for the item. */
  tone?: 'default' | 'danger';
  /** Disabled state. */
  disabled?: boolean;
}

export interface OverflowMenuProps {
  items: OverflowMenuItem[];
  /** Tooltip / aria-label for the trigger. */
  triggerLabel?: string;
  /** Custom trigger icon. Defaults to MoreHorizontal. */
  triggerIcon?: React.ReactNode;
  /** Trigger size, passed to IconButton. */
  size?: 'sm' | 'md';
  /** Visual variant of the trigger. */
  triggerVariant?: 'default' | 'ghost';
  className?: string;
}

/**
 * Minimal kebab/overflow menu. Use to hide secondary or rare actions
 * (developer/debug utilities, destructive variants, etc.) behind a
 * single ⋯ button next to the primary action cluster.
 */
export function OverflowMenu({
  items,
  triggerLabel,
  triggerIcon,
  size = 'md',
  triggerVariant = 'ghost',
  className,
}: OverflowMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const update = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const margin = 4;
      const width = 200;
      const left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin));
      const top = rect.bottom + margin;
      setMenuStyle({ position: 'fixed', left, top, width });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  const menu = isOpen ? (
    <div
      ref={menuRef}
      role="menu"
      style={menuStyle ?? {}}
      className="z-50 bg-vsc-panel/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl overflow-hidden animate-fade-in"
    >
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            setIsOpen(false);
            item.onSelect();
          }}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors',
            item.tone === 'danger'
              ? 'text-red-300 hover:bg-red-500/10 hover:text-red-200'
              : 'text-slate-300 hover:bg-white/5 hover:text-white',
            item.disabled && 'opacity-40 cursor-not-allowed pointer-events-none'
          )}
        >
          {item.icon ? <span className="shrink-0">{item.icon}</span> : null}
          <span className="flex-1">{item.label}</span>
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className={cn('inline-flex', className)}>
      <IconButton
        ref={triggerRef}
        size={size}
        variant={triggerVariant}
        onClick={() => setIsOpen(prev => !prev)}
        aria-label={triggerLabel ?? 'More'}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        {triggerIcon ?? <MoreHorizontal size={16} />}
      </IconButton>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
