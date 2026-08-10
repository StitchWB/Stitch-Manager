import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui';
import { BROWSER_ENGINE_LABELS, type BrowserEngineId } from '@/lib/browser/engines';

interface EngineToggleProps {
  value: BrowserEngineId;
  onChange: (engine: BrowserEngineId) => void;
  shardAvailable: boolean;
  size?: 'sm' | 'md';
  disabled?: boolean;
}

const ENGINE_ORDER: BrowserEngineId[] = ['cloakbrowser', 'shardbrowser'];

export function EngineToggle({
  value,
  onChange,
  shardAvailable,
  size = 'md',
  disabled = false,
}: EngineToggleProps) {
  const isSm = size === 'sm';

  return (
    <div
      className={cn(
        'inline-flex gap-1 rounded-md border border-white/5 bg-white/[0.02] p-0.5',
        isSm ? 'flex-1' : 'w-full'
      )}
      role="group"
    >
      {ENGINE_ORDER.map(id => {
        const active = value === id;
        const blocked = id === 'shardbrowser' && !shardAvailable;
        const isDisabled = disabled || blocked;
        const tooltip = blocked
          ? 'ShardBrowser engine is not installed'
          : undefined;

        const btn = (
          <button
            key={id}
            type="button"
            disabled={isDisabled}
            onClick={() => onChange(id)}
            className={cn(
              'flex-1 rounded font-semibold transition-colors border',
              isSm
                ? 'px-1.5 py-1 text-[10px]'
                : 'px-2 py-1.5 text-[11px]',
              active
                ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-300'
                : 'bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5',
              isDisabled && 'opacity-50 cursor-not-allowed pointer-events-none'
            )}
          >
            {BROWSER_ENGINE_LABELS[id]}
          </button>
        );

        return tooltip ? (
          <Tooltip key={id} content={tooltip}>
            {btn}
          </Tooltip>
        ) : (
          btn
        );
      })}
    </div>
  );
}
