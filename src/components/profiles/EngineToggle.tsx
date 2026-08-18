import { cn } from '@/lib/utils';
import { SegmentedControl } from '@/components/ui';
import { t } from '@/lib/i18n';
import {
  BROWSER_ENGINE_LABELS,
  BROWSER_ENGINE_SHORT_LABELS,
  type BrowserEngineId,
} from '@/lib/browser/engines';

interface EngineToggleProps {
  value: BrowserEngineId;
  onChange: (engine: BrowserEngineId) => void;
  shardAvailable: boolean;
  size?: 'sm' | 'md';
  disabled?: boolean;
  shortLabels?: boolean;
}

const ENGINE_ORDER: BrowserEngineId[] = ['cloakbrowser', 'shardbrowser'];

export function EngineToggle({
  value,
  onChange,
  shardAvailable,
  size = 'md',
  disabled = false,
  shortLabels = false,
}: EngineToggleProps) {
  const isSm = size === 'sm';

  const options = ENGINE_ORDER.map(id => {
    const blocked = id === 'shardbrowser' && !shardAvailable;
    return {
      value: id,
      label: shortLabels ? BROWSER_ENGINE_SHORT_LABELS[id] : BROWSER_ENGINE_LABELS[id],
      disabled: blocked,
      tooltip: blocked
        ? t('accounts.profileEngineShardMissing') || 'ShardBrowser engine is not installed'
        : undefined,
    };
  });

  return (
    <SegmentedControl
      options={options}
      value={value}
      onChange={(next) => onChange(next as BrowserEngineId)}
      size={size}
      stretch
      disabled={disabled}
      className={cn(isSm ? 'flex-1' : 'w-full')}
    />
  );
}
