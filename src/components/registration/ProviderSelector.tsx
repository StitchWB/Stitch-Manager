import { useMemo, useState } from 'react';
import { t } from '@/lib/i18n';
import { ChevronDown, Cpu } from 'lucide-react';

import { cn } from '../../lib/utils';
import type { ProviderInfo } from '../../lib/backend';
import type { ProviderName } from '../../types/ui';
import { ButtonBase } from '@/components/ui';

interface ProviderSelectorProps {
  activeProvider: ProviderName;
  onProviderChange: (provider: ProviderName) => void;
  disabled?: boolean;
  /**
   * Provider plugins from the backend `get_providers` command.
   * Empty by default — each provider is a separate plugin installed from
   * the Marketplace. The parent renders an EmptyState when this is empty.
   */
  providers: ProviderInfo[];
}

export function ProviderSelector({
  activeProvider,
  onProviderChange,
  disabled,
  providers,
}: ProviderSelectorProps) {
  const selectedProvider = useMemo(
    () => providers.find(provider => provider.id === activeProvider),
    [providers, activeProvider]
  );
  const [isExpanded, setIsExpanded] = useState(false);

  const handleProviderChange = (provider: ProviderName) => {
    onProviderChange(provider);
    setIsExpanded(false);
  };

  const activeLabel = selectedProvider?.displayName ?? activeProvider;
  const activeInitial = activeLabel.slice(0, 2).toUpperCase();

  return (
    <div className="shrink-0 px-3 pt-3 pb-2">
      <ButtonBase
        type="button"
        onClick={() => setIsExpanded(expanded => !expanded)}
        disabled={disabled}
        aria-expanded={isExpanded}
        className={cn(
          'w-full flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-left transition-colors',
          !disabled && 'hover:bg-white/[0.05] hover:border-white/[0.12]',
          disabled && 'cursor-not-allowed opacity-40'
        )}
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 bg-white/5 text-slate-400">
          {activeInitial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">{t('uiTexts.providerLabel')}</div>
          <div className="text-sm font-semibold text-white truncate">
            {activeLabel}
          </div>
        </div>
        {selectedProvider?.requiresMachineId && (
          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border bg-indigo-500/10 border-indigo-500/30 text-indigo-300 shrink-0">
            <Cpu className="w-2.5 h-2.5 inline mr-0.5" />
            {t('autoReg.requiresMachineId')}
          </span>
        )}
        <ChevronDown
          className={cn('w-4 h-4 text-slate-500 transition-transform', isExpanded && 'rotate-180')}
        />
      </ButtonBase>

      {isExpanded && (
        <div className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.015] p-2 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="grid grid-cols-3 gap-1.5">
            {providers.map(provider => {
              const isActive = activeProvider === provider.id;
              const initial = provider.displayName.slice(0, 2).toUpperCase();
              return (
                <ButtonBase
                  key={provider.id}
                  type="button"
                  onClick={() => handleProviderChange(provider.id as ProviderName)}
                  disabled={disabled}
                  className={cn(
                    'flex flex-col items-center justify-center gap-1.5 min-h-[76px] px-2 rounded-lg transition-colors',
                    isActive ? 'bg-white/10 ring-1 ring-white/20' : 'hover:bg-white/5',
                    disabled && 'opacity-30 cursor-not-allowed'
                  )}
                >
                  <div
                    className={cn(
                      'w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold',
                      isActive ? 'bg-indigo-500/20 text-indigo-300' : 'bg-white/5 text-slate-400'
                    )}
                  >
                    {initial}
                  </div>
                  <span
                    className={cn(
                      'text-[11px] font-medium text-center leading-tight',
                      isActive ? 'text-white' : 'text-slate-400'
                    )}
                  >
                    {provider.displayName}
                  </span>
                  {provider.requiresMachineId && (
                    <span className="flex items-center gap-0.5 text-[8px] font-bold uppercase tracking-wider text-indigo-400/80">
                      <Cpu className="w-2 h-2" />
                      {t('autoReg.requiresMachineId')}
                    </span>
                  )}
                </ButtonBase>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
