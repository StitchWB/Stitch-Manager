import { useMemo } from 'react';

import { t } from '@/lib/i18n';
import { cn, getDateLocale } from '@/lib/utils';
import { Tooltip } from '@/components/ui/Tooltip';
import type { FleetAccount, RegEvent } from '@/lib/dashboard/insights';

interface HeatRibbonProps {
  accounts: FleetAccount[];
  regEvents: RegEvent[];
  now: number;
}

interface DayBucket {
  dayStart: number;
  label: string;
  regs: number;
  attempts: number;
  ok: number;
}

const DAY_MS = 86_400_000;
const DAYS = 7;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function rateClasses(attempts: number, ok: number): string {
  if (attempts === 0) return 'bg-white/[0.04]';
  const rate = ok / attempts;
  if (rate >= 0.8) return 'bg-emerald-500';
  if (rate >= 0.5) return 'bg-amber-500';
  return 'bg-red-500';
}

function densityClasses(count: number, max: number): string {
  if (count === 0 || max === 0) return 'bg-white/[0.04]';
  const ratio = count / max;
  if (ratio > 0.75) return 'bg-emerald-500';
  if (ratio > 0.5) return 'bg-emerald-500/70';
  if (ratio > 0.25) return 'bg-emerald-500/45';
  return 'bg-emerald-500/25';
}

export function HeatRibbon({ accounts, regEvents, now }: HeatRibbonProps) {
  const dateLocale = getDateLocale();
  const buckets = useMemo<DayBucket[]>(() => {
    const today = startOfDay(now);
    const days: DayBucket[] = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const dayStart = today - i * DAY_MS;
      days.push({
        dayStart,
        label: new Date(dayStart).toLocaleDateString(dateLocale, { weekday: 'short' }),
        regs: 0,
        attempts: 0,
        ok: 0,
      });
    }
    const indexByDay = new Map(days.map((d, idx) => [d.dayStart, idx]));

    for (const account of accounts) {
      if (account.createdAt === null) continue;
      const ts = new Date(account.createdAt).getTime();
      if (!Number.isFinite(ts)) continue;
      const idx = indexByDay.get(startOfDay(ts));
      if (idx !== undefined) days[idx].regs += 1;
    }
    for (const event of regEvents) {
      const idx = indexByDay.get(startOfDay(event.at));
      if (idx === undefined) continue;
      days[idx].attempts += 1;
      if (event.ok) days[idx].ok += 1;
    }
    return days;
  }, [accounts, regEvents, now, dateLocale]);

  const maxRegs = Math.max(...buckets.map(b => b.regs), 1);
  const hasData = buckets.some(b => b.regs > 0 || b.attempts > 0);

  return (
    <section
      aria-label={t('dashboard.cc.heat.title')}
      className="shrink-0 rounded-lg bg-black/40 backdrop-blur-sm border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-shadow hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_28px_rgba(99,102,241,0.07)] px-3 py-2"
      data-testid="heat-ribbon"
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="flex items-center gap-1.5 min-w-0">
          <span
            aria-hidden="true"
            className="w-0.5 h-3 rounded-full bg-gradient-to-b from-indigo-400 to-violet-500 shrink-0"
          />
          <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400 font-medium select-none">
            {t('dashboard.cc.heat.title')}
          </span>
        </span>
        <span className="flex items-center gap-3 min-w-0">
          <span className="flex items-center gap-1 text-[10px] text-slate-400 truncate">
            <span className="w-2 h-2 rounded-sm bg-emerald-500 shrink-0" aria-hidden="true" />
            {t('dashboard.cc.heat.registrations')}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-slate-400 truncate">
            <span className="w-2 h-2 rounded-sm bg-slate-600 shrink-0" aria-hidden="true" />
            {t('dashboard.cc.heat.okRate')}
          </span>
        </span>
      </div>
      {hasData ? (
        <div className="grid grid-cols-7 gap-px">
          {buckets.map(bucket => (
            <Tooltip
              key={bucket.dayStart}
              content={t('dashboard.cc.heat.tooltip', {
                day: bucket.label,
                regs: bucket.regs,
                ok: bucket.ok,
                attempts: bucket.attempts,
              })}
              side="top"
              wrapperClassName="w-full"
            >
              <div className="flex flex-col gap-1 items-stretch w-full min-w-0">
                <div
                  className={cn('h-1.5 rounded-sm', densityClasses(bucket.regs, maxRegs))}
                  aria-hidden="true"
                />
                <div
                  className={cn('h-1.5 rounded-sm', rateClasses(bucket.attempts, bucket.ok))}
                  aria-hidden="true"
                />
                <span className="mt-1 text-[10px] text-slate-600 text-center truncate leading-tight">
                  {bucket.label}
                </span>
              </div>
            </Tooltip>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-2">
          <svg
            width="40"
            height="40"
            viewBox="0 0 40 40"
            fill="none"
            strokeWidth="1.5"
            className="stroke-slate-600"
            aria-hidden="true"
          >
            <rect x="1.5" y="24" width="4" height="6" rx="1" />
            <rect x="7" y="24" width="4" height="6" rx="1" />
            <rect x="12.5" y="24" width="4" height="6" rx="1" />
            <rect x="18" y="16" width="4" height="14" rx="1" />
            <rect x="23.5" y="24" width="4" height="6" rx="1" />
            <rect x="29" y="24" width="4" height="6" rx="1" />
            <rect x="34.5" y="24" width="4" height="6" rx="1" />
          </svg>
          <p className="text-[11px] text-slate-400">{t('dashboard.cc.heat.empty')}</p>
        </div>
      )}
    </section>
  );
}
