import { LayoutGrid, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { AI_PROXY_PROVIDER_FILTERS } from './providerMeta';
import { ButtonBase, Input, OverflowMenu, ProviderLogo } from '@/components/ui';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const TOP_CHIP_COUNT = 5;

const ALL_PROVIDERS_LABEL = AI_PROXY_PROVIDER_FILTERS[0].label;

interface ProviderFilterBarProps {
  providerCounts: Record<string, number>;
}

interface ProviderChip {
  id: string;
  label: string;
  count: number;
}

export function ProviderFilterBar({ providerCounts }: ProviderFilterBarProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeProvider = searchParams.get('provider') ?? 'all';
  const query = searchParams.get('q') ?? '';

  const registered: ProviderChip[] = AI_PROXY_PROVIDER_FILTERS.filter(p => p.id !== 'all').map(
    p => ({ id: p.id, label: p.label, count: providerCounts[p.id] ?? 0 })
  );
  const knownIds = new Set(registered.map(c => c.id));
  const extras: ProviderChip[] = Object.keys(providerCounts)
    .filter(id => id !== 'all' && !knownIds.has(id))
    .map(id => ({ id, label: id, count: providerCounts[id] }));

  const all = [...registered, ...extras];
  const top = all.filter(c => c.count > 0).sort((a, b) => b.count - a.count).slice(0, TOP_CHIP_COUNT);
  const topIds = new Set(top.map(c => c.id));
  const overflow = all.filter(c => !topIds.has(c.id));

  const selectProvider = (id: string) => {
    setSearchParams(prev => {
      if (id === 'all') prev.delete('provider');
      else prev.set('provider', id);
      return prev;
    });
  };

  const setQuery = (value: string) => {
    setSearchParams(
      prev => {
        if (value) prev.set('q', value);
        else prev.delete('q');
        return prev;
      },
      { replace: true }
    );
  };

  const chip = (id: string, label: string, count: number, icon: React.ReactNode) => {
    const active = activeProvider === id;
    return (
      <ButtonBase
        key={id}
        type="button"
        onClick={() => selectProvider(id)}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
          active
            ? 'bg-indigo-500/12 text-white ring-1 ring-inset ring-indigo-400/20'
            : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-200'
        )}
      >
        <span className={cn('shrink-0', active ? 'text-indigo-300' : 'text-slate-600')}>{icon}</span>
        <span className="whitespace-nowrap">{label}</span>
        <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[9px] tabular-nums text-slate-500">
          {count}
        </span>
      </ButtonBase>
    );
  };

  return (
    <div
      data-testid="provider-filter-bar"
      className="flex items-center gap-2 border-b border-white/[0.06] bg-vsc-sidebar/20 px-3 py-2 md:px-4"
    >
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="flex min-w-max items-center gap-1">
          {chip('all', ALL_PROVIDERS_LABEL, providerCounts.all ?? 0, <LayoutGrid size={15} />)}
          {top.map(c =>
            chip(c.id, c.label, c.count, <ProviderLogo provider={c.id} size={16} colored />)
          )}
          {overflow.length > 0 && (
            <OverflowMenu
              triggerLabel={t('aiHub.labels.providers')}
              size="sm"
              items={overflow.map(c => ({
                id: c.id,
                label: `${c.label} · ${c.count}`,
                onSelect: () => selectProvider(c.id),
              }))}
            />
          )}
        </div>
      </div>
      <Input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={t('aiHub.search.placeholder')}
        leftIcon={<Search className="w-4 h-4" />}
        containerClassName="w-40 shrink-0 md:w-56"
        aria-label={t('aiHub.search.placeholder')}
      />
    </div>
  );
}
