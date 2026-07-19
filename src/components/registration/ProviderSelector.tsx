import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { cn } from '../../lib/utils';
import { PROVIDERS } from '../../constants/registration';
import type { ProviderName } from '../../types/ui';
import { ButtonBase } from '@/components/ui';

interface ProviderSelectorProps {
  activeProvider: ProviderName;
  onProviderChange: (provider: ProviderName) => void;
  disabled?: boolean;
  allowedProviders?: ProviderName[];
}

const PROVIDER_CATEGORIES = {
  ide: { label: 'IDE', providers: PROVIDERS.filter(p => p.category === 'ide') },
  ai: { label: 'AI', providers: PROVIDERS.filter(p => p.category === 'ai') },
  cloud: { label: 'Облако', providers: PROVIDERS.filter(p => p.category === 'cloud') },
  git: { label: 'Git', providers: PROVIDERS.filter(p => p.category === 'git') },
} as const;

export function ProviderSelector({
  activeProvider,
  onProviderChange,
  disabled,
  allowedProviders,
}: ProviderSelectorProps) {
  const selectedProvider = useMemo(
    () => PROVIDERS.find(provider => provider.id === activeProvider),
    [activeProvider]
  );
  const selectedCategory = (selectedProvider?.category ?? 'ide') as keyof typeof PROVIDER_CATEGORIES;
  const [activeCategory, setActiveCategory] = useState<keyof typeof PROVIDER_CATEGORIES>(selectedCategory);
  const [isExpanded, setIsExpanded] = useState(false);
  const lastProviderRef = useRef<ProviderName>(activeProvider);

  const currentCategory = PROVIDER_CATEGORIES[activeCategory];
  const enabledProviders = useMemo(
    () =>
      currentCategory.providers.filter(
        provider => !provider.disabled && (!allowedProviders || allowedProviders.includes(provider.id))
      ),
    [currentCategory.providers, allowedProviders]
  );

  const categoriesWithVisibleProviders = useMemo(
    () =>
      Object.entries(PROVIDER_CATEGORIES)
        .filter(([, category]) =>
          category.providers.some(
            provider => !provider.disabled && (!allowedProviders || allowedProviders.includes(provider.id))
          )
        )
        .map(([key]) => key as keyof typeof PROVIDER_CATEGORIES),
    [allowedProviders]
  );

  useEffect(() => {
    if (lastProviderRef.current === activeProvider) return;
    lastProviderRef.current = activeProvider;

    if (categoriesWithVisibleProviders.includes(selectedCategory)) {
      queueMicrotask(() => setActiveCategory(selectedCategory));
    }
  }, [activeProvider, categoriesWithVisibleProviders, selectedCategory]);

  useEffect(() => {
    if (!categoriesWithVisibleProviders.includes(activeCategory) && categoriesWithVisibleProviders[0]) {
      queueMicrotask(() => setActiveCategory(categoriesWithVisibleProviders[0]));
    }
  }, [activeCategory, categoriesWithVisibleProviders]);

  const handleProviderChange = (provider: ProviderName) => {
    onProviderChange(provider);
    setIsExpanded(false);
  };

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
        <div
          className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0',
            selectedProvider?.color ?? 'bg-white/5 text-slate-400'
          )}
        >
          {selectedProvider?.icon ?? activeProvider.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-wider text-slate-500">Провайдер</div>
          <div className="text-sm font-semibold text-white truncate">
            {selectedProvider?.name ?? activeProvider}
          </div>
        </div>
        <ChevronDown
          className={cn('w-4 h-4 text-slate-500 transition-transform', isExpanded && 'rotate-180')}
        />
      </ButtonBase>

      {isExpanded && (
        <div className="mt-2 rounded-xl border border-white/[0.06] bg-white/[0.015] p-2 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="flex gap-1 pb-2">
            {Object.entries(PROVIDER_CATEGORIES).map(([key, category]) => {
              const hasProviders = category.providers.some(
                provider => !provider.disabled && (!allowedProviders || allowedProviders.includes(provider.id))
              );
              if (!hasProviders) return null;

              return (
                <ButtonBase
                  key={key}
                  type="button"
                  onClick={() => setActiveCategory(key as keyof typeof PROVIDER_CATEGORIES)}
                  disabled={disabled}
                  className={cn(
                    'px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors',
                    activeCategory === key
                      ? 'text-white bg-white/10'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-white/5',
                    disabled && 'opacity-30 cursor-not-allowed'
                  )}
                >
                  {category.label}
                </ButtonBase>
              );
            })}
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {enabledProviders.map(provider => (
              <ButtonBase
                key={provider.id}
                type="button"
                onClick={() => handleProviderChange(provider.id)}
                disabled={disabled}
                className={cn(
                  'flex flex-col items-center justify-center gap-1.5 min-h-[76px] px-2 rounded-lg transition-colors',
                  activeProvider === provider.id
                    ? 'bg-white/10 ring-1 ring-white/20'
                    : 'hover:bg-white/5',
                  disabled && 'opacity-30 cursor-not-allowed'
                )}
              >
                <div
                  className={cn(
                    'w-7 h-7 rounded-md flex items-center justify-center text-[11px] font-bold',
                    activeProvider === provider.id ? provider.color : 'bg-white/5 text-slate-400'
                  )}
                >
                  {provider.icon}
                </div>
                <span
                  className={cn(
                    'text-[11px] font-medium',
                    activeProvider === provider.id ? 'text-white' : 'text-slate-400'
                  )}
                >
                  {provider.name}
                </span>
              </ButtonBase>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
