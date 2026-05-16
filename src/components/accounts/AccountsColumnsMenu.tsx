import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import { createPortal } from 'react-dom';
import { Columns3, RotateCcw } from 'lucide-react';
import { t } from '@/lib/i18n';
import { ButtonBase, Checkbox } from '@/components/ui';


export interface AccountsVisibleColumns {
  lastLogin: boolean;
  apiKey: boolean;
  quota: boolean;
}

interface AccountsColumnsMenuProps {
  visibleColumns: AccountsVisibleColumns;
  onToggleColumn: (column: keyof AccountsVisibleColumns, value: boolean) => void;
  onReset: () => void;
}

export function AccountsColumnsMenu({
  visibleColumns,
  onToggleColumn,
  onReset,
}: AccountsColumnsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);

  const portalRoot = useMemo(() => {
    if (typeof document === 'undefined') return null;
    return document.body;
  }, []);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setMenuStyle(null);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const onOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideTrigger = rootRef.current?.contains(target) ?? false;
      const insideMenu = menuRef.current?.contains(target) ?? false;
      if (!insideTrigger && !insideMenu) closeMenu();
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };

    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEscape);

    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [isOpen, closeMenu]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      const trigger = rootRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const margin = 8;
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const desiredHeight = 260;

      const availableBelow = Math.max(0, viewportHeight - rect.bottom - margin);
      const availableAbove = Math.max(0, rect.top - margin);
      const openUp = availableBelow < 200 && availableAbove > availableBelow;

      const maxHeight = Math.min(desiredHeight, openUp ? availableAbove : availableBelow);
      const width = 224;
      const left = Math.min(Math.max(rect.right - width, margin), viewportWidth - width - margin);
      const top = openUp
        ? Math.max(margin, rect.top - maxHeight - margin)
        : Math.min(viewportHeight - maxHeight - margin, rect.bottom + margin);

      setMenuStyle({
        position: 'fixed',
        left,
        top,
        width,
        maxHeight,
      });
    };

    updatePosition();

    const onScrollOrResize = () => updatePosition();
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);

    return () => {
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [isOpen]);

  return (
    <div ref={rootRef} className="relative z-[30]">
      <ButtonBase
        className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.04] transition-colors"
        onClick={() => {
          if (isOpen) closeMenu();
          else setIsOpen(true);
        }}
      >
        <Columns3 size={15} />
      </ButtonBase>

      {isOpen && portalRoot && menuStyle
        ? createPortal(
            <div
              ref={menuRef}
              style={menuStyle}
              className="z-[9999] overflow-y-auto rounded-xl border border-white/10 bg-ds-surface-overlay p-2 shadow-2xl shadow-black/70 ring-1 ring-black/40"
            >
              <div className="px-2 py-1 text-[11px] uppercase tracking-wider text-slate-400">
                {t('accounts.columnsMenuTitle')}
              </div>

              <div className="rounded-lg px-1 py-0.5 hover:bg-white/5">
                <Checkbox
                  checked={visibleColumns.lastLogin}
                  onChange={event => onToggleColumn('lastLogin', event.target.checked)}
                  label={t('accounts.columnLastLogin')}
                  className="!py-1"
                />
              </div>

              <div className="rounded-lg px-1 py-0.5 hover:bg-white/5">
                <Checkbox
                  checked={visibleColumns.apiKey}
                  onChange={event => onToggleColumn('apiKey', event.target.checked)}
                  label={t('accounts.columnApiKey')}
                  className="!py-1"
                />
              </div>

              <div className="rounded-lg px-1 py-0.5 hover:bg-white/5">
                <Checkbox
                  checked={visibleColumns.quota}
                  onChange={event => onToggleColumn('quota', event.target.checked)}
                  label={t('accounts.columnQuota')}
                  className="!py-1"
                />
              </div>

              <ButtonBase
                type="button"
                className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-white/10 px-2 py-1.5 text-xs text-slate-300 hover:bg-white/5 hover:text-white"
                onClick={() => {
                  onReset();
                  closeMenu();
                }}
              >
                <RotateCcw size={12} />
                {t('accounts.columnsReset')}
              </ButtonBase>
            </div>,
            portalRoot
          )
        : null}
    </div>
  );
}
