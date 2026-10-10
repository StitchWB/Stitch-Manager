import { useCallback } from 'react';
import { ScrollText } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { t } from '@/lib/i18n';
import {
  devboxEventsTail,
  devboxNormalizeEventRows,
  devboxTime,
  type DevboxEventRow,
} from '@/lib/backend/modules/devbox';
import { DevboxSection } from './DevboxSection';
import { useDevboxPoll } from './useDevboxPoll';
import { DEVBOX_EVENTS_LIMIT, DEVBOX_REFRESH_MS } from './constants';

function eventLine(row: DevboxEventRow): string {
  const parts = [devboxTime(row.ts), row.kind, row.tool, row.status].filter(
    (part): part is string => typeof part === 'string' && part !== '' && part !== '—',
  );
  return parts.length > 0 ? parts.join(' · ') : JSON.stringify(row);
}

export function DevboxEvents() {
  const fetcher = useCallback(() => devboxEventsTail(DEVBOX_EVENTS_LIMIT), []);
  const { data, error, reload } = useDevboxPoll(fetcher, DEVBOX_REFRESH_MS);
  const rows = devboxNormalizeEventRows(data);

  return (
    <DevboxSection
      title={t('devboxPage.sectionEvents')}
      error={error}
      onRetry={reload}
      testId="devbox-events"
    >
      {rows.length === 0 && !error ? (
        <EmptyState
          compact
          icon={ScrollText}
          title={t('devboxPage.eventsEmpty')}
          description={t('devboxPage.eventsEmptyDesc')}
        />
      ) : (
        <div
          data-testid="devbox-events-river"
          className="max-h-72 overflow-auto rounded-lg border border-white/5 bg-black/40 p-3 font-mono text-2xs leading-5 text-slate-300"
        >
           {rows.map((row, i) => (
             <div key={i} className="truncate" title={eventLine(row)}>
               {eventLine(row)}
             </div>
           ))}
        </div>
      )}
    </DevboxSection>
  );
}
