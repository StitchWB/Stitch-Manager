import { useCallback } from 'react';
import { Shuffle, Dices, TrendingDown, Star } from 'lucide-react';

import { t } from '@/lib/i18n';
import { ButtonBase, GlassCard, Tooltip } from '@/components/ui';
export type RotationStrategy = 'round-robin' | 'random' | 'least-used' | 'priority';

interface RotationStrategySelectorProps {
  value: RotationStrategy;
  onChange: (strategy: RotationStrategy) => void;
  disabled?: boolean;
}

interface StrategyOption {
  id: RotationStrategy;
  icon: typeof Shuffle;
  title: string;
  description: string;
  color: string;
}

const strategies: StrategyOption[] = [
  {
    id: 'round-robin',
    icon: Shuffle,
    title: 'aiHub.rotation.strategies.roundRobin.title',
    description: 'aiHub.rotation.strategies.roundRobin.description',
    color: 'text-blue-400',
  },
  {
    id: 'random',
    icon: Dices,
    title: 'aiHub.rotation.strategies.random.title',
    description: 'aiHub.rotation.strategies.random.description',
    color: 'text-purple-400',
  },
  {
    id: 'least-used',
    icon: TrendingDown,
    title: 'aiHub.rotation.strategies.leastUsed.title',
    description: 'aiHub.rotation.strategies.leastUsed.description',
    color: 'text-emerald-400',
  },
  {
    id: 'priority',
    icon: Star,
    title: 'aiHub.rotation.strategies.priority.title',
    description: 'aiHub.rotation.strategies.priority.description',
    color: 'text-amber-400',
  },
];

export function RotationStrategySelector({
  value,
  onChange,
  disabled = false,
}: RotationStrategySelectorProps) {
  const handleClick = useCallback(
    (strategy: RotationStrategy) => {
      if (!disabled) {
        onChange(strategy);
      }
    },
    [disabled, onChange]
  );

  return (
    <GlassCard className="p-3">
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-white mb-1">
          {t('aiHub.rotation.strategy.title')}
        </h3>
        <p className="text-xs text-slate-400">
          {t('aiHub.rotation.strategy.description')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1.5 min-[700px]:grid-cols-4">
        {strategies.map(strategy => {
          const Icon = strategy.icon;
          const isSelected = value === strategy.id;

          return (
            <Tooltip
              key={strategy.id}
              content={t(strategy.description)}
              className="max-w-xs whitespace-normal"
            >
              <ButtonBase
                type="button"
              onClick={() => handleClick(strategy.id)}
              disabled={disabled}
              className={`rounded-md border p-2.5 text-left transition-all ${isSelected
                  ? 'border-vsc-blue/40 bg-vsc-blue/10 ring-1 ring-vsc-blue/15'
                  : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.035]'
                } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            >
              <div className="flex items-start gap-1.5">
                <Icon size={15} className={`${strategy.color} mt-0.5 shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className="mb-0.5 text-xs font-medium text-white">
                    {t(strategy.title)}
                  </div>
                  <div className="text-[10px] leading-4 text-slate-500 min-[700px]:sr-only">
                    {t(strategy.description)}
                  </div>
                </div>
              </div>
              </ButtonBase>
            </Tooltip>
          );
        })}
      </div>
    </GlassCard>
  );
}
