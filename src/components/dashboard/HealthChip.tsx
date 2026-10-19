import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ButtonBase } from '@/components/ui/ButtonBase';
import type { HealthReport } from '@/lib/dashboard/insights';

import { TweenNumber } from './TweenNumber';

interface HealthChipProps {
  report: HealthReport;
  details: Record<string, string>;
}

const PART_LABEL_KEYS: Record<string, string> = {
  fleet: 'dashboard.cc.health.partFleet',
  quota: 'dashboard.cc.health.partQuota',
  services: 'dashboard.cc.health.partServices',
  errors: 'dashboard.cc.health.partErrors',
};

function scoreClasses(score: number): string {
  if (score > 79) {
    return 'text-emerald-400 border-emerald-400/40 bg-emerald-500/10 shadow-[0_0_8px_rgba(52,211,153,0.25)]';
  }
  if (score >= 50) {
    return 'text-amber-400 border-amber-400/40 bg-amber-500/10 shadow-[0_0_8px_rgba(251,191,36,0.25)]';
  }
  return 'text-red-400 border-red-400/40 bg-red-500/10 shadow-[0_0_8px_rgba(248,113,113,0.25)]';
}

function partDotClasses(score: number): string {
  if (score > 79) return 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]';
  if (score >= 50) return 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]';
  return 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.6)]';
}

export function HealthChip({ report, details }: HealthChipProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <ButtonBase
        type="button"
        data-testid="health-chip"
        aria-label={t('dashboard.cc.health.ariaLabel')}
        aria-expanded={open}
        onClick={() => setOpen(prev => !prev)}
        className={cn(
          'flex items-center gap-1.5 h-7 px-2.5 rounded-md border transition-colors',
          scoreClasses(report.score),
        )}
      >
        <motion.span
          key={report.score}
          initial={{ scale: 0.9, opacity: 0.6 }}
          animate={{ scale: 1, opacity: 1 }}
          className="inline-flex"
        >
          <TweenNumber
            value={report.score}
            className="text-[20px] bg-gradient-to-r from-indigo-300 via-violet-300 to-indigo-200 bg-clip-text text-transparent font-semibold tabular-nums leading-none"
          />
        </motion.span>
        <span className="text-[10px] uppercase tracking-wider opacity-70">
          {t('dashboard.cc.health.title')}
        </span>
      </ButtonBase>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-1.5 w-64 z-50 rounded-lg bg-vsc-panel backdrop-blur-md border border-vsc-border-light shadow-xl p-2 flex flex-col gap-1"
            role="dialog"
            aria-label={t('dashboard.cc.health.title')}
          >
            {report.parts.map(part => (
              <div
                key={part.id}
                className="flex items-center gap-2 px-1.5 py-1 rounded-md hover:bg-white/[0.03]"
              >
                <span
                  className={cn('w-1.5 h-1.5 rounded-full shrink-0', partDotClasses(part.score))}
                  aria-hidden="true"
                />
                <span className="text-[11px] text-slate-300 shrink-0">
                  {PART_LABEL_KEYS[part.id] ? t(PART_LABEL_KEYS[part.id]) : part.id}
                </span>
                <span className="text-[10px] text-slate-500 truncate flex-1 min-w-0">
                  {details[part.id] ?? part.detail}
                </span>
                <span className="text-[11px] text-slate-200 tabular-nums font-medium shrink-0">
                  {Math.round(part.score)}
                </span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
