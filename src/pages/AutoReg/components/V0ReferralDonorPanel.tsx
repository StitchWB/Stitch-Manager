import { useCallback, useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import { Link2, RefreshCw, AlertCircle } from 'lucide-react';

import { GlassCard, Select, Input } from '@/components/ui';
import { cn } from '@/lib/utils';
import { getReferralDonors, type ReferralDonor } from '@/lib/backend';
import { ButtonBase } from '@/components/ui/ButtonBase';

interface V0ReferralDonorPanelProps {
  /** Selected donor id, or null for automatic selection. */
  value: string | null;
  onChange: (donorId: string | null) => void;
  /**
   * Custom referral link typed by the operator. When non-empty it overrides
   * both donor auto-pick and the default seed URL.
   */
  customUrl?: string;
  onCustomUrlChange?: (url: string) => void;
  /** Bump this to force a refetch (e.g. after a registration completes). */
  refreshKey?: number;
}

const AUTO = '__auto__';

/**
 * Referral donor picker + status banner for v0_app registrations.
 *
 * Shows which donor account is currently "being topped up" by new signups and
 * lets the operator either let the system auto-pick the oldest donor with free
 * slots, or pin a specific donor manually.
 */
export function V0ReferralDonorPanel({
  value,
  onChange,
  customUrl = '',
  onCustomUrlChange,
  refreshKey = 0,
}: V0ReferralDonorPanelProps) {
  const hasCustomUrl = customUrl.trim().length > 0;
  const [donors, setDonors] = useState<ReferralDonor[]>([]);
  const [activeDonorId, setActiveDonorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getReferralDonors();
      setDonors(res.donors);
      setActiveDonorId(res.activeDonorId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
    void load();
    });
  }, [load, refreshKey]);

  // The donor that will actually be used: manual selection or the auto-pick.
  const effectiveId = value ?? activeDonorId;
  const effectiveDonor = donors.find(d => d.id === effectiveId) || null;

  const pct = effectiveDonor
    ? Math.min((effectiveDonor.refUsedCount || 0) / (effectiveDonor.refMaxCount || 40), 1)
    : 0;

  return (
    <GlassCard className="p-3 border-emerald-500/20 bg-emerald-500/5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-emerald-300/80">
          <Link2 size={13} />
          <span>{t('uiTexts.referralDonor')}</span>
        </div>
        <ButtonBase
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="text-slate-400 hover:text-slate-200 disabled:opacity-50"
          aria-label="Обновить список доноров"
        >
          <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
        </ButtonBase>
      </div>

      {/* Active donor banner */}
      {effectiveDonor ? (
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
            <span className="text-sm text-white font-medium truncate">
              {effectiveDonor.email}
            </span>
            <span className="text-xs tabular-nums text-slate-300 ml-auto flex-shrink-0">
              {effectiveDonor.refUsedCount}
              <span className="text-slate-500">/{effectiveDonor.refMaxCount}</span>
            </span>
          </div>
          <div className="text-[11px] text-emerald-300/70 mt-1">
            {value ? t('uiTexts.manualSelected') : t('uiTexts.autoSelected')} · {t('uiTexts.refillingNow')}
          </div>
          <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden mt-1.5">
            <div
              className="h-full rounded-full bg-emerald-500/70 transition-all"
              style={{ width: `${pct * 100}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="mb-3 flex items-center gap-2 text-xs text-amber-300/90">
          <AlertCircle size={13} className="flex-shrink-0" />
          <span>
            {error
              ? `Ошибка загрузки доноров: ${error}`
              : 'Нет доступных доноров — регистрация пойдёт по стартовой ссылке.'}
          </span>
        </div>
      )}

      {/* Donor selector — disabled while a custom link is in use */}
      <Select
        value={value ?? AUTO}
        disabled={hasCustomUrl}
        onChange={e => {
          const v = e.target.value;
          onChange(v === AUTO ? null : v);
        }}
        className={cn('h-9 py-1 text-xs w-full', hasCustomUrl && 'opacity-40')}
      >
        <option value={AUTO}>
          {t('uiTexts.auto')}{activeDonorId ? '' : ` (${t('uiTexts.noDonors')})`}
        </option>
        {donors.map(d => {
          const exhausted = (d.refUsedCount || 0) >= (d.refMaxCount || 40);
          return (
            <option key={d.id} value={d.id} disabled={exhausted}>
              {d.email} · {d.refUsedCount}/{d.refMaxCount}
              {exhausted ? ' · исчерпан' : ''}
            </option>
          );
        })}
      </Select>

      {/* Manual custom referral link */}
      {onCustomUrlChange && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <label className="block text-[11px] uppercase tracking-widest text-slate-400 mb-1.5">
            {t('uiTexts.customReferral')}
          </label>
          <Input
            type="text"
            value={customUrl}
            onChange={e => onCustomUrlChange(e.target.value)}
            placeholder="https://v0.app/ref/XXXXXX"
            className="h-9 py-1 text-xs w-full"
          />
          <p
            className={cn(
              'text-[11px] mt-1.5',
              hasCustomUrl ? 'text-emerald-300/80' : 'text-slate-500',
            )}
          >
            {hasCustomUrl
              ? 'Регистрация пойдёт по этой ссылке — выбор донора игнорируется.'
              : 'Оставьте пустым, чтобы использовать выбор донора выше.'}
          </p>
        </div>
      )}
    </GlassCard>
  );
}