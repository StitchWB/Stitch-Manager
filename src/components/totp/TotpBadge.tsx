/**
 * TotpBadge — inline badge showing live TOTP code + countdown.
 *
 * Usage in account rows:   <TotpBadge secret="QOC2VNJ7..." period={30} />
 * Usage in key cards:      <TotpBadge secret="QOC2VNJ7..." period={30} variant="full" />
 *
 * Fix: on first mount the code is generated immediately (next microtask after
 * the effect fires).  If generateTotp fails it retries every second instead of
 * waiting a full 30-second period boundary.
 */

import { useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { Tooltip } from '@/components/ui';
import { TotpTimer } from './TotpTimer';
import { cn } from '@/lib/utils';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { generateTotp, totpCounter } from '@/lib/totp';
import { t } from '@/lib/i18n';

interface TotpBadgeProps {
  secret: string;
  period?: number;
  /** compact: tiny chip for table rows; row: medium chip for key list; full: bigger card-style */
  variant?: 'compact' | 'row' | 'full';
  className?: string;
}

/** "482916" → "482 916", anything else passes through */
function formatCode(code: string): string {
  if (code.length === 6 && /^\d+$/.test(code)) {
    return `${code.slice(0, 3)} ${code.slice(3)}`;
  }
  return code;
}

const PENDING = '' as const; // empty string = "still generating"

export function TotpBadge({
  secret,
  period = 30,
  variant = 'compact',
  className,
}: TotpBadgeProps) {
  // Empty string = generating (show skeleton), non-empty = real code or error
  const [code, setCode] = useState<string>(PENDING);
  const lastCounter = useRef(-1);
  // Only suppress recalculation when we already have a valid code for this window.
  // A failed attempt (empty PENDING or error) must retry every second.
  const hasValidCode = useRef(false);
  const { copy } = useCopyToClipboard();

  useEffect(() => {
    let alive = true;

    const update = async () => {
      const counter = totpCounter(period);
      if (counter === lastCounter.current && hasValidCode.current) return;

      const newCode = await generateTotp(secret, period);
      if (!alive) return;

      if (newCode !== '------') {
        lastCounter.current = counter;
        hasValidCode.current = true;
      } else {
        // Failed — do NOT stamp counter so we retry on next tick
        hasValidCode.current = false;
      }
      setCode(newCode);
    };

    // Reset on secret/period change
    lastCounter.current = -1;
    hasValidCode.current = false;
    setCode(PENDING);

    // Fire immediately — code appears within one microtask queue flush
    void update();

    // Poll every second: catches period boundaries and retries failures
    const interval = window.setInterval(() => void update(), 1000);

    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [secret, period]);

  const isReady = code !== PENDING && code !== '------';

  /* ── compact variant (table rows) ── */
  if (variant === 'compact') {
    if (!isReady) {
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5',
            'bg-white/5 border border-white/10 text-slate-600 font-mono text-[11px] tabular-nums',
            className
          )}
          aria-label="Generating 2FA code…"
        >
          ···&nbsp;···
        </span>
      );
    }

    return (
      <Tooltip content={t('totp.copyCode', { code: formatCode(code) })} side="top">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void copy(code, { sensitive: false, successMessage: t('totp.codeCopied') });
          }}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5',
            'bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20',
            'text-emerald-300 transition-colors cursor-pointer select-none',
            className
          )}
          aria-label="Copy 2FA code"
        >
          <span className="font-mono text-[11px] font-semibold tabular-nums tracking-wider">
            {formatCode(code)}
          </span>
          <TotpTimer period={period} size={18} strokeWidth={2} showText={false} />
        </button>
      </Tooltip>
    );
  }

  /* ── row variant (list rows) ── */
  if (variant === 'row') {
    if (!isReady) {
      return (
        <span
          className={cn(
            'inline-flex items-center gap-2 rounded-md px-2.5 py-1',
            'bg-white/5 border border-white/10 text-slate-600 font-mono text-base tabular-nums',
            className
          )}
          aria-label="Generating 2FA code…"
        >
          ···&nbsp;···
        </span>
      );
    }

    return (
      <Tooltip content={t('totp.copyCode', { code: formatCode(code) })} side="top">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void copy(code, { sensitive: false, successMessage: t('totp.codeCopied') });
          }}
          className={cn(
            'inline-flex items-center gap-2 rounded-md px-2.5 py-1',
            'bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20',
            'text-emerald-300 transition-colors cursor-pointer select-none',
            className
          )}
          aria-label="Copy 2FA code"
        >
          <span className="font-mono text-base font-semibold tabular-nums tracking-[0.15em]">
            {formatCode(code)}
          </span>
          <TotpTimer period={period} size={20} strokeWidth={2} showText={false} />
          <Copy size={13} className="opacity-60" />
        </button>
      </Tooltip>
    );
  }

  /* ── full variant (key cards) ── */
  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-lg px-4 py-3',
        'bg-white/[0.03] border border-white/[0.06]',
        className
      )}
    >
      {isReady ? (
        <span className="font-mono text-2xl font-bold tracking-[0.18em] text-white tabular-nums">
          {formatCode(code)}
        </span>
      ) : (
        <span className="font-mono text-2xl font-bold tracking-[0.18em] text-slate-700 tabular-nums select-none">
          ···&nbsp;···
        </span>
      )}

      <div className="flex items-center gap-3">
        <TotpTimer period={period} size={36} strokeWidth={3} showText={true} />
        <Tooltip content="Copy code" side="top">
          <button
            type="button"
            disabled={!isReady}
            onClick={() =>
              void copy(code, { sensitive: false, successMessage: t('totp.codeCopied') })
            }
            className={cn(
              'rounded p-1.5 transition-colors',
              isReady
                ? 'text-slate-400 hover:bg-white/10 hover:text-white'
                : 'text-slate-700 cursor-default'
            )}
            aria-label="Copy 2FA code"
          >
            <Copy size={16} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
