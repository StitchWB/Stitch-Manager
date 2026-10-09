import { useCallback, useEffect, useState } from 'react';
import { FileText, RefreshCw, Search } from 'lucide-react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Input } from '@/components/ui/Input';
import { IconButton } from '@/components/ui/IconButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { t } from '@/lib/i18n';
import { devboxLogs } from '@/lib/backend/modules/devbox';
import { DevboxSection } from './DevboxSection';
import { useDevboxPoll } from './useDevboxPoll';
import { DEVBOX_LOGS_LIMIT } from './constants';

const FILTER_DEBOUNCE_MS = 500;

export function DevboxLogs() {
  const [source, setSource] = useState('');
  const [filterInput, setFilterInput] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setFilter(filterInput.trim()), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filterInput]);

  const fetcher = useCallback(
    () => devboxLogs({ source: source || undefined, filter: filter || undefined, limit: DEVBOX_LOGS_LIMIT }),
    [source, filter],
  );
  const { data, error, reload } = useDevboxPoll(fetcher, 0);

  const sources = Array.isArray(data?.sources) ? data.sources : [];
  const sourceNames = sources.map(s => s.name).filter(Boolean);
  const options = [
    { label: t('devboxPage.logsSourceAll'), value: '' },
    ...sourceNames.map(name => ({ label: name, value: name })),
  ];
  const visible = source ? sources.filter(s => s.name === source) : sources;
  const hasLines = visible.some(s => Array.isArray(s.lines) && s.lines.length > 0);

  return (
    <DevboxSection
      title={t('devboxPage.sectionLogs')}
      error={error}
      onRetry={reload}
      testId="devbox-logs"
      actions={
        <IconButton size="sm" variant="ghost" aria-label={t('common.refresh')} onClick={reload}>
          <RefreshCw size={14} />
        </IconButton>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            size="sm"
            stretch={false}
            options={options}
            value={source}
            onChange={setSource}
            className="max-w-full overflow-x-auto"
          />
          <Input
            value={filterInput}
            placeholder={t('devboxPage.logsFilterPlaceholder')}
            leftIcon={<Search size={14} />}
            containerClassName="w-56"
            data-testid="devbox-logs-filter"
            onChange={e => setFilterInput(e.target.value)}
          />
        </div>

        {!hasLines && !error ? (
          <EmptyState compact icon={FileText} title={t('devboxPage.logsEmpty')} />
        ) : (
          <div className="flex flex-col gap-3">
            {visible.map(s => (
              <div key={s.name} className="flex flex-col gap-1">
                <span className="text-2xs uppercase tracking-wider text-slate-500">{s.name}</span>
                <pre
                  data-testid={`devbox-logs-source-${s.name}`}
                  className="max-h-64 overflow-auto rounded-lg border border-white/5 bg-black/40 p-3 font-mono text-2xs leading-5 text-slate-300 whitespace-pre-wrap"
                >
                  {(s.lines ?? []).join('\n')}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </DevboxSection>
  );
}
