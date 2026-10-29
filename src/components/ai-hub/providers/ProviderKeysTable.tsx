import { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ru as dateFnsRu } from 'date-fns/locale';
import { KeyRound, Plus, Search } from 'lucide-react';
import { Badge, Button, Checkbox, EmptyState, Input, SkeletonLoader, TabButton, Toggle } from '@/components/ui';
import { useVirtualSlice } from '@/hooks/useVirtualSlice';
import { useAppStore } from '@/stores/app';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { Credential } from '@/lib/backend/modules/aiGateway';
import { credStatusMeta, isProblemStatus } from './viewModel';

const ROW_HEIGHT = 56;

const ROW_GRID =
  'grid items-center gap-3 grid-cols-[auto_minmax(7rem,1fr)_minmax(0,10rem)_minmax(0,7rem)_auto]';

type KeyFilter = 'all' | 'problems';

export interface ProviderKeysTableProps {
  credentials: Credential[];
  loading: boolean;
  busy: boolean;
  onAddKeys: () => void;
  onTestSelected: (ids: string[]) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onDeleteSelected: (ids: string[]) => void;
}

function formatLastSuccess(value: string | null | undefined, locale: typeof dateFnsRu | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return formatDistanceToNow(date, { addSuffix: true, locale });
}

function retryHint(
  value: string | null | undefined,
  locale: typeof dateFnsRu | undefined
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return null;
  return `${t('aiHub.providersPage.test')} ${formatDistanceToNow(date, { addSuffix: true, locale })}`;
}

export function ProviderKeysTable(props: ProviderKeysTableProps): JSX.Element {
  const { credentials, loading, busy, onAddKeys, onTestSelected, onToggleEnabled, onDeleteSelected } = props;
  const language = useAppStore(state => state.language);
  const locale = language === 'ru' ? dateFnsRu : undefined;
  const [filter, setFilter] = useState<KeyFilter>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    queueMicrotask(() => {
      setSelectedIds(prev => prev.filter(id => credentials.some(credential => credential.id === id)));
    });
  }, [credentials]);

  const searchedCredentials = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return credentials;
    return credentials.filter(
      credential =>
        (credential.label ?? '').toLowerCase().includes(needle) ||
        credential.fingerprint.toLowerCase().includes(needle)
    );
  }, [credentials, query]);
  const problemCredentials = useMemo(
    () =>
      searchedCredentials.filter(
        credential => credential.enabled && isProblemStatus(credential.runtimeStatus)
      ),
    [searchedCredentials]
  );
  const visibleCredentials = filter === 'problems' ? problemCredentials : searchedCredentials;
  const visibleIds = useMemo(() => visibleCredentials.map(credential => credential.id), [visibleCredentials]);

  const slice = useVirtualSlice({ items: visibleCredentials, rowHeight: ROW_HEIGHT });

  const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id));
  const selectedCount = selectedIds.length;

  const selectAll = (checked: boolean) => {
    setSelectedIds(checked ? visibleIds : []);
  };

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      if (checked) {
        return prev.includes(id) ? prev : [...prev, id];
      }
      return prev.filter(item => item !== id);
    });
  };

  return (
    <section className="bg-white/[0.03] border border-white/[0.08] rounded-xl flex flex-col h-full min-h-[420px] overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-3 py-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-1.5">
          <TabButton
            size="sm"
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            label={`${t('aiHub.providersPage.filterAll')} (${searchedCredentials.length})`}
          />
          <TabButton
            size="sm"
            active={filter === 'problems'}
            onClick={() => setFilter('problems')}
            label={`${t('aiHub.providersPage.filterProblems')} (${problemCredentials.length})`}
          />
        </div>
        <div className="flex items-center gap-2">
          <Input
            leftIcon={<Search size={12} />}
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={t('aiHub.providersPage.keysSearchPlaceholder')}
            containerClassName="w-44 hidden sm:block"
            aria-label={t('aiHub.providersPage.keysSearchPlaceholder')}
          />
          <Badge size="sm" variant="outline">
            {credentials.length}
          </Badge>
          <Button size="xs" leftIcon={<Plus size={12} />} onClick={onAddKeys} disabled={busy}>
            {t('aiHub.providersPage.addKeys')}
          </Button>
        </div>
      </header>

      {!loading && visibleCredentials.length > 0 ? (
        <div
          className={cn(
            'flex flex-wrap items-center gap-2 px-3 py-2 border-b',
            selectedCount > 0 ? 'bg-indigo-500/[0.05] border-indigo-400/15' : 'border-white/[0.06]'
          )}
        >
          <Checkbox
            checked={allSelected}
            onChange={event => selectAll(event.target.checked)}
            aria-label={t('aiHub.providersPage.selectAll')}
            className="py-0 px-0"
          />
          {selectedCount > 0 ? (
            <>
              <span className="text-[11px] font-medium text-indigo-200">
                {t('aiHub.providersPage.selectedCount', { count: selectedCount })}
              </span>
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => onTestSelected(selectedIds)}>
                {t('aiHub.providersPage.testSelected')}
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={busy}
                onClick={() => onDeleteSelected(selectedIds)}
                className="text-red-400 hover:text-red-300 hover:border-red-400/40"
              >
                {t('aiHub.providersPage.deleteSelected')}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="p-3">
          <SkeletonLoader variant="table-row" count={4} />
        </div>
      ) : credentials.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={t('aiHub.providersPage.keysEmpty')}
          description={t('aiHub.providersPage.keysEmptyHint')}
          className="py-12 flex-1"
        />
      ) : (
        <div className="overflow-auto flex-1 min-h-0" onScroll={slice.onScroll}>
          <div
            className={cn(
              ROW_GRID,
              'sticky top-0 z-10 px-3 h-9 bg-vsc-panel-solid border-b border-white/[0.08]'
            )}
          >
            <span />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 truncate">
              {t('aiHub.providersPage.colKey')}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 truncate">
              {t('aiHub.providersPage.colStatus')}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 truncate">
              {t('aiHub.providersPage.colLastUsed')}
            </span>
            <span />
          </div>
          <div style={{ paddingTop: slice.topSpacer, paddingBottom: slice.bottomSpacer }}>
            {slice.rows.map(credential => {
              const meta = credStatusMeta(credential.runtimeStatus);
              const checked = selectedIds.includes(credential.id);
              const hint = retryHint(credential.nextRetryAt, locale);

              return (
                <div
                  key={credential.id}
                  className={cn(ROW_GRID, 'h-14 px-3 border-b border-white/[0.04] overflow-hidden hover:bg-white/[0.03]')}
                >
                  <Checkbox
                    checked={checked}
                    onChange={event => toggleSelect(credential.id, event.target.checked)}
                    className="py-0 px-0"
                  />
                  <span
                    className={cn(
                      'truncate text-[11px] text-slate-300',
                      credential.label ? 'font-medium' : 'font-mono tracking-wide'
                    )}
                    title={credential.label ?? credential.fingerprint}
                  >
                    {credential.label ?? credential.fingerprint.slice(0, 12)}
                  </span>
                  <span className="flex flex-col gap-0.5 min-w-0 overflow-hidden">
                    <span className={cn('inline-flex items-center gap-1.5 min-w-0', meta.textClass)}>
                      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dotClass)} />
                      <span className="text-[11px] font-medium truncate">{t(meta.labelKey)}</span>
                    </span>
                    {hint ? <span className="text-[10px] text-amber-400/70 truncate">{hint}</span> : null}
                    {isProblemStatus(credential.runtimeStatus) && credential.statusReason ? (
                      <span className="text-[10px] text-red-300/60 truncate">{credential.statusReason}</span>
                    ) : null}
                  </span>
                  <span className="text-[11px] text-slate-400 truncate">
                    {formatLastSuccess(credential.lastSuccessAt, locale)}
                  </span>
                  <Toggle
                    label=""
                    size="sm"
                    checked={credential.enabled}
                    onChange={value => onToggleEnabled(credential.id, value)}
                    disabled={busy}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
