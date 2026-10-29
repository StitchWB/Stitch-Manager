import { Search, Server } from 'lucide-react';

import { Button, ButtonBase, EmptyState, Input, ProviderLogo } from '@/components/ui';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { HEALTH_META } from './viewModel';
import type { ProviderRosterItem } from './viewModel';

export interface ProviderRosterProps {
  items: ProviderRosterItem[];
  allItems: ProviderRosterItem[];
  selectedId: string | null;
  search: string;
  loading: boolean;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  onAddProvider: () => void;
}

export function ProviderRoster(props: ProviderRosterProps): JSX.Element {
  const { items, allItems, selectedId, search, loading, onSearchChange, onSelect, onAddProvider } = props;

  const totalKeys = allItems.reduce((sum, item) => sum + item.credentialCount, 0);
  const healthyCount = allItems.filter(item => item.health === 'healthy').length;
  const problemCount = allItems.filter(item => item.problemCount > 0).length;
  const emptyCount = allItems.filter(item => item.health === 'empty').length;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-white/[0.06]">
        <Input
          leftIcon={<Search size={14} />}
          value={search}
          onChange={event => onSearchChange(event.target.value)}
          placeholder={t('aiHub.providersPage.searchProviders')}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {loading && items.length === 0
          ? [0, 1, 2].map(row => (
              <div key={row} className="h-14 rounded-lg bg-white/[0.03] animate-pulse" />
            ))
          : items.length === 0
            ? (
                <EmptyState
                  icon={Server}
                  title={t('aiHub.providersPage.rosterEmpty')}
                  description={t('aiHub.providersPage.rosterEmptyHint')}
                  action={
                    <Button variant="primary" size="sm" onClick={onAddProvider}>
                      {t('aiHub.providersPage.addProvider')}
                    </Button>
                  }
                />
              )
            : items.map(item => {
                const selected = item.endpoint.id === selectedId;
                const meta = HEALTH_META[item.health];
                return (
                  <ButtonBase
                    key={item.endpoint.id}
                    type="button"
                    onClick={() => onSelect(item.endpoint.id)}
                    aria-current={selected ? 'true' : undefined}
                    className={cn(
                      'w-full h-14 flex items-center gap-3 px-3 rounded-lg text-left transition-colors',
                      selected
                        ? 'bg-indigo-500/12 ring-1 ring-inset ring-indigo-400/20 text-white'
                        : 'text-slate-300 hover:bg-white/[0.04]'
                    )}
                  >
                    <ProviderLogo provider={item.logoKey} size={16} colored />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{item.endpoint.name}</p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {item.credentialCount} {t('aiHub.providersPage.keysShort')}
                        {item.problemCount > 0 && (
                          <>
                            {' · '}
                            {item.problemCount} {t('aiHub.providersPage.failingShort')}
                          </>
                        )}
                      </p>
                    </div>
                    <span
                      title={t(meta.labelKey)}
                      className={cn('w-2 h-2 rounded-full shrink-0', meta.dotClass)}
                    />
                  </ButtonBase>
                );
              })}
      </div>
      <div className="shrink-0 border-t border-white/[0.06] px-3 py-2">
        <p className="text-[11px] tabular-nums text-slate-400">
          {allItems.length} {t('aiHub.providersPage.roster.footerProviders')} · {totalKeys}{' '}
          {t('aiHub.providersPage.roster.footerKeys')}
        </p>
        <p className="mt-0.5 flex items-center gap-2 text-[10px] tabular-nums text-slate-500">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {healthyCount} {t('aiHub.providersPage.roster.footerHealthy')}
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            {problemCount} {t('aiHub.providersPage.roster.footerProblems')}
          </span>
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-600" />
            {emptyCount} {t('aiHub.providersPage.roster.footerEmpty')}
          </span>
        </p>
      </div>
    </div>
  );
}
