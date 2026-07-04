import { Link, AlertCircle } from 'lucide-react';
import { Tooltip, TableCell } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { Account } from '@/types/generated';

const V0_APP_REF_QUOTA = 40;

export interface RefMeta {
  refUrl: string | null;
  refCode: string | null;
  refUsedCount: number;
  refMaxCount: number;
}

/**
 * Parse ref fields out of registrationMetadata JSON string.
 * Falls back to metadata if not found in registrationMetadata.
 */
export function getRefMeta(account: Account): RefMeta | null {
  if (account.provider !== 'v0_app') return null;

  function parseJson(s: string | null): Record<string, unknown> {
    if (!s) return {};
    try { return JSON.parse(s) as Record<string, unknown>; } catch { return {}; }
  }

  const regMeta = parseJson(account.registrationMetadata);
  const meta = parseJson(account.metadata);
  const combined = { ...meta, ...regMeta };

  const refUrl = (combined.refUrl ?? combined.ref_url ?? null) as string | null;
  const refCode = (combined.refCode ?? combined.ref_code ?? null) as string | null;
  const refUsedCount = Number(combined.refUsedCount ?? combined.ref_used_count ?? 0);
  const refMaxCount = Number(combined.refMaxCount ?? combined.ref_max_count ?? V0_APP_REF_QUOTA);

  return { refUrl, refCode, refUsedCount, refMaxCount };
}

interface AccountRefCellProps {
  account: Account;
}

export function AccountRefCell({ account }: AccountRefCellProps) {
  const ref = getRefMeta(account);

  // Only v0_app has referral quota — hide cell for other providers
  if (!ref) {
    return (
      <TableCell className="w-[80px] min-w-[80px] px-2 py-2 align-middle">
        <span className="text-slate-600 text-[10px]">—</span>
      </TableCell>
    );
  }

  const { refUrl, refUsedCount, refMaxCount } = ref;
  const pct = Math.min(refUsedCount / refMaxCount, 1);
  const isExhausted = refUsedCount >= refMaxCount;
  const hasLink = Boolean(refUrl);
  const isActiveDonor = hasLink && !isExhausted;

  // Colour: green = active donor, amber = nearly full (>= 80%), red = exhausted
  const barColor =
    isExhausted
      ? 'bg-red-500/70'
      : pct >= 0.8
        ? 'bg-amber-400/80'
        : 'bg-emerald-500/70';

  const dotColor =
    isActiveDonor
      ? 'bg-emerald-400'
      : isExhausted
        ? 'bg-red-500'
        : 'bg-slate-500';

  const tooltipText = hasLink
    ? isExhausted
      ? `Квота исчерпана (${refUsedCount}/${refMaxCount})\n${refUrl}`
      : `Активный донор: ${refUsedCount}/${refMaxCount} рефералов\n${refUrl}`
    : 'Реферальная ссылка не получена';

  return (
    <TableCell className="w-[80px] min-w-[80px] px-2 py-2 align-middle">
      <Tooltip content={tooltipText}>
        <div className="flex flex-col gap-1 cursor-default select-none">
          {/* Top row: dot + counter */}
          <div className="flex items-center gap-1">
            <span className={cn('inline-block w-1.5 h-1.5 rounded-full flex-shrink-0', dotColor)} />
            {hasLink ? (
              <span className={cn('text-[10px] tabular-nums leading-none', isExhausted ? 'text-red-400' : 'text-slate-300')}>
                {refUsedCount}
                <span className="text-slate-500">/{refMaxCount}</span>
              </span>
            ) : (
              <AlertCircle size={10} className="text-slate-500" />
            )}
            {hasLink && (
              <Link size={9} className={cn('flex-shrink-0 ml-auto', isActiveDonor ? 'text-emerald-400/70' : 'text-slate-600')} />
            )}
          </div>
          {/* Progress bar */}
          <div className="w-full h-0.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', barColor)}
              style={{ width: `${pct * 100}%` }}
            />
          </div>
        </div>
      </Tooltip>
    </TableCell>
  );
}
