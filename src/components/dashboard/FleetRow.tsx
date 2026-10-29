import { useState } from 'react';
import { Minus, Pin, Plus, RefreshCw, UserPlus } from 'lucide-react';
import { motion } from 'framer-motion';

import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ButtonBase } from '@/components/ui/ButtonBase';
import { Tooltip } from '@/components/ui/Tooltip';

import { Sparkline } from './Sparkline';
import { TweenNumber } from './TweenNumber';
import { FLEET_ROW, FLEET_ROW_COMPACT, ROW_HEIGHT } from './rowGrid';

export interface FleetRowData {
  providerId: string;
  name: string;
  color: string | null;
  active: number;
  target: number;
  total: number;
  avgQuotaPct: number | null;
  spark: number[];
  successDeltaPct: number | null;
  pinned: boolean;
}

interface FleetRowProps {
  row: FleetRowData;
  index: number;
  compact?: boolean;
  onTargetChange: (providerId: string, value: number) => void;
  onRefresh: (providerId: string) => void;
  onRegister: (providerId: string) => void;
  onOpenAccounts: (providerId: string) => void;
  onTogglePin: (providerId: string) => void;
}

function statusRing(row: FleetRowData): { classes: string; tooltip: string } {
  if (row.active === 0) {
    return { classes: 'ring-slate-500/40', tooltip: t('dashboard.cc.fleet.statusEmpty') };
  }
  if (row.target > 0 && row.active < row.target) {
    return {
      classes: 'ring-amber-400/60',
      tooltip: t('dashboard.cc.fleet.statusGap', { gap: row.target - row.active }),
    };
  }
  return {
    classes: 'ring-emerald-400/60',
    tooltip: row.target > 0 ? t('dashboard.cc.fleet.statusOk') : t('dashboard.cc.fleet.statusNoTarget'),
  };
}

function quotaBarColor(pct: number): string {
  if (pct > 80) return 'bg-amber-400';
  return 'bg-emerald-400';
}

const ACTION_BUTTON =
  'p-1 rounded text-slate-500 hover:text-white hover:bg-white/[0.08] transition-colors';

export function FleetRow({
  row,
  index,
  compact = false,
  onTargetChange,
  onRefresh,
  onRegister,
  onOpenAccounts,
  onTogglePin,
}: FleetRowProps) {
  const [editingTarget, setEditingTarget] = useState(false);
  const ring = statusRing(row);

  const clamp = (value: number) => Math.min(99, Math.max(0, value));

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.06 }}
      data-testid={`fleet-row-${row.providerId}`}
      onClick={() => onOpenAccounts(row.providerId)}
      tabIndex={0}
      onKeyDown={event => {
        if (event.key === 'Enter') onOpenAccounts(row.providerId);
      }}
      className={cn(
        compact ? FLEET_ROW_COMPACT : FLEET_ROW,
        ROW_HEIGHT,
        'group px-2 rounded-md cursor-pointer hover:bg-white/[0.03] hover:-translate-y-px transition-all',
      )}
    >
      <Tooltip content={ring.tooltip} side="top">
        <span className={cn('block rounded-full ring-1 mx-auto', ring.classes)} aria-hidden="true">
          <span
            className={cn(
              'block w-2 h-2 rounded-full bg-gradient-to-br shadow-[0_0_8px_rgba(255,255,255,0.25)]',
              row.color ?? 'from-slate-600 to-slate-700',
            )}
          />
        </span>
      </Tooltip>

      <span className="flex items-center gap-2 min-w-0">
        <span
          className={cn(
            'w-4 h-4 rounded shrink-0 bg-gradient-to-br',
            row.color ?? 'from-slate-600 to-slate-700',
          )}
          aria-hidden="true"
        />
        <span className="text-[11px] text-slate-200 truncate">{row.name}</span>
      </span>

      <span
        className="flex items-center justify-end gap-0.5 tabular-nums min-w-0"
        onClick={event => event.stopPropagation()}
        onBlur={() => setEditingTarget(false)}
      >
        {editingTarget ? (
          <span className="flex items-center gap-0.5">
            <ButtonBase
              type="button"
              aria-label={t('dashboard.cc.fleet.decrement')}
              className={ACTION_BUTTON}
              onClick={() => onTargetChange(row.providerId, clamp(row.target - 1))}
            >
              <Minus size={11} />
            </ButtonBase>
            <motion.span
              key={row.target}
              initial={{ scale: 1.25 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="text-[11px] text-white w-5 text-center inline-block"
            >
              {row.target}
            </motion.span>
            <ButtonBase
              type="button"
              aria-label={t('dashboard.cc.fleet.increment')}
              className={ACTION_BUTTON}
              onClick={() => onTargetChange(row.providerId, clamp(row.target + 1))}
            >
              <Plus size={11} />
            </ButtonBase>
          </span>
        ) : (
          <>
            <TweenNumber value={row.active} className="text-[13px] text-white font-bold tabular-nums" />
            {row.target > 0 ? (
              <Tooltip content={t('dashboard.cc.fleet.editTarget')} side="top">
                <ButtonBase
                  type="button"
                  aria-label={t('dashboard.cc.fleet.editTarget')}
                  onClick={() => setEditingTarget(true)}
                  className="text-[10px] tabular-nums text-slate-500 hover:text-slate-300 transition-colors"
                >
                  /{row.target}
                </ButtonBase>
              </Tooltip>
            ) : (
              <ButtonBase
                type="button"
                aria-label={t('dashboard.cc.fleet.editTarget')}
                onClick={() => setEditingTarget(true)}
                className="text-[10px] tabular-nums text-slate-500 hover:text-slate-300 transition-colors"
              >
                —
              </ButtonBase>
            )}
          </>
        )}
      </span>

      <Tooltip
        content={
          row.avgQuotaPct === null
            ? t('dashboard.cc.fleet.quotaNoData')
            : t('dashboard.cc.fleet.avgQuota', { pct: row.avgQuotaPct })
        }
        side="top"
      >
        <span className="flex items-center gap-1.5 min-w-0 w-full">
          <span className="text-[11px] tabular-nums text-slate-300 w-10 text-right shrink-0">
            {row.avgQuotaPct === null ? '—' : `${row.avgQuotaPct}%`}
          </span>
          <span className="flex-1 h-0.5 rounded bg-white/15 overflow-hidden min-w-[24px]">
            <span
              className={cn(
                'block h-0.5 rounded',
                quotaBarColor(row.avgQuotaPct ?? 0),
              )}
              style={{ width: `${Math.min(100, row.avgQuotaPct ?? 0)}%` }}
            />
          </span>
        </span>
      </Tooltip>

      {!compact && (
        <>
          <Tooltip content={t('dashboard.cc.fleet.reg7d')} side="top">
            <span className="text-emerald-300/80 flex justify-end">
              {row.spark.reduce((sum, value) => sum + value, 0) > 0 ? (
                <Sparkline data={row.spark} />
              ) : (
                <span className="text-[10px] text-slate-600 tabular-nums">—</span>
              )}
            </span>
          </Tooltip>

          <span className="flex justify-end">
            {row.successDeltaPct !== null ? (
              <Tooltip content={t('dashboard.cc.fleet.successDelta')} side="top">
                <span
                  className={cn(
                    'text-[10px] tabular-nums font-medium px-1 py-0.5 rounded',
                    row.successDeltaPct >= 0
                      ? 'text-emerald-400 bg-emerald-500/10'
                      : 'text-red-400 bg-red-500/10',
                  )}
                >
                  {row.successDeltaPct > 0 ? '+' : ''}
                  {row.successDeltaPct}%
                </span>
              </Tooltip>
            ) : (
              <span className="text-[10px] text-slate-600 tabular-nums">—</span>
            )}
          </span>
        </>
      )}

      <span
        className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
        onClick={event => event.stopPropagation()}
      >
        <Tooltip content={row.pinned ? t('dashboard.cc.fleet.unpin') : t('dashboard.cc.fleet.pin')} side="top">
          <ButtonBase
            type="button"
            aria-label={row.pinned ? t('dashboard.cc.fleet.unpin') : t('dashboard.cc.fleet.pin')}
            data-testid={`pin-${row.providerId}`}
            className={cn(ACTION_BUTTON, row.pinned && 'text-indigo-400 opacity-100')}
            onClick={() => onTogglePin(row.providerId)}
          >
            <Pin size={12} className={row.pinned ? 'fill-current' : undefined} />
          </ButtonBase>
        </Tooltip>
        <Tooltip content={t('dashboard.cc.fleet.refreshTokens')} side="top">
          <ButtonBase
            type="button"
            aria-label={t('dashboard.cc.fleet.refreshTokens')}
            className={ACTION_BUTTON}
            onClick={() => onRefresh(row.providerId)}
          >
            <RefreshCw size={12} />
          </ButtonBase>
        </Tooltip>
        <Tooltip content={t('dashboard.cc.fleet.register')} side="top">
          <ButtonBase
            type="button"
            aria-label={t('dashboard.cc.fleet.register')}
            className={ACTION_BUTTON}
            onClick={() => onRegister(row.providerId)}
          >
            <UserPlus size={12} />
          </ButtonBase>
        </Tooltip>
      </span>
    </motion.div>
  );
}
