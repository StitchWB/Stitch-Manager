import { LayoutGrid } from 'lucide-react';

import { AI_PROXY_PROVIDER_FILTERS } from '../providerMeta';
import { ButtonBase, ProviderLogo } from '@/components/ui';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface AiProvidersSidebarProps {
  providerFilter: string;
  providerCounts: Record<string, number>;
  onSelectProvider: (providerId: string) => void;
}

function ProviderIcon({ providerId }: { providerId: string }) {
  if (providerId === 'all') return <LayoutGrid size={15} />;
  return <ProviderLogo provider={providerId} size={16} colored />;
}

export function AiProvidersSidebar({
  providerFilter,
  providerCounts,
  onSelectProvider,
}: AiProvidersSidebarProps) {
  const providerButtons = AI_PROXY_PROVIDER_FILTERS.map(provider => {
    const active = providerFilter === provider.id;
    return (
      <ButtonBase
        key={provider.id}
        type="button"
        onClick={() => onSelectProvider(provider.id)}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'relative flex items-center gap-2.5 rounded-md text-xs font-medium transition-colors',
          active
            ? 'bg-indigo-500/12 text-white ring-1 ring-inset ring-indigo-400/20'
            : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-200'
        )}
      >
        <span className={cn('shrink-0', active ? 'text-indigo-300' : 'text-slate-600')}>
          <ProviderIcon providerId={provider.id} />
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{provider.label}</span>
        <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[9px] tabular-nums text-slate-500">
          {providerCounts[provider.id] ?? 0}
        </span>
      </ButtonBase>
    );
  });

  return (
    <>
      <aside className="hidden w-[220px] shrink-0 flex-col overflow-hidden border-r border-white/[0.06] bg-vsc-sidebar/25 md:flex">
        <div className="border-b border-white/[0.05] px-4 py-3">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            {t('aiHub.labels.providers')}
          </h2>
          <p className="mt-1 text-[10px] leading-4 text-slate-600">
            {t('aiHub.labels.providersHint')}
          </p>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-3">
          {providerButtons.map((button, index) => (
            <div key={AI_PROXY_PROVIDER_FILTERS[index].id} className="[&>button]:w-full [&>button]:px-2.5 [&>button]:py-2">
              {button}
            </div>
          ))}
        </div>
      </aside>

      <div className="shrink-0 overflow-x-auto border-b border-white/[0.06] bg-vsc-sidebar/20 p-2 md:hidden">
        <div className="flex min-w-max gap-1 [&>button]:px-2.5 [&>button]:py-1.5">
          {providerButtons}
        </div>
      </div>
    </>
  );
}
