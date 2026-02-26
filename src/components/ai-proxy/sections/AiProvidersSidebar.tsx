import { LayoutGrid } from 'lucide-react';
import { AI_PROXY_PROVIDER_FILTERS } from '../providerMeta';
import { QuotaDashboard } from '../QuotaDashboard';
import { cn } from '../../../lib/utils';

interface AiProvidersSidebarProps {
  providerFilter: string;
  providerCounts: Record<string, number>;
  onSelectProvider: (providerId: string) => void;
}

export function AiProvidersSidebar({
  providerFilter,
  providerCounts,
  onSelectProvider,
}: AiProvidersSidebarProps) {
  return (
    <aside className="w-[200px] lg:w-[220px] shrink-0 bg-[#111116]/50 backdrop-blur-md border-r border-white/5 flex flex-col overflow-hidden hidden md:flex">
      <div className="p-3 flex-1 overflow-y-auto">
        <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 px-2">
          Providers
        </h3>
        <div className="space-y-0.5 mb-6">
          {AI_PROXY_PROVIDER_FILTERS.map(provider => (
            <button
              key={provider.id}
              onClick={() => onSelectProvider(provider.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors duration-150 relative',
                providerFilter === provider.id
                  ? 'bg-indigo-500/15 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              )}
            >
              {providerFilter === provider.id && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-indigo-500 rounded-r shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
              )}
              <LayoutGrid size={16} className="shrink-0 ml-2" />
              <span className="flex-1 text-left">{provider.label}</span>
              {providerCounts[provider.id] > 0 && (
                <span className="text-xs text-slate-400 font-medium tabular-nums">
                  {providerCounts[provider.id]}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="mt-auto pt-4 border-t border-white/5">
          <QuotaDashboard />
        </div>
      </div>
    </aside>
  );
}
