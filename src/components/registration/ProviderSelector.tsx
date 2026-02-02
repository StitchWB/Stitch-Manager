import { cn } from '../../lib/utils';
import { PROVIDERS } from '../../constants/registration';
import type { ProviderName } from '../../types';

interface ProviderSelectorProps {
  activeProvider: ProviderName;
  onProviderChange: (provider: ProviderName) => void;
  disabled?: boolean;
}

export function ProviderSelector({
  activeProvider,
  onProviderChange,
  disabled,
}: ProviderSelectorProps) {
  return (
    <div className="shrink-0 px-4 pt-4 pb-3">
      <div
        className="flex gap-1 p-1 rounded-lg"
        style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        {PROVIDERS.map(provider => (
          <button
            key={provider.id}
            onClick={() => !provider.disabled && onProviderChange(provider.id)}
            disabled={provider.disabled || disabled}
            className={cn(
              'flex-1 py-2 text-xs font-medium rounded-md transition-all duration-200',
              activeProvider === provider.id
                ? 'text-white bg-white/10'
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/5',
              (provider.disabled || disabled) && 'opacity-30 cursor-not-allowed'
            )}
          >
            {provider.name}
          </button>
        ))}
      </div>
    </div>
  );
}
