import { Tooltip } from '@/components/Tooltip';
import { Input, Button, NumberInput, FormGrid } from '@/components/ui';
import { Settings, Timer } from 'lucide-react';
import { CollapsibleSection } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface InboxAdvancedSectionProps {
  timeoutMs: number;
  onTimeoutMsChange: (value: number) => void;
  pollIntervalMs: number;
  onPollIntervalMsChange: (value: number) => void;
  dedupeKey: string;
  onDedupeKeyChange: (value: string) => void;
  session: unknown;
  isBusy: boolean;
  disabled?: boolean;
  onWait: () => void;
  allExpanded: boolean;
}

export function InboxAdvancedSection({
  timeoutMs,
  onTimeoutMsChange,
  pollIntervalMs,
  onPollIntervalMsChange,
  dedupeKey,
  onDedupeKeyChange,
  session,
  isBusy,
  disabled,
  onWait,
  allExpanded,
}: InboxAdvancedSectionProps) {
  return (
    <CollapsibleSection
      title="Расширенные настройки"
      description="Опции опроса и таймаутов"
      icon={<Settings className="w-5 h-5 text-slate-400" />}
      defaultExpanded={allExpanded || false}
      disabled={disabled || !session}
      className="p-3"
    >
      <div className={cn('space-y-3', !session && 'opacity-60')}>
        <FormGrid columns={3} responsive>
          <Tooltip content="Максимальное время ожидания письма (в миллисекундах)">
            <NumberInput
              label="Таймаут"
              value={timeoutMs / 1000}
              onChange={val => onTimeoutMsChange(Math.max(1000, val * 1000))}
              min={10}
              max={600}
              step={10}
              unit="сек"
              disabled={!session || disabled || isBusy}
            />
          </Tooltip>
          <Tooltip content="Как часто проверять почту (в миллисекундах)">
            <NumberInput
              label="Интервал опроса"
              value={pollIntervalMs / 1000}
              onChange={val => onPollIntervalMsChange(Math.max(500, val * 1000))}
              min={0.5}
              max={30}
              step={0.5}
              unit="сек"
              disabled={!session || disabled || isBusy}
            />
          </Tooltip>
          <Tooltip content="Поле для уникальной идентификации писем. Оставьте пустым для авто">
            <Input
              label="Ключ дедупликации"
              value={dedupeKey}
              onChange={e => onDedupeKeyChange(e.target.value)}
              disabled={!session || disabled || isBusy}
            />
          </Tooltip>
        </FormGrid>

        <div className="flex gap-2 flex-wrap">
          <Tooltip content="Ожидать новое письмо с заданными фильтрами">
            <Button
              variant="secondary"
              size="sm"
              onClick={onWait}
              disabled={!session || disabled || isBusy}
            >
              <Timer className="w-4 h-4" /> Ждать письмо
            </Button>
          </Tooltip>
        </div>
      </div>
    </CollapsibleSection>
  );
}
