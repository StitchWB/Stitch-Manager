import { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ru as dateFnsRu } from 'date-fns/locale';
import { Clock, KeyRound, Plus } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  SegmentedControl,
  SkeletonLoader,
  ToolbarSearchField,
  Toggle,
} from '@/components/ui';
import { useVirtualSlice } from '@/hooks/useVirtualSlice';
import { useAppStore } from '@/stores/app';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { Credential, CredentialProbeResult } from '@/lib/backend/modules/aiGateway';
import {
  credStatusMeta,
  formatRemainingFreshness,
  formatRemainingUsd,
  formatResetTime,
  isFutureReset,
  isProblemStatus,
} from './viewModel';

const ROW_HEIGHT = 64;

const ROW_GRID =
  'grid items-center gap-3 grid-cols-[auto_minmax(7.5rem,1.2fr)_minmax(0,6rem)_minmax(0,7rem)_minmax(11rem,1.6fr)_minmax(0,6rem)_auto]';

type KeyFilter = 'all' | 'problems';

export interface ProviderKeysTableProps {
  credentials: Credential[];
  loading: boolean;
  busy: boolean;
  testResults: Record<string, CredentialProbeResult>;
  onAddKeys: () => void;
  onTestSelected: (ids: string[]) => Promise<void>;
  onRefreshQuotaSelected: (ids: string[]) => Promise<void>;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onDeleteSelected: (ids: string[]) => Promise<void>;
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
  const {
    credentials,
    loading,
    busy,
    testResults,
    onAddKeys,
    onTestSelected,
    onRefreshQuotaSelected,
    onToggleEnabled,
    onDeleteSelected,
  } = props;
  const language = useAppStore(state => state.language);
  const locale = language === 'ru' ? dateFnsRu : undefined;
  const [filter, setFilter] = useState<KeyFilter>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
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
        (credential.accountGroup ?? '').toLowerCase().includes(needle) ||
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

  const runSelection = async (action: (ids: string[]) => Promise<void>) => {
    const ids = selectedIds;
    if (ids.length === 0 || running) return;
    setRunning(true);
    try {
      await action(ids);
    } finally {
      setRunning(false);
      setSelectedIds([]);
    }
  };

  return (
    <section className="bg-white/[0.03] border border-white/[0.08] rounded-xl flex flex-col h-full min-h-[420px] overflow-hidden">
      <header
        className={cn(
          'flex flex-wrap items-center gap-2 px-3 py-2 border-b',
          selectedCount > 0 ? 'bg-indigo-500/[0.05] border-indigo-400/15' : 'border-white/[0.06]'
        )}
      >
        <SegmentedControl
          size="sm"
          stretch={false}
          className="shrink-0"
          value={filter}
          onChange={value => setFilter(value as KeyFilter)}
          options={[
            {
              value: 'all',
              label: `${t('aiHub.providersPage.filterAll')} (${searchedCredentials.length})`,
            },
            {
              value: 'problems',
              label: `${t('aiHub.providersPage.filterProblems')} (${problemCredentials.length})`,
            },
          ]}
        />
        <ToolbarSearchField
          value={query}
          onValueChange={setQuery}
          placeholder={t('aiHub.providersPage.keysSearchPlaceholder')}
          aria-label={t('aiHub.providersPage.keysSearchPlaceholder')}
          containerClassName="flex-1 min-w-0 max-w-md hidden sm:block"
        />
        <div className="flex items-center gap-2 ml-auto shrink-0">
          {!loading && visibleCredentials.length > 0 ? (
            <Checkbox
              checked={allSelected}
              onChange={event => selectAll(event.target.checked)}
              aria-label={t('aiHub.providersPage.selectAll')}
              className="py-0 px-0"
            />
          ) : null}
          {selectedCount > 0 ? (
            <>
              <span className="text-xs font-medium text-indigo-200 tabular-nums whitespace-nowrap">
                {t('aiHub.providersPage.selectedCount', { count: selectedCount })}
              </span>
              <Button
                size="xs"
                variant="ghost"
                disabled={busy || running}
                onClick={() => void runSelection(onTestSelected)}
              >
                {t('aiHub.providersPage.testSelected')}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={busy || running}
                onClick={() => void runSelection(onRefreshQuotaSelected)}
              >
                {t('aiHub.providersPage.refreshQuota')}
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={busy || running}
                onClick={() => void runSelection(onDeleteSelected)}
                className="text-red-400 hover:text-red-300 hover:border-red-400/40"
              >
                {t('aiHub.providersPage.deleteSelected')}
              </Button>
            </>
          ) : null}
          <Badge size="sm" variant="outline" className="tabular-nums">
            {credentials.length}
          </Badge>
          <Button size="xs" leftIcon={<Plus size={12} />} onClick={onAddKeys} disabled={busy}>
            {t('aiHub.providersPage.addKeys')}
          </Button>
        </div>
      </header>

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
              'sticky top-0 z-10 px-3 h-10 bg-vsc-panel-solid border-b border-white/[0.12] shadow-[0_2px_8px_rgba(0,0,0,0.35)]'
            )}
          >
            <span />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 truncate">
              {t('aiHub.providersPage.colKey')}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 truncate">
              {t('aiHub.providersPage.colGroup')}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 truncate text-right">
              {t('aiHub.providersPage.colQuota')}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 truncate">
              {t('aiHub.providersPage.colStatus')}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 truncate">
              {t('aiHub.providersPage.colLastUsed')}
            </span>
            <span />
          </div>
          <div style={{ paddingTop: slice.topSpacer, paddingBottom: slice.bottomSpacer }}>
            {slice.rows.map(credential => {
              const meta = credStatusMeta(credential.runtimeStatus);
              const checked = selectedIds.includes(credential.id);
              const hint = retryHint(credential.nextRetryAt, locale);
              const probe = testResults[credential.id];
              const isQuotaExhaustedWithFutureReset =
                credential.runtimeStatus === 'quota_exhausted' && isFutureReset(credential.quotaResetAt);
              const resetTime = isQuotaExhaustedWithFutureReset ? formatResetTime(credential.quotaResetAt) : null;
              const formattedUsd = formatRemainingUsd(credential.remainingUsd);
              const freshness = formatRemainingFreshness(
                credential.remainingCheckedAt,
                Date.now(),
                t('aiHub.providersPage.quotaMinutes')
              );

              return (
                <div
                  key={credential.id}
                  className={cn(ROW_GRID, 'h-16 px-3 border-b border-white/[0.04] overflow-hidden hover:bg-white/[0.02]')}
                >
                  <Checkbox
                    checked={checked}
                    onChange={event => toggleSelect(credential.id, event.target.checked)}
                    className="py-0 px-0"
                  />
                  <span
                    className={cn(
                      'truncate text-xs text-slate-300',
                      credential.label ? 'font-medium' : 'font-mono tracking-wide'
                    )}
                    title={credential.label ?? credential.fingerprint}
                  >
                    {credential.label ?? credential.fingerprint.slice(0, 12)}
                  </span>
                  <span className="truncate text-xs">
                    {credential.accountGroup ? (
                      <Badge size="sm" variant="slate" className="max-w-full truncate" title={credential.accountGroup}>
                        {credential.accountGroup}
                      </Badge>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </span>
                  <span className="flex items-center justify-end gap-1.5 min-w-0 text-xs">
                    {isQuotaExhaustedWithFutureReset && resetTime ? (
                      <Badge
                        size="sm"
                        variant="warning"
                        className="max-w-full truncate gap-1 tabular-nums"
                        title={
                          credential.quotaResetAt
                            ? `${t('aiHub.providersPage.quotaResetTooltip')}: ${credential.quotaResetAt}`
                            : t('aiHub.providersPage.quotaResetTooltip')
                        }
                      >
                        <Clock size={12} className="shrink-0" />
                        <span>{resetTime}</span>
                      </Badge>
                    ) : formattedUsd !== null ? (
                      <span className="inline-flex items-baseline justify-end gap-1.5 min-w-0" title={formattedUsd}>
                        <span className="font-mono text-xs font-medium text-slate-200 tabular-nums truncate">
                          {formattedUsd}
                        </span>
                        {freshness ? (
                          <span
                            className="font-mono text-[11px] text-slate-500 tabular-nums shrink-0 font-normal"
                            title={freshness}
                          >
                            {freshness}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </span>
                  <span className="flex flex-col justify-center gap-0.5 min-w-0 overflow-hidden">
                    <span className={cn('inline-flex items-center gap-1.5 min-w-0', meta.textClass)}>
                      <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', meta.dotClass)} />
                      <span className="text-xs font-medium truncate" title={t(meta.labelKey)}>
                        {t(meta.labelKey)}
                      </span>
                    </span>
                    {probe ? (
                      probe.success ? (
                        <span
                          className="inline-flex items-center gap-1.5 min-w-0 font-mono text-[11px] text-emerald-300/80"
                          title={probe.latency_ms != null ? `${probe.latency_ms} ms` : undefined}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                          <span className="truncate tabular-nums">
                            {probe.latency_ms != null ? `${probe.latency_ms} ms` : t('common.success')}
                          </span>
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1.5 min-w-0 text-[11px] text-red-300/80"
                          title={probe.error ?? undefined}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
                          <span className="truncate">{probe.error ?? t('common.error')}</span>
                        </span>
                      )
                    ) : null}
                    {hint ? (
                      <span className="text-[11px] text-amber-400/70 truncate" title={hint}>
                        {hint}
                      </span>
                    ) : null}
                    {isProblemStatus(credential.runtimeStatus) && credential.statusReason ? (
                      <span
                        className="text-[11px] leading-snug text-red-300/70 line-clamp-2 break-words"
                        title={credential.statusReason}
                      >
                        {credential.statusReason}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className="font-mono text-[11px] text-slate-400 truncate"
                    title={formatLastSuccess(credential.lastSuccessAt, locale)}
                  >
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
