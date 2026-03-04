import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { PROVIDERS } from '../../constants/registration';
import type { ProviderName } from '../../types';

interface ProviderSelectorProps {
  activeProvider: ProviderName;
  onProviderChange: (provider: ProviderName) => void;
  disabled?: boolean;
  allowedProviders?: ProviderName[];
}

// Group providers by category
const PROVIDER_CATEGORIES = {
  ide: { label: 'IDE', providers: PROVIDERS.filter(p => p.category === 'ide') },
  ai: { label: 'AI', providers: PROVIDERS.filter(p => p.category === 'ai') },
  cloud: { label: 'Cloud', providers: PROVIDERS.filter(p => p.category === 'cloud') },
  git: { label: 'Git', providers: PROVIDERS.filter(p => p.category === 'git') },
} as const;

export function ProviderSelector({
  activeProvider,
  onProviderChange,
  disabled,
  allowedProviders,
}: ProviderSelectorProps) {
  const [activeCategory, setActiveCategory] = useState<keyof typeof PROVIDER_CATEGORIES>('ide');
  const lastProviderRef = useRef<ProviderName>(activeProvider);

  const currentCategory = PROVIDER_CATEGORIES[activeCategory];
  const enabledProviders = useMemo(
    () =>
      currentCategory.providers.filter(
        p => !p.disabled && (!allowedProviders || allowedProviders.includes(p.id))
      ),
    [currentCategory.providers, allowedProviders]
  );

  const categoriesWithVisibleProviders = useMemo(
    () =>
      Object.entries(PROVIDER_CATEGORIES)
        .filter(([, cat]) =>
          cat.providers.some(
            p => !p.disabled && (!allowedProviders || allowedProviders.includes(p.id))
          )
        )
        .map(([key]) => key as keyof typeof PROVIDER_CATEGORIES),
    [allowedProviders]
  );

  // Keep the selected provider visible by switching to its category.
  useEffect(() => {
    // Only auto-switch when the provider actually changes.
    // Otherwise it prevents users from browsing other categories.
    if (lastProviderRef.current === activeProvider) return;
    lastProviderRef.current = activeProvider;

    const providerCategory = (PROVIDERS.find(p => p.id === activeProvider)?.category ||
      'ide') as keyof typeof PROVIDER_CATEGORIES;

    if (categoriesWithVisibleProviders.includes(providerCategory)) {
      queueMicrotask(() => setActiveCategory(providerCategory));
    }
  }, [activeProvider, categoriesWithVisibleProviders]);

  // Keep category valid when allowedProviders narrows available options.
  useEffect(() => {
    if (
      !categoriesWithVisibleProviders.includes(activeCategory) &&
      categoriesWithVisibleProviders[0]
    ) {
      queueMicrotask(() => setActiveCategory(categoriesWithVisibleProviders[0]));
    }
  }, [activeCategory, categoriesWithVisibleProviders]);

  return (
    <div className="shrink-0 px-4 pt-4 pb-3">
      {/* Category Tabs */}
      <div className="flex gap-1 mb-2">
        {Object.entries(PROVIDER_CATEGORIES).map(([key, cat]) => {
          const hasProviders = cat.providers.some(
            p => !p.disabled && (!allowedProviders || allowedProviders.includes(p.id))
          );
          if (!hasProviders) return null;

          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveCategory(key as keyof typeof PROVIDER_CATEGORIES)}
              disabled={disabled}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200',
                activeCategory === key
                  ? 'text-white bg-white/10'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-white/5',
                disabled && 'opacity-30 cursor-not-allowed'
              )}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Provider Grid */}
      <div
        className="grid grid-cols-3 gap-2 p-2 rounded-lg"
        style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        {enabledProviders.map(provider => (
          <button
            key={provider.id}
            type="button"
            onClick={() => onProviderChange(provider.id)}
            disabled={disabled}
            className={cn(
              'flex flex-col items-center justify-center gap-1.5 py-3 px-2 rounded-lg transition-all duration-200',
              activeProvider === provider.id
                ? 'bg-white/10 ring-1 ring-white/20'
                : 'hover:bg-white/5',
              disabled && 'opacity-30 cursor-not-allowed'
            )}
          >
            {/* Icon */}
            <div
              className={cn(
                'w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold',
                activeProvider === provider.id ? provider.color : 'bg-white/5 text-slate-400'
              )}
            >
              {provider.icon}
            </div>
            {/* Name */}
            <span
              className={cn(
                'text-xs font-medium',
                activeProvider === provider.id ? 'text-white' : 'text-slate-400'
              )}
            >
              {provider.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
