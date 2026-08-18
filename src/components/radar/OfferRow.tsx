import { useState } from 'react';
import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/IconButton';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { openUrlInBrowser } from '@/lib/backend/modules/aiProxy';
import type { RadarOffer, RadarEffort } from '@/lib/backend';
import { OfferDetail } from './OfferDetail';

// ── Relative time helper (no shared util exists in the repo yet) ────────────
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = now - then;
  if (!Number.isFinite(diff) || diff < 0) return t('time.justNow');
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { count: hours });
  return t('time.daysAgo', { count: Math.floor(hours / 24) });
}

const EFFORT_VARIANT: Record<RadarEffort, 'success' | 'warning' | 'danger'> = {
  easy: 'success',
  medium: 'warning',
  hard: 'danger',
};

function formatAmount(offer: RadarOffer): string | null {
  if (offer.amount === null) return null;
  if (offer.unit === 'usd') return `$${offer.amount}`;
  if (offer.unit === 'credits') return `${offer.amount} ${t('radar.credits')}`;
  return `${offer.amount}${offer.unit ? ` ${offer.unit}` : ''}`;
}

function Favicon({ domain, name }: { domain: string; name: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    const letter = (name || domain).charAt(0).toUpperCase() || '?';
    return (
      <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-2xs font-bold text-slate-300 shrink-0">
        {letter}
      </div>
    );
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
      alt=""
      className="w-5 h-5 rounded shrink-0 object-contain"
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}

interface OfferRowProps {
  offer: RadarOffer;
}

export function OfferRow({ offer }: OfferRowProps) {
  const [expanded, setExpanded] = useState(false);
  const amount = formatAmount(offer);

  return (
    <div className="border-b border-white/[0.04]">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(v => !v)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded(v => !v);
          }
        }}
        className={cn(
          'flex items-center gap-2.5 px-4 h-9 cursor-pointer transition-colors',
          expanded ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
        )}
      >
        <Favicon domain={offer.domain} name={offer.name} />

        <div className="flex items-baseline gap-1.5 min-w-0 flex-1">
          <span className="text-sm text-white truncate font-medium">{offer.name}</span>
          <span className="text-2xs text-slate-600 truncate hidden sm:inline">{offer.domain}</span>
        </div>

        {amount && (
          <Badge variant="info" size="sm" className="shrink-0 normal-case">
            {amount}
          </Badge>
        )}

        {offer.effort && (
          <Badge variant={EFFORT_VARIANT[offer.effort]} size="sm" className="shrink-0">
            {offer.effort}
          </Badge>
        )}

        <div className="flex items-center gap-1.5 shrink-0 w-12">
          <div className="w-10 h-1 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-indigo-400 rounded-full"
              style={{ width: `${Math.min(Math.max(offer.score * 100, 0), 100)}%` }}
            />
          </div>
        </div>

        {offer.models.length > 0 && (
          <div className="flex items-center gap-1 shrink-0 hidden lg:flex">
            {offer.models.slice(0, 3).map(m => (
              <span
                key={m}
                className="text-2xs px-1.5 py-0.5 rounded bg-white/5 text-slate-400 max-w-[5rem] truncate"
              >
                {m}
              </span>
            ))}
            {offer.models.length > 3 && (
              <span className="text-2xs text-slate-600">
                {t('radar.modelsMore', { count: offer.models.length - 3 })}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-1 shrink-0 w-28 justify-end">
          <span className="text-2xs text-slate-600 truncate text-right">
            {offer.source ? `${offer.source} · ` : ''}
            {timeAgo(offer.first_seen_at)}
          </span>
        </div>

        {offer.url && (
          <IconButton
            size="sm"
            variant="ghost"
            aria-label={offer.url}
            onClick={e => {
              e.stopPropagation();
              void openUrlInBrowser(offer.url as string);
            }}
            className="shrink-0"
          >
            <ArrowUpRight size={14} />
          </IconButton>
        )}

        <ChevronDown
          size={14}
          className={cn(
            'shrink-0 text-slate-600 transition-transform duration-200',
            expanded && 'rotate-180'
          )}
        />
      </div>

      {expanded && <OfferDetail offer={offer} />}
    </div>
  );
}
