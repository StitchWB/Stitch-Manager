import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { t } from '../../lib/i18n';
import { Button } from './Button';

export interface ConfirmActionButtonProps
  extends Omit<React.ComponentProps<typeof Button>, 'onClick'> {
  /** Fired when the user clicks a second time while the button is armed. */
  onConfirm: () => void | Promise<void>;
  /** Content shown while armed. Defaults to t('common.sure') ("Точно?"). */
  armedLabel?: React.ReactNode;
  /** How long the armed state persists before resetting (ms). */
  armedTimeoutMs?: number;
  /** When true, strips size-based padding so the button renders as a square
   * icon-only control (pair with explicit h-/w- classes in className). */
  iconOnly?: boolean;
}

const DEFAULT_ARMED_TIMEOUT_MS = 3000;

/**
 * Two-step destructive-action button — the app's standard confirm pattern.
 * First click arms the button (it lights up red), a second click within
 * `armedTimeoutMs` fires `onConfirm`. No modals, no native dialogs.
 */
export function ConfirmActionButton({
  onConfirm,
  armedLabel,
  armedTimeoutMs = DEFAULT_ARMED_TIMEOUT_MS,
  iconOnly = false,
  className,
  children,
  disabled,
  ...rest
}: ConfirmActionButtonProps) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disarm = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setArmed(false);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = () => {
    if (!armed) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(disarm, armedTimeoutMs);
      setArmed(true);
      return;
    }
    disarm();
    void onConfirm();
  };

  return (
    <Button
      {...rest}
      disabled={disabled}
      onClick={handleClick}
      className={cn(
        className,
        iconOnly && 'p-0',
        armed &&
          'bg-red-500/30 border-red-500/70 text-red-100 hover:bg-red-500/40 hover:border-red-400 hover:text-white shadow-[0_0_12px_rgba(239,68,68,0.35)]'
      )}
    >
      {armed ? (armedLabel ?? t('common.sure')) : children}
    </Button>
  );
}
