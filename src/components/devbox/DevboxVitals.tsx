import { Activity } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { GlassCard } from '@/components/ui/GlassCard';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { devboxTime, type DevboxVitalCard } from '@/lib/backend/modules/devbox';
import { DevboxSection } from './DevboxSection';
import { devboxLabel } from './labels';

const TONE_VALUE_CLASSES: Record<string, string> = {
  ok: 'text-emerald-300',
  warn: 'text-amber-300',
  down: 'text-red-300',
};

const TONE_BORDER_CLASSES: Record<string, string> = {
  ok: 'border-emerald-500/25',
  warn: 'border-amber-500/25',
  down: 'border-red-500/30',
};

function VitalCard({ card }: { card: DevboxVitalCard }) {
  const tone = TONE_VALUE_CLASSES[card.tone] ? card.tone : 'ok';
  return (
    <GlassCard
      className={cn('p-3 flex flex-col gap-1', TONE_BORDER_CLASSES[tone])}
    >
      <span className="text-2xs uppercase tracking-wider text-slate-500 truncate">
        {devboxLabel(card.title)}
      </span>
      <span
        className={cn('text-sm font-semibold truncate', TONE_VALUE_CLASSES[tone])}
        data-testid={`devbox-vital-value-${card.id}`}
      >
        {card.value}
      </span>
      {card.hint && <span className="text-2xs text-slate-500 truncate">{devboxLabel(card.hint)}</span>}
      {card.updatedAt !== null && card.updatedAt !== undefined && card.updatedAt !== '' && (
        <span className="text-2xs text-slate-600">
          {t('devboxPage.updatedStamp', { time: devboxTime(card.updatedAt) })}
        </span>
      )}
    </GlassCard>
  );
}

export interface DevboxVitalsProps {
  cards: DevboxVitalCard[] | null;
  error: string | null;
  onRetry: () => void;
}

export function DevboxVitals({ cards, error, onRetry }: DevboxVitalsProps) {
  const rows = Array.isArray(cards) ? cards : [];
  return (
    <DevboxSection
      title={t('devboxPage.sectionOverview')}
      error={error}
      onRetry={onRetry}
      testId="devbox-vitals"
    >
      {rows.length === 0 && !error ? (
        <EmptyState compact icon={Activity} title={t('devboxPage.vitalsEmpty')} />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {rows.map(card => (
            <VitalCard key={card.id} card={card} />
          ))}
        </div>
      )}
    </DevboxSection>
  );
}
