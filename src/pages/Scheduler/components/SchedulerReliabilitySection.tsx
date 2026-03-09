import { Input, Toggle } from '../../../components/ui';

export interface SchedulerReliabilityState {
  retryEnabled: boolean;
  retryMaxAttempts: string;
  retryBackoffSeconds: string;
  retryBackoffMultiplier: string;
  retryMaxBackoffSeconds: string;
  quietEnabled: boolean;
  quietStartHour: string;
  quietStartMinute: string;
  quietEndHour: string;
  quietEndMinute: string;
}

interface SchedulerReliabilitySectionProps {
  value: SchedulerReliabilityState;
  onChange: (next: SchedulerReliabilityState) => void;
}

export function SchedulerReliabilitySection({ value, onChange }: SchedulerReliabilitySectionProps) {
  const set = (patch: Partial<SchedulerReliabilityState>) => onChange({ ...value, ...patch });

  return (
    <>
      <div className="rounded-md border border-vsc-border bg-vsc-input/40 p-3 space-y-3">
        <div className="text-sm font-medium text-vsc-text">Retry policy</div>
        <Toggle
          label="Enable retry on failure"
          checked={value.retryEnabled}
          onChange={retryEnabled => set({ retryEnabled })}
        />
        {value.retryEnabled ? (
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Max attempts"
              type="number"
              min="1"
              value={value.retryMaxAttempts}
              onChange={e => set({ retryMaxAttempts: e.target.value })}
            />
            <Input
              label="Backoff seconds"
              type="number"
              min="1"
              value={value.retryBackoffSeconds}
              onChange={e => set({ retryBackoffSeconds: e.target.value })}
            />
            <Input
              label="Backoff multiplier"
              type="number"
              min="1"
              step="0.1"
              value={value.retryBackoffMultiplier}
              onChange={e => set({ retryBackoffMultiplier: e.target.value })}
            />
            <Input
              label="Max backoff seconds"
              type="number"
              min="1"
              value={value.retryMaxBackoffSeconds}
              onChange={e => set({ retryMaxBackoffSeconds: e.target.value })}
            />
          </div>
        ) : null}
      </div>

      <div className="rounded-md border border-vsc-border bg-vsc-input/40 p-3 space-y-3">
        <div className="text-sm font-medium text-vsc-text">Quiet hours</div>
        <Toggle
          label="Pause executions during quiet hours"
          checked={value.quietEnabled}
          onChange={quietEnabled => set({ quietEnabled })}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Start hour"
            type="number"
            min="0"
            max="23"
            value={value.quietStartHour}
            onChange={e => set({ quietStartHour: e.target.value })}
          />
          <Input
            label="Start minute"
            type="number"
            min="0"
            max="59"
            value={value.quietStartMinute}
            onChange={e => set({ quietStartMinute: e.target.value })}
          />
          <Input
            label="End hour"
            type="number"
            min="0"
            max="23"
            value={value.quietEndHour}
            onChange={e => set({ quietEndHour: e.target.value })}
          />
          <Input
            label="End minute"
            type="number"
            min="0"
            max="59"
            value={value.quietEndMinute}
            onChange={e => set({ quietEndMinute: e.target.value })}
          />
        </div>
      </div>
    </>
  );
}
